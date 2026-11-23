export type Slot = { id: number; starts_at: string; booked: boolean }

export type Doctor = {
  id: string
  name: string
  specialty: string
  room: string
  slots: Slot[]
}

export type Appointment = {
  id: number
  slot_id: number
  patient_name: string
  phone: string
  status: 'booked' | 'cancelled'
  created_at: string
  cancelled_at: string | null
  starts_at: string
  doctor_id: string
  doctor: string
  specialty: string
  room: string
  spoken: string
}

/** Messages the bot pushes over the RTVI data channel (see server/bot.py). */
export type ServerEvent =
  | { type: 'tool'; phase: 'start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool'; phase: 'result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'appointment'; action: 'booked' | 'cancelled'; appointment: Appointment }

/** One TTS sentence: `spoken` has been said aloud, `rest` is still to come. */
export type Seg = { id: string; spoken: string; rest: string }

export type Line =
  | { kind: 'user'; id: string; text: string; pending: string }
  | { kind: 'bot'; id: string; segs: Seg[] }
  | { kind: 'card'; id: string; action: 'booked' | 'cancelled'; appointment: Appointment }

export type Activity = {
  id: string
  at: Date
  name: string
  args: Record<string, unknown>
  status: 'running' | 'ok' | 'error'
  summary?: string
}

export type CallStatus = 'idle' | 'ringing' | 'live' | 'ended' | 'failed'
