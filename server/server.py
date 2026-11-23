"""HTTP side of the app.

- /api/offer        WebRTC signalling for the browser call (POST offer, PATCH ICE candidates).
                    Each new peer connection gets its own bot pipeline (bot.run_bot).
- /api/schedule     doctors with all their slots, for the dashboard grid
- /api/appointments every appointment, booked and cancelled
- /api/reset        re-seed the demo data

If the frontend has been built (web/dist), it is served from / as well.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

import uvicorn  # noqa: E402
from fastapi import BackgroundTasks, FastAPI  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from loguru import logger  # noqa: E402
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection  # noqa: E402
from pipecat.transports.smallwebrtc.request_handler import (  # noqa: E402
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)

import db  # noqa: E402
from bot import run_bot  # noqa: E402

REQUIRED_ENV = ("ELEVENLABS_API_KEY", "GOOGLE_API_KEY")

webrtc = SmallWebRTCRequestHandler()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    missing = [k for k in REQUIRED_ENV if not os.getenv(k)]
    if missing:
        logger.warning(f"Missing in .env: {', '.join(missing)}. Calls will fail until they are set.")
    db.init()
    yield
    await webrtc.close()


app = FastAPI(title="Larkspur voice agent", lifespan=lifespan)


@app.post("/api/offer")
async def offer(request: SmallWebRTCRequest, background_tasks: BackgroundTasks):
    async def on_connection(connection: SmallWebRTCConnection):
        background_tasks.add_task(run_bot, connection)

    return await webrtc.handle_web_request(request=request, webrtc_connection_callback=on_connection)


@app.patch("/api/offer")
async def ice_candidate(request: SmallWebRTCPatchRequest):
    await webrtc.handle_patch_request(request)
    return {"status": "success"}


@app.get("/api/schedule")
async def schedule():
    return await asyncio.to_thread(db.schedule)


@app.get("/api/appointments")
async def appointments():
    return await asyncio.to_thread(db.list_appointments)


@app.post("/api/reset")
async def reset():
    await asyncio.to_thread(db.init, True)
    return {"status": "reset"}


DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="web")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("--reset", action="store_true", help="wipe and re-seed the demo database")
    args = parser.parse_args()
    if args.reset:
        db.init(reset=True)
    uvicorn.run(app, host=args.host, port=args.port)
