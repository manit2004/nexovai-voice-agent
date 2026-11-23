# Larkspur: voice front desk

A voice agent that answers a clinic's phone: it checks doctor availability, books and cancels
appointments, and identifies the caller only by the phone number they say aloud. A dashboard
runs the call in the browser and shows every booking land as it happens.

| Part | Stack |
| --- | --- |
| Voice pipeline | [Pipecat](https://github.com/pipecat-ai/pipecat) 1.17 (Python), SmallWebRTC transport |
| Speech-to-text | ElevenLabs Scribe v2 Realtime (streaming) |
| LLM | **Google Gemini**: `gemini-3.6-flash`, failing over to `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` (free tier) |
| Text-to-speech | ElevenLabs `eleven_flash_v2_5`, voice "Sarah" (streaming WebSocket with word timestamps) |
| Turn-taking | Silero VAD + Smart Turn v3 |
| Data | SQLite (`server/clinic.db`, seeded with 5 doctors and 7 days of slots) |
| Frontend | React 19 + Vite + `@pipecat-ai/client-js` |

## Run it

You need Python 3.12+ with [uv](https://docs.astral.sh/uv/), Node 20+, an ElevenLabs API key
and a Gemini API key from [AI Studio](https://aistudio.google.com/apikey).

```bash
cp .env.example .env          # then fill in ELEVENLABS_API_KEY and GOOGLE_API_KEY

# 1. voice server on :7860
cd server
uv sync
uv run server.py              # add --reset to wipe and re-seed the demo data

# 2. dashboard on :5173 (new terminal)
cd web
npm install
npm run dev
```

Open http://localhost:5173, press **Try a call**, allow the microphone and talk.

> On a free ElevenLabs plan, use one of the default voices (the default here is Sarah,
> `EXAVITQu4vr4xnSDxMaL`). Voices from the voice library return 402 over the API, and the
> agent goes silent.

To serve the dashboard from the Python server instead: `cd web && npm run build`, then
open http://localhost:7860.

## How a call works

```
browser mic ──WebRTC──▶ SmallWebRTC input
                         │
                         ▼
               ElevenLabs STT (realtime)          keyterms = doctor names
                         │
                         ▼
        user context aggregator ◀── Silero VAD + Smart Turn decide when the caller is done
                         │
                         ▼
                 Gemini (function calling) ──▶ check_doctor_availability
                         │                     book_appointment      ──▶ SQLite
                         │                     cancel_appointment
                         ▼
               ElevenLabs TTS (streaming)
                         │
                         ▼
browser speaker ◀─WebRTC── SmallWebRTC output ──▶ assistant context aggregator
```

- **Signalling.** The browser posts its SDP offer to `POST /api/offer` (ICE candidates
  trickle in over `PATCH /api/offer`). Each new peer connection starts its own pipeline,
  so every call has its own context.
- **Tools.** The three tools are registered on the LLM service with `register_function`.
  Handlers call `server/db.py`, which validates the phone number (10 digits, `+91` or a
  leading `0` stripped) and the slot, and returns plain JSON the model can talk about.
- **Number confirmation.** The agent must read the number back in groups and get a "yes" before
  it books or cancels. This is in the prompt, and it's also enforced in code: both tools take a
  required `caller_confirmed_number` flag, and the handler refuses to act until it's true.
  Bookings use the `slot_id` returned by availability, so the model can't invent a time.
- **Gemini failover** ([server/llm.py](server/llm.py)). The free tier often returns 429/503/504.
  Left alone, that's dead air on a call. A small `GoogleLLMService` subclass retries the turn on
  the next model when a request fails before its first chunk. It benches a rate-limited model for
  60 s, makes a second pass after a short pause, and as a last resort says "Sorry, could you say
  that again?" so the caller never hears silence.
- **Live dashboard.** Pipecat's RTVI layer streams transcripts and speaking events to the
  browser over the WebRTC data channel. Tool handlers also push custom RTVI server messages
  (`tool` start/result and `appointment` booked/cancelled). The dashboard uses them to
  highlight the slot and ledger row, drop a confirmation ticket into the call transcript, and
  log the tool call.

## Tools

| Tool | Arguments | Behaviour |
| --- | --- | --- |
| `check_doctor_availability` | `doctor?` (name or specialty, lay terms like "skin" work), `date?` | Open future slots, up to 8 per doctor |
| `book_appointment` | `slot_id`, `patient_name`, `phone_number` | Marks the slot booked, creates the appointment |
| `cancel_appointment` | `phone_number`, `appointment_id?` | Cancels the caller's upcoming appointment and frees the slot. If the number has several, returns them so the agent can ask which |

## Dashboard

- Phone-style call screen with ringing, connected and ended states, a call timer, mute and end
  call. Ring, connect and hang-up tones are synthesised with WebAudio.
- Live waveform from the real audio: the agent in white, the caller in red.
- Live transcript. The agent's sentences fill in word by word as they are spoken, using
  ElevenLabs word timestamps, so text that was cut off by an interruption stays greyed out.
- A booking or cancellation ticket appears inside the call, and the matching slot and
  appointment row flash on the dashboard.
- Doctors by day with open and booked slots, the appointments ledger
  (upcoming, cancelled, all), and an agent log of every tool call with its arguments and
  result.
- Works on phones: below 560px the call takes the full screen.

## Layout

```
server/
  server.py   FastAPI: WebRTC signalling + REST for the dashboard
  bot.py      Pipecat pipeline, system prompt, tool schemas and handlers
  llm.py      Gemini service with model failover
  db.py       SQLite schema, seed data and the booking logic
web/src/
  useCall.ts  Pipecat client, transcript assembly, audio analysers
  App.tsx     dashboard layout and data refresh
  components/ Phone, Waveform, Roster, Ledger, ActivityLog
```
