/**
 * Best-effort WebGL availability check for the Batuta live activity panel: a
 * real 3D scene needs WebGL2 (falls back to WebGL1), a canvas that fails both
 * gets the sober 2D panel instead.
 */
export function detectGpuSupport(): boolean {
  if (typeof document === "undefined") return false
  try {
    const canvas = document.createElement("canvas")
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl")
    return !!gl
  } catch {
    return false
  }
}
