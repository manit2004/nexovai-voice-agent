// Call sounds are synthesised with WebAudio, so there are no audio assets to ship.

let ctx: AudioContext | null = null
const ac = () => (ctx ??= new AudioContext())

function tone(freqs: number[], start: number, dur: number, gain = 0.06) {
  const c = ac()
  const g = c.createGain()
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(gain, start + 0.02)
  g.gain.setValueAtTime(gain, start + dur - 0.03)
  g.gain.linearRampToValueAtTime(0, start + dur)
  g.connect(c.destination)
  for (const f of freqs) {
    const o = c.createOscillator()
    o.frequency.value = f
    o.connect(g)
    o.start(start)
    o.stop(start + dur)
  }
}

/** Indian-style ringback: 375+425 Hz, 0.4s on, 0.2s off, 0.4s on, 2s off. */
export function startRingback(): () => void {
  const c = ac()
  void c.resume()
  let stopped = false
  let timer = 0
  const cycle = () => {
    if (stopped) return
    const t = c.currentTime + 0.05
    tone([375, 425], t, 0.4)
    tone([375, 425], t + 0.6, 0.4)
    timer = window.setTimeout(cycle, 3000)
  }
  cycle()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

export function playConnected() {
  const t = ac().currentTime + 0.02
  tone([880], t, 0.09, 0.05)
  tone([1320], t + 0.11, 0.14, 0.05)
}

export function playHangup() {
  const t = ac().currentTime + 0.02
  for (let i = 0; i < 3; i++) tone([620], t + i * 0.32, 0.2, 0.05)
}
