import { useCallback, useEffect, useRef, useState } from 'react'
import { PipecatClient, type BotOutputData, type UserInputData } from '@pipecat-ai/client-js'
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport'
import type { Activity, CallStatus, Line, ServerEvent } from './types'
import { playConnected, playHangup, startRingback } from './sounds'

type Options = { onEvent?: (e: ServerEvent) => void }

let seq = 0
const uid = () => `${Date.now().toString(36)}-${seq++}`

/**
 * Owns one Pipecat client per call: WebRTC connection, transcript assembly,
 * tool-call activity and the analysers that drive the waveform.
 */
export function useCall({ onEvent }: Options = {}) {
  const [status, setStatus] = useState<CallStatus>('idle')
  const [lines, setLines] = useState<Line[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [muted, setMuted] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endedAt, setEndedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState<'user' | 'bot' | null>(null)

  const client = useRef<PipecatClient | null>(null)
  const stopRing = useRef<(() => void) | null>(null)
  const userHungUp = useRef(false)
  const audioEl = useRef<HTMLAudioElement | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const analysers = useRef<{ local: AnalyserNode | null; remote: AnalyserNode | null }>({ local: null, remote: null })
  const eventRef = useRef(onEvent)
  useEffect(() => {
    eventRef.current = onEvent
  }, [onEvent])

  const attachAnalyser = (track: MediaStreamTrack, which: 'local' | 'remote') => {
    const ctx = (audioCtx.current ??= new AudioContext())
    void ctx.resume()
    const src = ctx.createMediaStreamSource(new MediaStream([track]))
    const an = ctx.createAnalyser()
    an.fftSize = 256
    an.smoothingTimeConstant = 0.75
    src.connect(an)
    analysers.current[which] = an
  }

  const pushUser = (d: UserInputData) => {
    if (d.input_type && d.input_type !== 'transcription') return
    if (!d.text?.trim()) return
    setLines((prev) => {
      const last = prev[prev.length - 1]
      // Within one turn: final segments accumulate in `text`, the interim one sits in `pending`.
      if (last?.kind === 'user') {
        const next = d.final
          ? { ...last, text: `${last.text} ${d.text}`.trim(), pending: '' }
          : { ...last, pending: d.text }
        return [...prev.slice(0, -1), next]
      }
      return [...prev, { kind: 'user', id: uid(), text: d.final ? d.text : '', pending: d.final ? '' : d.text }]
    })
  }

  const pushBot = (d: BotOutputData) => {
    const type = d.output_type ?? d.aggregated_by ?? 'sentence'
    if (type === 'word' || type === 'token' || type === 'backchannel' || type.startsWith('expression')) return
    if (!d.text?.trim()) return
    // Each sentence arrives once as "new", then again per spoken word with progress,
    // which lets the bubble fill in as the agent talks.
    const seg = {
      id: d.segment_id != null ? String(d.segment_id) : uid(),
      spoken: d.spoken_progress?.accumulated_text ?? (d.spoken_status === 'new' && d.will_be_spoken ? '' : d.text),
      rest: d.spoken_progress?.remaining_text ?? (d.spoken_status === 'new' && d.will_be_spoken ? d.text : ''),
    }
    setLines((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const l = prev[i]
        if (l.kind === 'bot' && l.segs.some((s) => s.id === seg.id)) {
          const next = [...prev]
          next[i] = { ...l, segs: l.segs.map((s) => (s.id === seg.id ? seg : s)) }
          return next
        }
      }
      const last = prev[prev.length - 1]
      if (last?.kind === 'bot') return [...prev.slice(0, -1), { ...last, segs: [...last.segs, seg] }]
      return [...prev, { kind: 'bot', id: uid(), segs: [seg] }]
    })
  }

  const handleServer = (data: ServerEvent) => {
    if (data.type === 'tool' && data.phase === 'start') {
      setActivity((a) => [{ id: data.id, at: new Date(), name: data.name, args: data.args, status: 'running' }, ...a])
    } else if (data.type === 'tool' && data.phase === 'result') {
      setActivity((a) =>
        a.map((x) => (x.id === data.id ? { ...x, status: data.ok ? 'ok' : 'error', summary: data.summary } : x)),
      )
    } else if (data.type === 'appointment') {
      setLines((prev) => [...prev, { kind: 'card', id: uid(), action: data.action, appointment: data.appointment }])
    }
    eventRef.current?.(data)
  }

  const teardown = useCallback(() => {
    stopRing.current?.()
    stopRing.current = null
    if (audioEl.current) audioEl.current.srcObject = null
    void audioCtx.current?.close()
    audioCtx.current = null
    analysers.current = { local: null, remote: null }
    setSpeaking(null)
  }, [])

  const start = useCallback(async () => {
    if (client.current) return
    setLines([])
    setError(null)
    setMuted(false)
    setStartedAt(null)
    setEndedAt(null)
    userHungUp.current = false
    setStatus('ringing')
    stopRing.current = startRingback()

    const pc = new PipecatClient({
      transport: new SmallWebRTCTransport(),
      enableMic: true,
      enableCam: false,
      callbacks: {
        onBotReady: () => {
          stopRing.current?.()
          stopRing.current = null
          playConnected()
          setStartedAt(Date.now())
          setStatus('live')
        },
        onTrackStarted: (track, participant) => {
          if (track.kind !== 'audio') return
          if (participant?.local) {
            attachAnalyser(track, 'local')
          } else {
            audioEl.current ??= Object.assign(document.createElement('audio'), { autoplay: true })
            audioEl.current.srcObject = new MediaStream([track])
            attachAnalyser(track, 'remote')
          }
        },
        onUserStartedSpeaking: () => setSpeaking('user'),
        onUserStoppedSpeaking: () => setSpeaking((s) => (s === 'user' ? null : s)),
        onBotStartedSpeaking: () => setSpeaking('bot'),
        onBotStoppedSpeaking: () => setSpeaking((s) => (s === 'bot' ? null : s)),
        onUserInput: pushUser,
        onBotOutput: pushBot,
        onServerMessage: handleServer,
        onDisconnected: () => {
          if (!client.current) return
          client.current = null
          teardown()
          playHangup()
          setEndedAt(Date.now())
          // Dropped before the agent answered (and not by us) counts as a failed call.
          setStatus((s) => (s === 'ringing' && !userHungUp.current ? 'failed' : 'ended'))
        },
      },
    })
    client.current = pc

    try {
      await pc.connect({ webrtcRequestParams: { endpoint: '/api/offer' } })
    } catch (e) {
      client.current = null
      teardown()
      setError(e instanceof Error ? e.message : 'Could not reach the voice server')
      setStatus('failed')
      void pc.disconnect().catch(() => {})
    }
  }, [teardown])

  const hangup = useCallback(async () => {
    const pc = client.current
    if (!pc) return
    userHungUp.current = true
    await pc.disconnect().catch(() => {})
    // onDisconnected normally does the rest; cover transports that don't fire it.
    if (client.current) {
      client.current = null
      teardown()
      playHangup()
      setEndedAt(Date.now())
      setStatus('ended')
    }
  }, [teardown])

  const toggleMute = useCallback(() => {
    const pc = client.current
    if (!pc) return
    setMuted((m) => {
      pc.enableMic(m)
      return !m
    })
  }, [])

  // Only a finished call can be cleared; a new call started meanwhile is left alone.
  const reset = useCallback(() => setStatus((s) => (s === 'ended' || s === 'failed' ? 'idle' : s)), [])

  useEffect(() => () => void client.current?.disconnect(), [])

  return { status, lines, activity, muted, startedAt, endedAt, error, speaking, analysers, start, hangup, toggleMute, reset }
}

export type CallApi = ReturnType<typeof useCall>
