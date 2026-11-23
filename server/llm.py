"""Gemini with model failover.

Gemini's free tier regularly answers 429 (rate limit), 503 "high demand" or 504
"deadline exceeded". Pipecat turns that into an error frame and the caller hears
silence, which is the worst outcome on a phone call. This subclass:

- retries a turn on the next model in the list when a request fails *before its first
  chunk* (once text has started streaming it is passed straight through),
- benches a rate-limited model for a minute so later turns don't pay for the 429 again,
- makes a second pass after a short pause if every model failed, and
- if that fails too, says a short apology instead of going quiet.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator

from google.genai.errors import ClientError, ServerError
from loguru import logger
from pipecat.frames.frames import TTSSpeakFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.services.google.llm import GoogleLLMService

RATE_LIMIT_COOLDOWN_SECS = 60
APOLOGY = "Sorry, I didn't quite catch that. Could you say it again?"


def _transient(e: BaseException) -> bool:
    if isinstance(e, (ServerError, TimeoutError, asyncio.TimeoutError)):
        return True
    return isinstance(e, ClientError) and e.code == 429


class FailoverGoogleLLMService(GoogleLLMService):
    def __init__(self, *, fallback_models: list[str], first_chunk_timeout: float = 7.0, **kwargs):
        super().__init__(**kwargs)
        self._fallback_models = fallback_models
        self._first_chunk_timeout = first_chunk_timeout
        self._benched_until: dict[str, float] = {}

    def _candidates(self, primary: str) -> list[str]:
        models = [primary, *[m for m in self._fallback_models if m != primary]]
        now = time.monotonic()
        ready = [m for m in models if self._benched_until.get(m, 0) <= now]
        return ready or models  # everything benched: try them all anyway

    async def _stream_response(self, context: LLMContext) -> AsyncIterator:
        primary = self._settings.model
        last_error: BaseException | None = None
        try:
            for attempt in range(2):
                if attempt:
                    await asyncio.sleep(1.0)
                models = self._candidates(primary) if attempt == 0 else [primary, *self._fallback_models]
                for i, model in enumerate(models):
                    self._settings.model = model  # thinking defaults are resolved per request, per model
                    stream = super()._stream_response(context)
                    try:
                        first = await asyncio.wait_for(anext(stream), self._first_chunk_timeout)
                    except StopAsyncIteration:
                        return
                    except Exception as e:
                        await stream.aclose()
                        # A fallback model may also reject the history (e.g. another model's
                        # thought signatures), so on fallbacks any client error moves on too.
                        if not (_transient(e) or (model != primary and isinstance(e, ClientError))):
                            raise
                        if isinstance(e, ClientError) and e.code == 429:
                            self._benched_until[model] = time.monotonic() + RATE_LIMIT_COOLDOWN_SECS
                        last_error = e
                        logger.warning(f"{model} unavailable ({getattr(e, 'code', None) or type(e).__name__})")
                        continue
                    if model != primary:
                        logger.info(f"Answered by fallback model {model}")
                    try:
                        yield first
                        async for chunk in stream:
                            yield chunk
                    finally:
                        await stream.aclose()
                    return
            logger.error(f"All Gemini models failed this turn: {last_error}")
            await self.push_frame(TTSSpeakFrame(APOLOGY))
        finally:
            # Every turn starts from the configured primary model again.
            self._settings.model = primary
