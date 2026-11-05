import * as THREE from 'three'

// Helpers dựng geometry bằng vertex color, dùng cho mọi module nội dung (entities, wildlife).
// Tách khỏi entities.ts để wildlife không phải import ngược entities (tránh cycle).

export const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
  const n = g.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r
    a[i * 3 + 1] = c.g
    a[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}

export const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}
