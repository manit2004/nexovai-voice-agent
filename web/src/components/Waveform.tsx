import { useEffect, useRef } from 'react'
import type { CallApi } from '../useCall'

const BARS = 36

/**
 * Mirrored bar waveform drawn from the live mic and agent audio. The agent's
 * voice is drawn in paper white, the caller's in vermilion on top of it.
 */
export function Waveform({ analysers, active }: { analysers: CallApi['analysers']; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth
    const h = el.clientHeight
    el.width = w * dpr
    el.height = h * dpr
    ctx.scale(dpr, dpr)

    const buf = new Uint8Array(128)
    const smooth = { local: new Float32Array(BARS), remote: new Float32Array(BARS) }
    let raf = 0
    let t = 0

    const levels = (an: AnalyserNode | null, out: Float32Array) => {
      if (an) an.getByteFrequencyData(buf)
      for (let i = 0; i < BARS; i++) {
        // Map bars onto the voice band (first ~half of bins), centre-weighted.
        const bin = Math.floor(2 + (i / BARS) * 44)
        const v = an ? buf[bin] / 255 : 0
        out[i] += (v - out[i]) * 0.35
      }
    }

    const draw = () => {
      t += 0.03
      const { local, remote } = analysers.current
      levels(remote, smooth.remote)
      levels(local, smooth.local)
      ctx.clearRect(0, 0, w, h)
      const gap = 3
      const bw = (w - gap * (BARS - 1)) / BARS
      const mid = h / 2
      // Bars are mirrored around the centre so the shape reads as a voice, not a spectrum.
      const order = (i: number) => Math.abs(i - (BARS - 1) / 2) / (BARS / 2)
      for (const [arr, color] of [
        [smooth.remote, 'rgba(243,239,230,0.92)'],
        [smooth.local, 'rgba(228,87,46,0.95)'],
      ] as const) {
        ctx.fillStyle = color
        for (let i = 0; i < BARS; i++) {
          const k = Math.floor(order(i) * (BARS / 2)) * 2
          const idle = active ? 0.04 + 0.025 * Math.sin(t * 2 + i * 0.5) : 0.02
          const isAgent = arr === smooth.remote
          const v = Math.max(arr[Math.min(k, BARS - 1)] * (1 - order(i) * 0.55), isAgent ? idle : 0)
          if (!isAgent && v < 0.03) continue // caller layer only shows while they speak
          const bh = Math.max(2, v * h * 0.95)
          const x = i * (bw + gap)
          ctx.beginPath()
          ctx.roundRect(x, mid - bh / 2, bw, bh, bw / 2)
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [analysers, active])

  return <canvas ref={canvas} className="wave" aria-hidden />
}
