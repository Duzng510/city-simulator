import type { Sim } from './types'
import type { Quality } from './quality'
import type { Timeline } from './timeline'

// One-shot oversized render for the gallery / headless verify harness: the loop pauses itself for a
// frame, draws at the requested size, and hands back a data URL.
export function makeCapture(canvas: HTMLCanvasElement, sim: Sim, quality: Quality, timeline: Timeline) {
  let pending: { w: number; h: number; resolve: (s: string) => void } | null = null

  function request(w: number, h: number) {
    return new Promise<string>((resolve) => {
      pending = { w, h, resolve }
    })
  }

  // returns true when the frame was consumed by a capture
  function run(): boolean {
    if (!pending) return false
    const { w, h, resolve } = pending
    pending = null
    quality.oversize(w, h)
    if (!sim.inside) timeline.skyFor(sim.hour)
    quality.render(0)
    resolve(canvas.toDataURL('image/png'))
    quality.resize()
    return true
  }

  return { request, run }
}

export type Capture = ReturnType<typeof makeCapture>
