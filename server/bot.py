"""The voice agent: one Pipecat pipeline per browser call.

    mic -> SmallWebRTC in -> ElevenLabs STT -> user context (Silero VAD + Smart Turn)
        -> Gemini (3 tools, model failover) -> ElevenLabs TTS -> SmallWebRTC out -> speaker

Tool handlers read/write SQLite through db.py and push RTVI server messages so
the dashboard can update the moment a booking or cancellation happens.
"""

from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timedelta

from loguru import logger
from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import EndWorkerFrame, LLMRunFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.llm_service import FunctionCallParams, FunctionCallResultProperties
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

import db
from llm import FailoverGoogleLLMService

# ------------------------------------------------------------------ prompt


def system_prompt() -> str:
    today = date.today()
    week = ", ".join(
        f"{(today + timedelta(days=i)).strftime('%A')} = {(today + timedelta(days=i)).isoformat()}" for i in range(7)
    )
    return f"""You are Mira, the receptionist at Larkspur Clinic, answering a phone call.
Your words are converted to speech, so talk like a person on the phone: short sentences, no lists,
no markdown, no emojis. Never read out IDs, slot numbers or ISO dates.

Today is {today.strftime('%A %d %B %Y')}, time {datetime.now().strftime('%H:%M')}. The next seven days: {week}.

Doctors:
{db.roster_text()}

You can do three things: check availability, book an appointment, cancel an appointment.

Rules:
- Callers are identified ONLY by the phone number they say. Before EVERY booking and EVERY
  cancellation, read the 10-digit number back in groups (for example "nine eight seven six five,
  four three two one zero") as its own question, and wait for the caller to say yes. Do this even
  if they gave the number earlier in the call or say "same number". If they correct you, read the
  new number back again. Only then set caller_confirmed_number to true.
- Use check_doctor_availability before offering times; never invent slots. Offer two or three
  options at most, naturally ("Tuesday at ten or eleven in the morning").
- For a booking you also need the caller's name. The caller must choose the time themselves; never
  pick one for them. Confirm doctor, day and time in one sentence, then call book_appointment with
  the slot_id from the availability results.
- For a cancellation, call cancel_appointment with the confirmed number. If it reports several
  appointments, describe them and ask which one.
- If a tool returns an error, explain it plainly and offer the next best option.
- If the caller describes symptoms, suggest the matching specialist; do not give medical advice.
  For emergencies, tell them to call 112 right away.
- After finishing a task, ask if there is anything else. Keep the whole call brief and warm.
- When the caller has nothing else (they say bye, thanks, that's all), hang up by calling end_call
  with a short goodbye. Respond with only that function call: end_call speaks the goodbye itself,
  so don't also say it as text."""


# ------------------------------------------------------------------ tools

TOOLS = ToolsSchema(
    standard_tools=[
        FunctionSchema(
            name="check_doctor_availability",
            description="List open appointment slots. Filter by doctor name or specialty and/or a date. "
            "Call with no arguments to see every doctor's next open slots.",
            properties={
                "doctor": {
                    "type": "string",
                    "description": "Doctor name (e.g. 'Mehta') or specialty (e.g. 'cardiologist'). Optional.",
                },
                "date": {"type": "string", "description": "Date as YYYY-MM-DD. Optional."},
            },
            required=[],
        ),
        FunctionSchema(
            name="book_appointment",
            description="Book an open slot. Only call after the caller confirmed their phone number "
            "when you read it back, and agreed to the doctor, day and time.",
            properties={
                "slot_id": {"type": "integer", "description": "slot_id from check_doctor_availability."},
                "patient_name": {"type": "string", "description": "Caller's name."},
                "phone_number": {"type": "string", "description": "Confirmed 10-digit phone number, digits only."},
                "caller_confirmed_number": {
                    "type": "boolean",
                    "description": "True only if you just read the number back digit by digit and the caller said yes.",
                },
            },
            required=["slot_id", "patient_name", "phone_number", "caller_confirmed_number"],
        ),
        FunctionSchema(
            name="cancel_appointment",
            description="Cancel the caller's upcoming appointment, looked up by their confirmed phone number. "
            "Pass appointment_id only when the number has several appointments and the caller chose one.",
            properties={
                "phone_number": {"type": "string", "description": "Confirmed 10-digit phone number, digits only."},
                "appointment_id": {"type": "integer", "description": "Optional, to pick one of several."},
                "caller_confirmed_number": {
                    "type": "boolean",
                    "description": "True only if you just read the number back digit by digit and the caller said yes.",
                },
            },
            required=["phone_number", "caller_confirmed_number"],
        ),
        FunctionSchema(
            name="end_call",
            description="Say goodbye and hang up. Use when the caller has nothing else to ask.",
            properties={
                "goodbye": {"type": "string", "description": "One short goodbye line, spoken before hanging up."},
            },
            required=["goodbye"],
        ),
    ]
)


def _summary(name: str, result: dict) -> str:
    """One human line for the dashboard's agent log."""
    if result.get("error"):
        return result["error"]
    if name == "check_doctor_availability":
        found = sum(len(r["open_slots"]) for r in result["results"])
        who = result["results"][0]["doctor"] if len(result["results"]) == 1 else f"{len(result['results'])} doctors"
        return f"{found} open slot{'s' * (found != 1)} · {who}"
    if result.get("needs_choice"):
        return f"{len(result['appointments'])} appointments on this number, asked caller to choose"
    a = result["appointment"]
    verb = "Booked" if name == "book_appointment" else "Cancelled"
    return f"{verb} #{a['id']:04d} · {a['patient_name']} with {a['doctor']}, {a['spoken']}"


