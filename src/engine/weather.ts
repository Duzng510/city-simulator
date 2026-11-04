import * as THREE from 'three'

const N = 3000
const BOX = 45

export function makeRain(streak: THREE.Texture, init = 0) {
  const pos = new Float32Array(N * 3)
  const vel = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * BOX
    pos[i * 3 + 1] = Math.random() * BOX
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * BOX
    vel[i] = 22 + Math.random() * 16
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({
    map: streak, transparent: true, opacity: 0, depthWrite: false, size: 0.95, sizeAttenuation: true, color: 0xd8e8ff,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.visible = false

  // rain splashes on the ground — tiny additive points that blink and die
  const SPLASH_N = 90
  const splashPos = new Float32Array(SPLASH_N * 3)
  const splashLife = new Float32Array(SPLASH_N)
  for (let i = 0; i < SPLASH_N; i++) {
    splashPos[i * 3] = (Math.random() * 2 - 1) * BOX
    splashPos[i * 3 + 1] = 0.02
    splashPos[i * 3 + 2] = (Math.random() * 2 - 1) * BOX
    splashLife[i] = Math.random()
  }
  const splashGeo = new THREE.BufferGeometry()
  splashGeo.setAttribute('position', new THREE.BufferAttribute(splashPos, 3))
  const splashMat = new THREE.PointsMaterial({
    size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0,
    depthWrite: false, color: 0xb8d4ec, blending: THREE.AdditiveBlending,
  })
  const splashes = new THREE.Points(splashGeo, splashMat)
  splashes.frustumCulled = false
  splashes.visible = false

  let amount = init
  let fuse = 4
  let frames = 0
  let flash = 0

  function update(dt: number, cam: THREE.Vector3, target: number) {
    amount += (target - amount) * Math.min(1, dt * 1.5)
    points.visible = amount > 0.01
    mat.opacity = amount * 0.8

    if (points.visible) {
      const wind = 3.5 * amount
      for (let i = 0; i < N; i++) {
        const x = i * 3
        pos[x] += wind * dt
        pos[x + 1] -= vel[i] * dt
        pos[x + 2] -= 2.2 * amount * dt
        // recycle in world space so the field has parallax against the city
        if (pos[x + 1] < cam.y - BOX * 0.55) pos[x + 1] += BOX
        if (pos[x] - cam.x > BOX) pos[x] -= BOX * 2
        else if (pos[x] - cam.x < -BOX) pos[x] += BOX * 2
        if (pos[x + 2] - cam.z > BOX) pos[x + 2] -= BOX * 2
        else if (pos[x + 2] - cam.z < -BOX) pos[x + 2] += BOX * 2
      }
      geo.attributes.position.needsUpdate = true
    }

    // splash particles at ground level
    if (amount > 0.2) {
      splashes.visible = true
      splashMat.opacity = amount * 0.55
      for (let i = 0; i < SPLASH_N; i++) {
        splashLife[i] -= dt * 2.5
        if (splashLife[i] <= 0) {
          splashLife[i] = 1
          splashPos[i * 3] = cam.x + (Math.random() * 2 - 1) * 22
          splashPos[i * 3 + 1] = 0.02 + Math.random() * 0.06
          splashPos[i * 3 + 2] = cam.z + (Math.random() * 2 - 1) * 22
        }
      }
      splashGeo.attributes.position.needsUpdate = true
    } else {
      splashes.visible = false
    }

    flash = 0
    if (amount > 0.5) {
      fuse -= dt * amount
      if (fuse <= 0) {
        fuse = 3 + Math.random() * 11
        frames = 2
      }
    }
    if (frames > 0) {
      frames--
      flash = 1 - frames * 0.45
    }
  }

  return { points, splashes, update, get amount() { return amount }, get flash() { return flash } }
}
