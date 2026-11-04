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

  // rain splashes on the ground — additive point sprites that bloom into an expanding ring then die
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
  splashGeo.setAttribute('aLife', new THREE.BufferAttribute(splashLife, 1))
  const splashMat = new THREE.ShaderMaterial({
    uniforms: { uOp: { value: 0 } },
    vertexShader: `
      attribute float aLife;
      varying float vL;
      void main() {
        vL = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 26.0 * clamp(120.0 / max(0.001, -mv.z), 0.2, 3.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOp;
      varying float vL;
      void main() {
        float t = 1.0 - vL;                     // 0 birth -> 1 death
        float d = length(gl_PointCoord * 2.0 - 1.0);
        float a = smoothstep(0.35, 0.0, abs(d - (0.2 + 0.8 * t))) * vL * uOp;
        if (a < 0.02) discard;
        gl_FragColor = vec4(0.72, 0.83, 0.95, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
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
      splashMat.uniforms.uOp.value = amount * 0.9
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
      splashGeo.attributes.aLife.needsUpdate = true
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