def make_handler(name: str, fn, worker_ref: dict):
    async def handler(params: FunctionCallParams):
        args = dict(params.arguments or {})
        call_id = params.tool_call_id or uuid.uuid4().hex
        rtvi = worker_ref["worker"].rtvi
        await rtvi.send_server_message({"type": "tool", "phase": "start", "id": call_id, "name": name, "args": args})
        try:
            result = fn(args)
        except Exception as e:  # never let a tool crash the call
            logger.exception(f"{name} failed")
            result = {"error": f"Something went wrong on our side ({type(e).__name__}). Please try again."}
        logger.info(f"{name}({args}) -> {_summary(name, result)}")
        await rtvi.send_server_message(
            {"type": "tool", "phase": "result", "id": call_id, "name": name, "ok": not result.get("error"), "summary": _summary(name, result)}
        )
        if result.get("ok"):
            action = "booked" if name == "book_appointment" else "cancelled"
            await rtvi.send_server_message({"type": "appointment", "action": action, "appointment": result["appointment"]})
        await params.result_callback(result)

    return handler


def make_end_call_handler(worker_ref: dict):
    async def handler(params: FunctionCallParams):
        goodbye = str((params.arguments or {}).get("goodbye") or "Thanks for calling. Goodbye!")
        rtvi = worker_ref["worker"].rtvi
        call_id = params.tool_call_id or uuid.uuid4().hex
        await rtvi.send_server_message({"type": "tool", "phase": "start", "id": call_id, "name": "end_call", "args": {}})
        await rtvi.send_server_message(
            {"type": "tool", "phase": "result", "id": call_id, "name": "end_call", "ok": True, "summary": "Agent hung up"}
        )
        logger.info("Agent is ending the call")
        # No follow-up LLM turn: speak the goodbye, then end. EndWorkerFrame travels behind the
        # goodbye audio, so the pipeline (and the WebRTC call) closes only after it has played.
        await params.result_callback({"ok": True}, properties=FunctionCallResultProperties(run_llm=False))
        await params.llm.push_frame(TTSSpeakFrame(goodbye))
        await params.llm.push_frame(EndWorkerFrame(reason="agent hung up"))

    return handler


def _int(v):
    return int(v) if v not in (None, "") else None


def _confirmed(fn):
    """Refuse to act on a number the caller hasn't confirmed out loud."""

    def run(a: dict) -> dict:
        if a.get("caller_confirmed_number") is not True:
            return {"error": "Not done yet: read the phone number back to the caller digit by digit and get a yes first."}
        return fn(a)

    return run


TOOL_FNS = {
    "check_doctor_availability": lambda a: db.availability(a.get("doctor") or None, a.get("date") or None),
    "book_appointment": _confirmed(
        lambda a: db.book(int(a["slot_id"]), str(a.get("patient_name", "")), str(a["phone_number"]))
    ),
    "cancel_appointment": _confirmed(lambda a: db.cancel(str(a["phone_number"]), _int(a.get("appointment_id")))),
}


# ------------------------------------------------------------------ pipeline


async def run_bot(connection: SmallWebRTCConnection) -> None:
    try:
        await _run(connection)
    except Exception:
        # Hang up instead of leaving the browser ringing on a dead line.
        logger.exception("Call failed")
        await connection.disconnect()


async def _run(connection: SmallWebRTCConnection) -> None:
    missing = [k for k in ("ELEVENLABS_API_KEY", "GOOGLE_API_KEY") if not os.getenv(k)]
    if missing:
        raise RuntimeError(f"Set {', '.join(missing)} in .env")

    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )

    doctor_terms = [d[1].replace("Dr. ", "") for d in db.DOCTORS]
    stt = ElevenLabsRealtimeSTTService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        settings=ElevenLabsRealtimeSTTService.Settings(keyterms=doctor_terms),
    )
    tts = ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        settings=ElevenLabsTTSService.Settings(
            voice=os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL"),
            model=os.getenv("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5"),
        ),
    )
    fallbacks = os.getenv("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash-lite,gemini-3.1-flash-lite")
    llm = FailoverGoogleLLMService(
        api_key=os.environ["GOOGLE_API_KEY"],
        fallback_models=[m.strip() for m in fallbacks.split(",") if m.strip()],
        settings=FailoverGoogleLLMService.Settings(
            model=os.getenv("GEMINI_MODEL", "gemini-3.6-flash"),
            system_instruction=system_prompt(),
        ),
    )

    worker_ref: dict = {}
    for name, fn in TOOL_FNS.items():
        llm.register_function(name, make_handler(name, fn, worker_ref))
    llm.register_function("end_call", make_end_call_handler(worker_ref))

    context = LLMContext(tools=TOOLS)
    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            aggregators.user(),
            llm,
            tts,
            transport.output(),
            aggregators.assistant(),
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        idle_timeout_secs=300,
    )
    worker_ref["worker"] = worker

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
        logger.info("Caller connected")
        context.add_message(
            {"role": "user", "content": "(The call has just connected. Greet the caller briefly as Mira from Larkspur Clinic and ask how you can help.)"}
        )
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        logger.info("Caller hung up")
        await worker.cancel()

    await PipelineRunner(handle_sigint=False).run(worker)
