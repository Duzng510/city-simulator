import * as THREE from 'three'

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

// 7–9h and 17–19h peak at 1, off-peak at 0
export const rushHour = (h: number) =>
  Math.max(
    smooth(6.5, 8.0, h) - smooth(9.0, 10.5, h),
    smooth(16.0, 17.5, h) - smooth(18.5, 20.0, h),
  )

// Dispose helpers: hot reload + open/close menu must not accumulate GPU memory, so every material
// texture and every scene-graph subtree has to be torn down explicitly. THREE's renderer.dispose()
// doesn't reach textures owned by shaders, and the composer's own dispose misses GTAO/Bloom RTs.
export function disposeTexture(t: THREE.Texture | null | undefined) {
  if (t) t.dispose()
}

export function disposeMaterial(m: THREE.Material | THREE.Material[]) {
  const list = Array.isArray(m) ? m : [m]
  for (const mat of list) {
    const rec = mat as unknown as Record<string, unknown>
    for (const key in rec) {
      const v = rec[key]
      if (v instanceof THREE.Texture) v.dispose()
    }
    mat.dispose()
  }
}

export function disposeObject3D(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) disposeMaterial(mesh.material)
  })
}

// textures.ts returns an object with a mix of Texture, Texture[], and { map, emissive, interior }
// tiles; walk generically so new entries don't need a matching dispose branch.
export function disposeTextureTree(v: unknown) {
  if (v instanceof THREE.Texture) { v.dispose(); return }
  if (Array.isArray(v)) { for (const x of v) disposeTextureTree(x); return }
  if (v && typeof v === 'object') {
    for (const k in v) disposeTextureTree((v as Record<string, unknown>)[k])
  }
}
