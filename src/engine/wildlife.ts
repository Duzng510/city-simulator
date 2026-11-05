import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { N, ROAD, line } from './city'
import type { Textures } from './textures'
import { rng } from './util'
import { boxAt, paint } from './geo'

// Chim, đom đóm, bồ câu, mèo: toàn bộ dùng stream rng riêng (seed + hằng số), không đụng stream
// `rand` của xe/ped, nên thứ tự build của chúng không ảnh hưởng layout phố.
export interface Wildlife {
  update: (dt: number, t: number, night: number, rain: number, px: number, pz: number) => void
}

export function makeWildlife(o: {
  group: THREE.Group
  tex: Textures
  seed: number
  parks: { x: number; z: number }[]
  alleys: { x: number; z: number; px: number; pz: number; py: number }[]
  meow: (x: number, z: number) => void
}): Wildlife {
  const { group, tex, seed, parks, alleys, meow } = o

  // ---- birds: two-triangle wings circling the parks, perching, and lifting off when you walk under
  const NBIRD = 14
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x22262b, side: THREE.DoubleSide })
  const wingGeo = (dir: number) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.24, 0, 0, 0.24, dir * 0.6, 0.05, 0]), 3))
    g.computeVertexNormals()
    return g
  }
  const wings: [THREE.InstancedMesh, number][] = [
    [new THREE.InstancedMesh(wingGeo(1), birdMat, NBIRD), 1],
    [new THREE.InstancedMesh(wingGeo(-1), birdMat, NBIRD), -1],
  ]
  for (const [m] of wings) {
    m.frustumCulled = false
    group.add(m)
  }
  const brnd = rng(seed + 991)
  const b = {
    home: new Int8Array(NBIRD), st: new Int8Array(NBIRD), a: new Float32Array(NBIRD), r: new Float32Array(NBIRD),
    w: new Float32Array(NBIRD), cy: new Float32Array(NBIRD), ph: new Float32Array(NBIRD), t: new Float32Array(NBIRD),
    g: new Float32Array(NBIRD), x: new Float32Array(NBIRD), z: new Float32Array(NBIRD), y: new Float32Array(NBIRD),
    hd: new Float32Array(NBIRD), vx: new Float32Array(NBIRD), vz: new Float32Array(NBIRD),
    sr: new Float32Array(NBIRD), sz: new Float32Array(NBIRD), px: new Float32Array(NBIRD), pz: new Float32Array(NBIRD),
  }
  for (let k = 0; k < NBIRD; k++) {
    const home = parks[k % parks.length]
    const pa = brnd() * Math.PI * 2
    const pr = 3 + brnd() * 9
    b.home[k] = k % parks.length
    b.px[k] = home.x + Math.cos(pa) * pr
    b.pz[k] = home.z + Math.sin(pa) * pr
    b.a[k] = pa
    b.r[k] = pr
    b.w[k] = (0.22 + brnd() * 0.28) * (brnd() < 0.5 ? -1 : 1)
    b.cy[k] = 4.5 + brnd() * 5
    b.ph[k] = brnd() * 9
    b.sr[k] = 6 + brnd() * 5
    b.sz[k] = 0.5 + brnd() * 0.35
    b.st[k] = brnd() < 0.5 ? 2 : 0
    b.t[k] = brnd() * 20
    b.g[k] = brnd() * 14
    b.x[k] = b.px[k]
    b.z[k] = b.pz[k]
    b.y[k] = b.st[k] === 2 ? 0.22 : b.cy[k]
  }

  // ---- fireflies: additive point clouds drifting over greenery after dusk (C8). One cloud
  // hovers the park trees, a wider one the roadside trees; shared shader, separate gate.
  const ffMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex.glow }, tint: { value: new THREE.Color(0xaeea5a) }, bright: { value: 0 }, t: { value: 0 } },
    vertexShader: `
      attribute float phase;
      uniform float t;
      varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(t * 0.6 + phase) * 0.6;
        p.y += sin(t * 0.9 + phase * 1.7) * 0.35;
        p.z += cos(t * 0.5 + phase) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = max(0.001, -mv.z);
        float tw = 0.5 + 0.5 * sin(t * 2.5 + phase * 4.0);
        gl_PointSize = clamp(120.0 / d, 2.0, 16.0) * (0.6 + 0.4 * tw);
        vA = tw * smoothstep(180.0, 8.0, d);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 tint;
      uniform float bright;
      varying float vA;
      void main() {
        float a = texture2D(map, gl_PointCoord).a * vA * bright;
        gl_FragColor = vec4(tint * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const frnd = rng(seed + 7331)
  const mkFlies = (homes: { x: number; z: number }[], n: number) => {
    const fp = new Float32Array(n * 3)
    const fphase = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      const home = homes[k % homes.length]
      const a = frnd() * Math.PI * 2
      const r = 2 + frnd() * 8
      fp[k * 3] = home.x + Math.cos(a) * r
      fp[k * 3 + 1] = 0.7 + frnd() * 1.8
      fp[k * 3 + 2] = home.z + Math.sin(a) * r
      fphase[k] = frnd() * Math.PI * 2
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(fp, 3))
    g.setAttribute('phase', new THREE.BufferAttribute(fphase, 1))
    const mat = ffMat.clone()
    const p = new THREE.Points(g, mat)
    p.frustumCulled = false
    p.renderOrder = 6
    p.visible = false
    group.add(p)
    return { p, mat }
  }
  // roadside trees sit at the four corners of every block — reuse that grid for street fireflies
  const streetHomes: { x: number; z: number }[] = []
  for (let i = 0; i < N - 1; i++)
    for (let j = 0; j < N - 1; j++)
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const)
        if (frnd() < 0.45)
          streetHomes.push({
            x: dx > 0 ? line(i) + ROAD / 2 + 2.2 : line(i + 1) - ROAD / 2 - 2.2,
            z: dz > 0 ? line(j) + ROAD / 2 + 2.2 : line(j + 1) - ROAD / 2 - 2.2,
          })
  const parkFlies = mkFlies(parks.length ? parks : [{ x: 0, z: 0 }], 26)
  const streetFlies = mkFlies(streetHomes.length ? streetHomes : [{ x: 0, z: 0 }], 30)

  // ---- pigeons: a few ground birds on the plaza that scatter when you approach
  const NPIG = 7
  const pigMat = new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.9 })
  const pigeons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 7, 5), pigMat, NPIG)
  pigeons.frustumCulled = false
  group.add(pigeons)
  const prnd = rng(seed + 1207)
  const pig = {
    home: new Int8Array(NPIG), st: new Int8Array(NPIG), g: new Float32Array(NPIG),
    x: new Float32Array(NPIG), y: new Float32Array(NPIG), z: new Float32Array(NPIG),
    bx: new Float32Array(NPIG), bz: new Float32Array(NPIG), hd: new Float32Array(NPIG),
    vx: new Float32Array(NPIG), vz: new Float32Array(NPIG), ph: new Float32Array(NPIG), sz: new Float32Array(NPIG),
  }
  for (let k = 0; k < NPIG; k++) {
    const home = parks[k % parks.length]
    const a = prnd() * Math.PI * 2
    const r = 1 + prnd() * 5
    pig.home[k] = k % parks.length
    pig.bx[k] = home.x + Math.cos(a) * r
    pig.bz[k] = home.z + Math.sin(a) * r
    pig.x[k] = pig.bx[k]
    pig.z[k] = pig.bz[k]
    pig.y[k] = 0.18
    pig.hd[k] = prnd() * Math.PI * 2
    pig.ph[k] = prnd() * 9
    pig.sz[k] = 0.8 + prnd() * 0.4
    pig.g[k] = prnd() * 18
  }

  // ---- alley cats: small box critters that perch on the dumpster lid when you approach
  const NCAT = alleys.length
  const cat = {
    st: new Int8Array(NCAT), g: new Float32Array(NCAT),
    x: new Float32Array(NCAT), y: new Float32Array(NCAT), z: new Float32Array(NCAT),
    hx: new Float32Array(NCAT), hz: new Float32Array(NCAT),
    px: new Float32Array(NCAT), py: new Float32Array(NCAT), pz: new Float32Array(NCAT),
    hd: new Float32Array(NCAT), sz: new Float32Array(NCAT),
  }
  const crnd = rng(seed + 4409)
  for (let k = 0; k < NCAT; k++) {
    const a = alleys[k]
    cat.hx[k] = a.x; cat.hz[k] = a.z; cat.x[k] = a.x; cat.z[k] = a.z; cat.y[k] = 0.16
    cat.px[k] = a.px; cat.pz[k] = a.pz; cat.py[k] = a.py
    cat.hd[k] = Math.atan2(a.x - a.px, a.z - a.pz)
    cat.sz[k] = 0.85 + crnd() * 0.35
  }
  const fur = new THREE.Color(0x2f3540)
  const catGeo = mergeGeometries(
    [
      paint(boxAt(0.16, 0.22, 0.42, 0, 0.24, 0), fur),
      paint(boxAt(0.18, 0.16, 0.16, 0, 0.36, 0.24), fur),
      paint(mergeGeometries([boxAt(0.05, 0.07, 0.02, -0.06, 0.48, 0.24), boxAt(0.05, 0.07, 0.02, 0.06, 0.48, 0.24)], false)!, fur),
      paint(boxAt(0.05, 0.05, 0.28, 0, 0.3, -0.32), fur),
      paint(mergeGeometries([boxAt(0.04, 0.2, 0.04, -0.06, 0.1, 0.14), boxAt(0.04, 0.2, 0.04, 0.06, 0.1, 0.14), boxAt(0.04, 0.2, 0.04, -0.06, 0.1, -0.14), boxAt(0.04, 0.2, 0.04, 0.06, 0.1, -0.14)], false)!, new THREE.Color(0x232833)),
    ],
    false,
  )!
  const catMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
  const cats = new THREE.InstancedMesh(catGeo, catMat, Math.max(1, NCAT))
  cats.frustumCulled = false
  cats.castShadow = true
  cats.count = NCAT
  group.add(cats)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd36b, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  const eyes = new THREE.InstancedMesh(
    mergeGeometries([boxAt(0.05, 0.05, 0.02, -0.06, 0, 0.1), boxAt(0.05, 0.05, 0.02, 0.06, 0, 0.1)], false)!,
    eyeMat,
    Math.max(1, NCAT),
  )
  eyes.frustumCulled = false
  eyes.count = NCAT
  eyes.renderOrder = 6
  group.add(eyes)

  // scratch riêng của wildlife: cấp phát một lần lúc build, không phát sinh trong update
  const pos = new THREE.Vector3()
  const sc = new THREE.Vector3(1, 1, 1)
  const one = new THREE.Vector3(1, 1, 1)
  const q = new THREE.Quaternion()
  const q2 = new THREE.Quaternion()
  const qd = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const rollAxis = new THREE.Vector3(0, 0, 1)
  const m4 = new THREE.Matrix4()

  function update(dt: number, t: number, night: number, rain: number, px: number, pz: number) {
    // birds: 0 circle, 1 flee, 2 perch, 3 home in for a landing
    for (let k = 0; k < NBIRD; k++) {
      const home = parks[b.home[k]]
      const ox = b.x[k], oz = b.z[k]
      b.t[k] += dt
      b.g[k] += dt
      const near = Math.hypot(px - b.x[k], pz - b.z[k])
      if (b.st[k] === 0) {
        b.a[k] += b.w[k] * dt
        b.x[k] = home.x + Math.cos(b.a[k]) * b.r[k]
        b.z[k] = home.z + Math.sin(b.a[k]) * b.r[k]
        b.y[k] = b.cy[k] + Math.sin(b.t[k] * 0.8 + b.ph[k]) * 0.6
      } else if (b.st[k] === 1) {
        b.x[k] += b.vx[k] * dt
        b.z[k] += b.vz[k] * dt
        b.y[k] = Math.min(17, b.y[k] + 4.5 * dt)
        if (b.g[k] > 4) { b.st[k] = 3; b.g[k] = 0 }
      } else if (b.st[k] === 3) {
        const dx = b.px[k] - b.x[k], dz = b.pz[k] - b.z[k], dy = 0.22 - b.y[k]
        const d = Math.hypot(dx, dy, dz)
        if (d < 0.7) { b.st[k] = 2; b.g[k] = 0 }
        else {
          const s = 7 * dt / d
          b.x[k] += dx * s
          b.z[k] += dz * s
          b.y[k] += dy * s
        }
      } else {
        b.y[k] = 0.22
        if (b.g[k] > 12 + b.ph[k]) { b.st[k] = 0; b.g[k] = 0 }
      }
      if ((b.st[k] === 0 && near < b.sr[k]) || (b.st[k] === 2 && near < b.sr[k] * 0.7)) {
        const ang = Math.atan2(b.x[k] - px, b.z[k] - pz) + (b.ph[k] - 4.5) * 0.12
        b.st[k] = 1
        b.g[k] = 0
        b.vx[k] = Math.sin(ang) * 10
        b.vz[k] = Math.cos(ang) * 10
      }
      const mx = b.x[k] - ox, mz = b.z[k] - oz
      if (mx * mx + mz * mz > 1e-7) b.hd[k] = Math.atan2(mx, mz)
      const flap = b.st[k] === 2 ? 0.05 : Math.sin(b.t[k] * (9 + b.sz[k] * 8) + b.ph[k]) * 0.55
      q.setFromAxisAngle(up, b.hd[k])
      pos.set(b.x[k], b.y[k], b.z[k])
      for (const [m, sgn] of wings) {
        qd.copy(q).multiply(q2.setFromAxisAngle(rollAxis, flap * sgn))
        m4.compose(pos, qd, sc.setScalar(b.sz[k]))
        m.setMatrixAt(k, m4)
      }
    }
    for (const [m] of wings) m.instanceMatrix.needsUpdate = true

    // fireflies: drift the whole cloud by feeding time to the shader; brighten only well after dusk.
    // Street flies want a clearer, calmer summer night than the park ones (C8).
    parkFlies.mat.uniforms.t.value = t
    parkFlies.mat.uniforms.bright.value = night > 0.5 ? (night - 0.5) * 2 : 0
    parkFlies.p.visible = night > 0.5
    streetFlies.mat.uniforms.t.value = t
    const streetOn = night > 0.6 && rain < 0.2
    streetFlies.mat.uniforms.bright.value = streetOn ? (night - 0.6) * 2.5 : 0
    streetFlies.p.visible = streetOn

    // pigeons: perch on the plaza, scatter when you walk under, respawn after a pause
    for (let k = 0; k < NPIG; k++) {
      pig.g[k] += dt
      if (pig.st[k] === 0) {
        if (Math.hypot(px - pig.x[k], pz - pig.z[k]) < 3) {
          const ang = Math.atan2(pig.x[k] - px, pig.z[k] - pz) + (pig.ph[k] - 4.5) * 0.1
          pig.st[k] = 1
          pig.g[k] = 0
          pig.vx[k] = Math.sin(ang) * 7
          pig.vz[k] = Math.cos(ang) * 7
        }
      } else if (pig.st[k] === 1) {
        pig.x[k] += pig.vx[k] * dt
        pig.z[k] += pig.vz[k] * dt
        pig.y[k] = Math.min(16, pig.y[k] + 5 * dt)
        if (pig.g[k] > 1.1) { pig.st[k] = 2; pig.g[k] = 0 }
      } else if (pig.st[k] === 2 && pig.g[k] > 20) {
        pig.st[k] = 0
        pig.g[k] = 0
        pig.x[k] = pig.bx[k]
        pig.z[k] = pig.bz[k]
        pig.y[k] = 0.18
      }
      const vis = pig.st[k] === 2 ? 0 : 1
      pos.set(pig.x[k], pig.y[k], pig.z[k])
      q.setFromAxisAngle(up, pig.hd[k])
      m4.compose(pos, q, sc.setScalar(vis ? pig.sz[k] : 0))
      pigeons.setMatrixAt(k, m4)
    }
    pigeons.instanceMatrix.needsUpdate = true

    // alley cats: idle by the dumpster, dart up onto the lid when you get close, hop back down after a while
    for (let k = 0; k < NCAT; k++) {
      const c = cat
      const near = Math.hypot(px - c.x[k], pz - c.z[k])
      if (c.st[k] === 0) {
        if (near < 4) { c.st[k] = 1; c.g[k] = 0; meow(c.x[k], c.z[k]) }
      } else if (c.st[k] === 1) {
        const s = Math.min(1, dt * 6)
        c.x[k] += (c.px[k] - c.x[k]) * s
        c.z[k] += (c.pz[k] - c.z[k]) * s
        c.y[k] += (c.py[k] - c.y[k]) * s
        if (Math.hypot(c.px[k] - c.x[k], c.py[k] - c.y[k], c.pz[k] - c.z[k]) < 0.12) { c.st[k] = 2; c.g[k] = 0 }
      } else if (c.st[k] === 2) {
        c.g[k] += dt
        c.y[k] = c.py[k] + Math.sin(t * 1.6 + k) * 0.01
        if (c.g[k] > 15 && near > 6) { c.st[k] = 3; c.g[k] = 0 }
      } else {
        const s = Math.min(1, dt * 5)
        c.x[k] += (c.hx[k] - c.x[k]) * s
        c.z[k] += (c.hz[k] - c.z[k]) * s
        c.y[k] += (0.16 - c.y[k]) * s
        if (Math.hypot(c.hx[k] - c.x[k], c.hz[k] - c.z[k]) < 0.12) { c.st[k] = 0; c.y[k] = 0.16 }
      }
      const mvx = c.px[k] - c.x[k], mvz = c.pz[k] - c.z[k]
      if (c.st[k] !== 2 && mvx * mvx + mvz * mvz > 1e-4) c.hd[k] = Math.atan2(mvx, mvz)
      pos.set(c.x[k], c.y[k], c.z[k])
      q.setFromAxisAngle(up, c.hd[k])
      m4.compose(pos, q, one)
      cats.setMatrixAt(k, m4)
      // two additive eye points just ahead of the head, only after dusk
      const glow = night > 0.4 ? 1 : 0
      pos.set(c.x[k], c.y[k] + 0.14, c.z[k])
      q.setFromAxisAngle(up, c.hd[k])
      m4.compose(pos, q, sc.setScalar(glow * c.sz[k]))
      eyes.setMatrixAt(k, m4)
    }
    cats.instanceMatrix.needsUpdate = true
    eyes.instanceMatrix.needsUpdate = true
    eyes.visible = night > 0.4
  }

  return { update }
}
