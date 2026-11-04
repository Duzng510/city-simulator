import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CELL, HALF, N, ROAD, line } from './city'
import type { Door } from './city'
import type { Textures } from './textures'
import { rng, rushHour, clamp, lerp } from './util'

const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
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

const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

const CARS = 96
const PEDS = 220
const NB = 3, NV = 5 // 3 bus lines + 2 delivery trucks, all in car slots 0..4

export interface Entities {
  group: THREE.Group
  update: (dt: number, t: number, hour: number, night: number, rain: number, px: number, pz: number, walking: boolean, pedBoost?: number) => void
  onHonk: (fn: (x: number, z: number) => void) => void
  tryEnter: (x: number, z: number, maxR: number) => { x: number; z: number; h: number } | null
  drive: (x: number, z: number, h: number, roll?: number, pitch?: number, brake?: number) => void
  park: (x: number, z: number, h: number) => void
  talkNearest: (x: number, z: number, maxR: number) => boolean
  busHorn: () => boolean
  onMeow: (fn: (x: number, z: number) => void) => void
  pedWorld: () => { px: Float32Array; pz: Float32Array; n: number }
  carWorld: () => { x: Float32Array; z: Float32Array; n: number }
  carPush: (v: THREE.Vector3) => void
}

export function buildEntities(tex: Textures, seed = 5150, doors: Door[] = [], parks: { x: number; z: number }[] = [], alleys: { x: number; z: number; px: number; pz: number; py: number }[] = []) {
  const group = new THREE.Group()
  const rand = rng(seed)

  // ---- cars: three silhouette variants (sedan / sports / van), each its own instanced mesh
  const white = new THREE.Color(0xffffff)
  const dark = new THREE.Color(0x1a2228)
  const mkCar = (bodyParts: THREE.BufferGeometry[], glassParts: THREE.BufferGeometry[]) =>
    mergeGeometries([
      mergeGeometries(bodyParts.map((g) => paint(g, white)), false)!,
      mergeGeometries(glassParts.map((g) => paint(g, dark)), false)!,
    ], true)!
  const carGeos = [
    mkCar([boxAt(1.85, 0.62, 4.3, 0, 0.62, 0), boxAt(1.72, 0.5, 2.1, 0, 1.12, -0.2)],
      [boxAt(1.5, 0.42, 1.9, 0, 1.14, -0.2), boxAt(1.86, 0.2, 4.32, 0, 0.5, 0)]),
    mkCar([boxAt(1.9, 0.48, 4.25, 0, 0.5, 0), boxAt(1.6, 0.42, 1.9, 0, 0.95, -0.3), boxAt(1.8, 0.08, 0.35, 0, 0.9, -2.15)],
      [boxAt(1.45, 0.34, 1.7, 0, 0.97, -0.3), boxAt(1.86, 0.16, 4.2, 0, 0.42, 0)]),
    mkCar([boxAt(2.0, 1.5, 4.25, 0, 1.0, 0), boxAt(2.0, 0.45, 1.2, 0, 1.85, 1.2)],
      [boxAt(1.85, 0.55, 0.95, 0, 1.6, 1.7), boxAt(1.9, 0.7, 2.0, 0, 1.55, -0.4)]),
  ]
  const VC = carGeos.length

  const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.55 })
  const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.2 })
  const cvCars = carGeos.map((g) => {
    const m = new THREE.InstancedMesh(g, [carMat, trimMat], CARS)
    m.castShadow = true
    m.frustumCulled = false
    return m
  })

  const headGeo = mergeGeometries(
    [
      paint(boxAt(0.34, 0.12, 0.06, -0.6, 0.66, 2.16), new THREE.Color(0xfff3d8)),
      paint(boxAt(0.34, 0.12, 0.06, 0.6, 0.66, 2.16), new THREE.Color(0xfff3d8)),
    ],
    false,
  )!
  const tailGeo = mergeGeometries(
    [
      paint(boxAt(0.4, 0.12, 0.06, -0.62, 0.7, -2.16), new THREE.Color(0xff2a12)),
      paint(boxAt(0.4, 0.12, 0.06, 0.62, 0.7, -2.16), new THREE.Color(0xff2a12)),
    ],
    false,
  )!
  const headMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
  const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
  const lights = new THREE.InstancedMesh(tailGeo, tailMat, CARS)
  lights.frustumCulled = false
  const heads = new THREE.InstancedMesh(headGeo, headMat, CARS)
  heads.frustumCulled = false

  const car = { axis: new Int8Array(CARS), line: new Int8Array(CARS), dir: new Int8Array(CARS), off: new Float32Array(CARS), p: new Float32Array(CARS), v: new Float32Array(CARS), v0: new Float32Array(CARS), h: new Float32Array(CARS), cx: new Float32Array(CARS), cz: new Float32Array(CARS), ni: new Int16Array(CARS), dec: new Int16Array(CARS).fill(-1), turn: new Int8Array(CARS), arc: new Float32Array(CARS), bx: new Float32Array(CARS * 6), angry: new Float32Array(CARS), rv: new Int8Array(CARS), si: new Int8Array(CARS), dwell: new Float32Array(CARS) }
  const nextNI = (p: number, d: number) => {
    const c = (p + HALF) / CELL
    return d > 0 ? Math.floor(c) + 1 : Math.ceil(c) - 1
  }
  const driver = { k: -1 }
  let lastParkedK = -1
  const carvar = new Int8Array(CARS)
  for (let k = 0; k < CARS; k++) carvar[k] = k % VC
  let activeN = 0
  let honkCb = (_x: number, _z: number) => {}
  let meowCb = (_x: number, _z: number) => {}
  let lpx = 0, lpz = 0
  const tint = new THREE.Color()
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const q2 = new THREE.Quaternion()
  const rax = new THREE.Vector3()
  const m4u = new THREE.Matrix4()
  const axX = new THREE.Vector3(1, 0, 0)
  const axZ = new THREE.Vector3(0, 0, 1)

  // ---- route vehicles: same slot + same car physics, own mesh, stops fixed to the grid
  const rvSpec: { a: number; l: number; s: number[]; dw: number; km: number }[] = [
    { a: 0, l: 3, s: [-210, -30, 150, 330], dw: 8, km: 0 },
    { a: 0, l: 7, s: [-330, -150, 30, 210], dw: 8, km: 0 },
    { a: 1, l: 5, s: [-300, -120, 60, 300], dw: 8, km: 0 },
  ]
  for (const d of doors) {
    if (rvSpec.length >= NV || Math.abs(d.hy - 0.15) > 0.3) continue
    const fx = Math.sin(d.ry), fz = Math.cos(d.ry)
    const n = Math.abs(fx) > Math.abs(fz) ? 0 : 1
    const li = Math.round(((n === 0 ? d.hx : d.hz) + HALF) / CELL)
    if (li < 1 || li > N - 2) continue
    const along = n === 0 ? d.hz : d.hx
    rvSpec.push({ a: 1 - n, l: li, s: [along, along + (along > 0 ? -140 : 140)], dw: 14, km: 1 })
  }
  const RV = rvSpec.length
  for (const r of rvSpec) r.s.sort((a, b) => a - b)
  const busGeo = mergeGeometries(
    [
      paint(boxAt(2.42, 2.5, 11.2, 0, 1.6, 0), new THREE.Color(0xf3f4f6)),
      paint(boxAt(2.5, 0.22, 11.4, 0, 2.9, 0), new THREE.Color(0xe8b424)),
      paint(boxAt(2.46, 0.78, 8.2, 0, 2.15, 0.9), dark),
      paint(boxAt(2.5, 0.14, 11.3, 0, 0.32, 0), dark),
    ],
    false,
  )!
  const truckGeo = mergeGeometries(
    [
      paint(boxAt(2.3, 1.5, 3.0, 0, 1.45, 2.6), new THREE.Color(0xd8dde3)),
      paint(boxAt(2.1, 0.55, 0.9, 0, 2.55, 2.6), dark),
      paint(boxAt(2.5, 2.6, 6.4, 0, 1.9, -2.2), new THREE.Color(0xf2f2f0)),
      paint(boxAt(2.56, 0.2, 6.5, 0, 0.45, -2.2), dark),
    ],
    false,
  )!
  const rvMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 })
  const rvMat2 = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 })
  const rvMax = [NB, Math.max(NV - NB, 1)]
  const rvs = [busGeo, truckGeo].map((g, i) => {
    const m = new THREE.InstancedMesh(g, i === 0 ? rvMat : rvMat2, rvMax[i])
    m.castShadow = true
    m.frustumCulled = false
    m.count = i === 0 ? Math.min(NB, RV) : Math.max(RV - NB, 0)
    return m
  })
  const shMat = new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.6, metalness: 0.35 })
  const shMat2 = new THREE.MeshStandardMaterial({ color: 0xf0c02a, roughness: 0.7 })
  const shelters = new THREE.InstancedMesh(mergeGeometries(
    [
      mergeGeometries(
        [
          boxAt(2.0, 1.9, 0.1, 0, 1.05, 0.55),
          boxAt(0.1, 1.9, 1.2, -1.0, 1.05, 0),
          boxAt(0.1, 1.9, 1.2, 1.0, 1.05, 0),
          boxAt(2.3, 0.12, 1.4, 0, 2.05, 0),
          boxAt(1.6, 0.1, 0.45, 0, 0.5, 0.35),
          boxAt(0.09, 2.7, 0.09, -1.3, 1.35, -0.5),
          boxAt(1.9, 0.06, 1.1, 0, 0.04, 0.1),
        ],
        false,
      )!,
      boxAt(0.52, 0.52, 0.06, -1.3, 2.45, -0.5),
    ],
    true,
  )!, [shMat, shMat2], RV * 4)
  shelters.castShadow = true
  shelters.frustumCulled = false
  const hzMat = [new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })]
  const busHL = new THREE.InstancedMesh(mergeGeometries([headGeo, headGeo.clone().translate(0, 1.35, 3.5)], false)!, hzMat[0], NB)
  busHL.instanceMatrix = rvs[0].instanceMatrix
  busHL.frustumCulled = false
  const busTL = new THREE.InstancedMesh(mergeGeometries([tailGeo, tailGeo.clone().translate(0, 1.35, -3.5)], false)!, hzMat[1], NB)
  busTL.instanceMatrix = rvs[0].instanceMatrix
  busTL.frustumCulled = false
  const hornCd = new Float32Array(RV)
  const flip = (k: number) => {
    car.dir[k] = -car.dir[k] as 1 | -1
    car.off[k] = (car.axis[k] === 0 ? 1 : -1) * car.dir[k] * 3.1
    car.h[k] = car.axis[k] === 0 ? (car.dir[k] > 0 ? Math.PI / 2 : -Math.PI / 2) : car.dir[k] > 0 ? 0 : Math.PI
    car.ni[k] = nextNI(car.p[k], car.dir[k])
    car.dec[k] = -1
    car.turn[k] = 0
  }
  for (let k = 0; k < CARS; k++) {
    if (k < RV) {
      // route vehicles own their lane; parks and tryEnter only ever pick v0 === 0 slots
      const r = rvSpec[k]
      car.rv[k] = k + 1
      car.axis[k] = r.a
      car.line[k] = r.l
      car.dir[k] = k % 2 ? -1 : 1
      car.off[k] = (r.a === 0 ? 1 : -1) * car.dir[k] * 3.1
      car.p[k] = r.s[car.dir[k] > 0 ? 0 : r.s.length - 1]
      car.v0[k] = 11
      car.v[k] = 0
      car.h[k] = r.a === 0 ? (car.dir[k] > 0 ? Math.PI / 2 : -Math.PI / 2) : car.dir[k] > 0 ? 0 : Math.PI
      car.ni[k] = nextNI(car.p[k], car.dir[k])
      car.si[k] = car.dir[k] > 0 ? 0 : r.s.length - 1
      continue
    }
    car.axis[k] = rand() < 0.5 ? 0 : 1
    car.line[k] = 1 + Math.floor(rand() * (N - 2))
    car.dir[k] = rand() < 0.5 ? 1 : -1
    car.p[k] = -HALF + rand() * (HALF * 2)
    const parked = rand() < 0.32
    car.v0[k] = parked ? 0 : 8 + rand() * 6
    car.v[k] = car.v0[k]
    const side = (car.axis[k] === 0 ? 1 : -1) * car.dir[k]
    car.off[k] = parked ? (rand() < 0.5 ? -1 : 1) * (ROAD / 2 - 1.15) : side * 3.1
    car.h[k] = car.axis[k] === 0 ? (car.dir[k] > 0 ? Math.PI / 2 : -Math.PI / 2) : car.dir[k] > 0 ? 0 : Math.PI
    car.ni[k] = nextNI(car.p[k], car.dir[k])
    tint.setHSL(rand(), 0.15 + rand() * 0.45, 0.28 + rand() * 0.45)
    cvCars[carvar[k]].setColorAt(k, tint)
  }
  for (const m of cvCars) if (m.instanceColor) m.instanceColor.needsUpdate = true
  group.add(...cvCars, lights, heads)
  for (let k = 0; k < RV; k++) {
    const km = rvSpec[k].km
    tint.setHSL(km ? 0.09 : 0.12 + k * 0.16, 0.75, 0.45)
    rvs[km].setColorAt(km ? k - NB : k, tint)
  }
  for (const m of rvs) if (m.instanceColor) m.instanceColor.needsUpdate = true
  group.add(...rvs)
  group.add(shelters)
  group.add(busHL, busTL)

  // headlight beams: reuse the car matrix, project the pool texture forward
  const beamGeo = new THREE.PlaneGeometry(5.2, 13).rotateX(-Math.PI / 2).translate(0, 0.09, 6.8)
  const beamMat = new THREE.MeshBasicMaterial({
    map: tex.pool,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0,
    fog: true,
  })
  const beams = new THREE.InstancedMesh(beamGeo, beamMat, CARS)
  beams.frustumCulled = false
  group.add(beams)

  // wet glass: beads on a skin just outside the two glass boxes, faded in by the rain level
  const wetGeo = mergeGeometries(
    [boxAt(1.54, 0.46, 1.94, 0, 1.14, -0.2), boxAt(1.9, 0.24, 4.36, 0, 0.5, 0)],
    false,
  )!
  const wetMat = new THREE.MeshBasicMaterial({
    map: tex.droplets, color: 0xbcd6ea, transparent: true, opacity: 0, depthWrite: false,
  })
  const wet = new THREE.InstancedMesh(wetGeo, wetMat, CARS)
  wet.frustumCulled = false
  wet.visible = false
  group.add(wet)

  // the car transform lives on the owner variant's body mesh; the four auxiliary meshes are kept in sync by writing the same matrix into each
  const setCar = (k: number, m: THREE.Matrix4) => {
    cvCars[carvar[k]].setMatrixAt(k, m)
    lights.setMatrixAt(k, m)
    heads.setMatrixAt(k, m)
    beams.setMatrixAt(k, m)
    wet.setMatrixAt(k, m)
  }

  // ---- pedestrians walking block perimeters
  const legs = [boxAt(0.15, 0.82, 0.16, -0.11, 0.41, 0), boxAt(0.15, 0.82, 0.16, 0.11, 0.41, 0)]
  const torsoParts = [boxAt(0.42, 0.6, 0.24, 0, 1.12, 0), boxAt(0.12, 0.55, 0.14, -0.27, 1.14, 0), boxAt(0.12, 0.55, 0.14, 0.27, 1.14, 0)]
  const skin = new THREE.Color(0xc9a184)
  const pedGeo = mergeGeometries(
    [
      paint(mergeGeometries(legs, false)!, new THREE.Color(0x2b2f3a)),
      paint(mergeGeometries(torsoParts, false)!, white),
      paint(new THREE.SphereGeometry(0.14, 10, 8).translate(0, 1.55, 0), skin),
    ],
    true,
  )!
  const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, envMapIntensity: 0.5 })
  const legMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.5 })
  const peds = new THREE.InstancedMesh(pedGeo, [legMat, clothMat, clothMat], PEDS)
  peds.frustumCulled = false
  peds.castShadow = true

  const ped = { i: new Int8Array(PEDS), j: new Int8Array(PEDS), u: new Float32Array(PEDS), v: new Float32Array(PEDS), s: new Float32Array(PEDS), pd: new Float32Array(PEDS), ph: new Float32Array(PEDS), pc: new Int8Array(PEDS), idle: new Uint8Array(PEDS), st: new Int8Array(PEDS), cw: new Float32Array(PEDS), cx: new Float32Array(PEDS), px: new Float32Array(PEDS), pz: new Float32Array(PEDS), hd: new Float32Array(PEDS), frz: new Float32Array(PEDS), hi: new Int8Array(PEDS), hj: new Int8Array(PEDS), di: new Int8Array(PEDS), dj: new Int8Array(PEDS), ps: new Uint8Array(PEDS), rest: new Float32Array(PEDS), umbrella: new Uint8Array(PEDS), board: new Uint8Array(PEDS), bt: new Float32Array(PEDS), lk: new Float32Array(PEDS), tk: new Float32Array(PEDS), tp: new Int16Array(PEDS) }
  let pedVisible = PEDS
  // constants for edge positions (CELL - ROAD - 2.8 per side)
  const EDGE = CELL - ROAD - 2.8
  const PER = 4 * EDGE
  for (let k = 0; k < PEDS; k++) {
    ped.i[k] = Math.floor(rand() * (N - 1))
    ped.j[k] = Math.floor(rand() * (N - 1))
    ped.u[k] = rand()
    ped.v[k] = (rand() < 0.5 ? -1 : 1) * (0.9 + rand() * 0.8)
    ped.s[k] = 0.85 + rand() * 0.35
    tint.setHSL(rand(), 0.2 + rand() * 0.5, 0.35 + rand() * 0.4)
    peds.setColorAt(k, tint)

    // ~18% are idle: stand at edge midpoint rather than walking
    if (rand() < 0.18) {
      ped.idle[k] = 1
      const edge = Math.floor(rand() * 4)
      const midD =
        edge === 0 ? EDGE / 2 :
        edge === 1 ? EDGE + EDGE / 2 :
        edge === 2 ? 2 * EDGE + EDGE / 2 :
        3 * EDGE + EDGE / 2
      ped.u[k] = midD / PER
    }
  }
  // ---- umbrellas: a cone above ~60% of peds, drawn only while it rains (shares the ped index)
  const umbMat = new THREE.MeshStandardMaterial({ roughness: 0.7, envMapIntensity: 0.5 })
  const umbrellas = new THREE.InstancedMesh(new THREE.ConeGeometry(0.55, 0.42, 8).translate(0, 0.21, 0), umbMat, PEDS)
  umbrellas.frustumCulled = false
  umbrellas.count = 0
  // home -> work commute; give each walker a distinct destination block
  for (let k = 0; k < PEDS; k++) {
    ped.hi[k] = ped.i[k]; ped.hj[k] = ped.j[k]
    if (rand() < 0.6) { ped.umbrella[k] = 1; tint.setHSL(rand(), 0.5, 0.4); umbrellas.setColorAt(k, tint) }
    if (ped.idle[k]) continue
    let di = ped.hi[k], dj = ped.hj[k]
    while (di === ped.hi[k] && dj === ped.hj[k]) { di = Math.floor(rand() * (N - 1)); dj = Math.floor(rand() * (N - 1)) }
    ped.di[k] = di; ped.dj[k] = dj; ped.ps[k] = 0
  }
  if (peds.instanceColor) peds.instanceColor.needsUpdate = true
  if (umbrellas.instanceColor) umbrellas.instanceColor.needsUpdate = true
  group.add(peds)
  group.add(umbrellas)

  const pos = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)

  // one shelter per stop, on the curb the bus pulls in against (local -z faces the street)
  let shi = 0
  for (const sp of rvSpec) {
    for (let n = 0; n < sp.s.length; n++) {
      const o = (n === 0 ? 1 : -1) * 6.7
      pos.set(sp.a === 0 ? sp.s[n] : line(sp.l) + o, 0.06, sp.a === 0 ? line(sp.l) + o : sp.s[n])
      q.setFromAxisAngle(up, sp.a === 0 ? (o > 0 ? 0 : Math.PI) : (o > 0 ? Math.PI / 2 : -Math.PI / 2))
      m4.compose(pos, q, one)
      shelters.setMatrixAt(shi++, m4)
    }
  }
  shelters.count = shi
  shelters.instanceMatrix.needsUpdate = true

  // B?: police patrol car — one 2-tone sedan cruising a single lane, strobe lights, distant siren as it passes
  const police = new THREE.Mesh(
    mergeGeometries(
      [
        paint(boxAt(1.85, 0.62, 4.3, 0, 0.62, 0), white),
        paint(boxAt(1.72, 0.5, 2.1, 0, 1.12, -0.2), new THREE.Color(0x12161b)),
        paint(boxAt(1.98, 0.16, 4.32, 0, 0.42, 0), new THREE.Color(0x12161b)),
        paint(boxAt(1.5, 0.42, 1.9, 0, 1.14, -0.2), new THREE.Color(0x0a0f14)),
      ],
      false,
    )!,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.5 }),
  )
  police.castShadow = true
  const strobe = (c: number, z: number) => {
    const m = new THREE.Mesh(boxAt(0.46, 0.16, 0.5, 0, 1.5, z), new THREE.MeshBasicMaterial({ color: c, toneMapped: false }))
    police.add(m)
    return m
  }
  const redLt = strobe(0xff2030, -0.12)
  const blueLt = strobe(0x2050ff, 0.38)
  group.add(police)
  const pa = rand() < 0.5 ? 0 : 1, pl = 1 + Math.floor(rand() * (N - 2)), pd = rand() < 0.5 ? -1 : 1
  let pp = (rand() * 2 - 1) * HALF, ph = 0, pSir = 0
  let sirenCb = (_x: number, _z: number) => {}

  const tlOff = new Float32Array(N * N), tlPer = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) { tlOff[i] = rand() * 14; tlPer[i] = 10 + rand() * 6 }
  // axis whose traffic flows at time t at intersection (I,J) — peds may only cross the perpendicular road
  const greenAxis = (I: number, J: number, t: number) => {
    if (I < 0 || J < 0 || I >= N || J >= N) return -1
    return (((t + tlOff[I * N + J]) % tlPer[I * N + J]) / tlPer[I * N + J]) < 0.5 ? 0 : 1
  }

  const update = (dt: number, t: number, hour: number, night: number, rain: number, px: number, pz: number, walking: boolean, pedBoost = 0) => {
    // traffic density scales with rush hour (0.4× at midnight, 1.0× at rush)
    const rush = rushHour(hour)
    lpx = px
    lpz = pz
    const traffic = 0.4 + 0.6 * rush
    // weather/time behaviour: rain sends peds hurrying (×2) and slows cars 30%; rush crowds walk faster
    const pedF = (1 + rain) * (1 + 0.4 * rush)
    const carF = 1 - 0.3 * rain
    const carN = Math.max(Math.floor(CARS * traffic), RV, driver.k + 1, lastParkedK + 1)
    activeN = carN
    for (let r = 0; r < RV; r++) hornCd[r] -= dt
    if (lights.count !== carN) {
      for (const m of cvCars) m.count = carN
      lights.count = heads.count = beams.count = wet.count = carN
    }
    // pedestrian density scales with daylight (15% at night, 85% at noon); pedBoost packs the streets at the start
    const pedN = Math.min(PEDS, Math.floor(PEDS * (0.15 + 0.7 * (1 - night))) + pedBoost)
    if (peds.count !== pedN) peds.count = pedN
    pedVisible = pedN

    const lim = HALF + 30
    const D = 15 // metres from the node to a turn's exit point
    const ARC = 0.8 // seconds to complete a turn
    for (let k = 0; k < CARS; k++) {
      if (k === driver.k) continue
      const a = car.axis[k], d = car.dir[k]
      if (car.arc[k] > 0) {
        // mid-turn: ride a quadratic Bezier through the junction so the lane change never cuts the corner
        const s = k * 6, prev = car.arc[k], u = Math.min(1, prev + dt / ARC), iu = 1 - u
        const px = iu * iu * car.bx[s] + 2 * iu * u * car.bx[s + 2] + u * u * car.bx[s + 4]
        const pz = iu * iu * car.bx[s + 1] + 2 * iu * u * car.bx[s + 3] + u * u * car.bx[s + 5]
        const vx = 2 * iu * (car.bx[s + 2] - car.bx[s]) + 2 * u * (car.bx[s + 4] - car.bx[s + 2])
        const vz = 2 * iu * (car.bx[s + 3] - car.bx[s + 1]) + 2 * u * (car.bx[s + 5] - car.bx[s + 3])
        pos.set(px, 0.055, pz)
        car.h[k] = Math.atan2(vx, vz)
        q.setFromAxisAngle(up, car.h[k])
        m4.compose(pos, q, one)
        setCar(k, m4)
        // turn signal: blink the light sprite amber ~1.6Hz while the car rides its turn arc
        if (Math.sin(t * 10 + k) > 0) tint.setRGB(1.3, 0.5, 0.08)
        else tint.setRGB(1, 1, 1)
        lights.setColorAt(k, tint)
        // B1: a turning car skipped every yield rule and clipped through traffic and peds —
        // freeze the turn while a body (or the walking player) sits in the exit
        let hold = walking && (px - lpx) ** 2 + (pz - lpz) ** 2 < 16
        for (let j = 0; j < activeN && !hold; j++) {
          if (j === k || j === driver.k || car.v0[j] === 0) continue
          if ((car.cx[j] - px) ** 2 + (car.cz[j] - pz) ** 2 < 25) hold = true
        }
        if (hold) continue
        car.arc[k] = u
        if (u >= 1) {
          car.arc[k] = 0
          car.p[k] = car.axis[k] === 0 ? px : pz
          car.ni[k] = nextNI(car.p[k], car.dir[k])
          car.dec[k] = -1
          car.turn[k] = 0
        }
        continue
      }
      if (car.v0[k] > 0) {
        const ai = Math.min(N - 1, Math.max(0, Math.round((car.p[k] + HALF) / CELL)))
        const g = Math.abs(car.p[k] - line(ai))
        const ii = a === 0 ? ai * N + car.line[k] : car.line[k] * N + ai
        const phase = ((t + tlOff[ii]) % tlPer[ii]) / tlPer[ii]
        const greenAxis = phase < 0.5 ? 0 : 1
        let tgt = a !== greenAxis && g < 18 ? 0 : car.v0[k] * carF
        if (car.rv[k]) {
          // route vehicle: slow in over the last 26 m, dwell at the stop, then hand to the next one
          const ri = car.rv[k] - 1, r = rvSpec[ri]
          // ease out to the curb while dwelling, back into the lane on the run
          const lane = (car.dwell[k] > 0 ? 4.6 : 3.1) * Math.sign(car.off[k])
          car.off[k] += (lane - car.off[k]) * Math.min(1, dt * 2)
          if (car.dwell[k] > 0) {
            car.dwell[k] -= dt
            if (car.dwell[k] <= 0) car.dwell[k] = -0.5
            const bx = a === 0 ? car.p[k] : line(car.line[k]) + car.off[k]
            const bz = a === 0 ? line(car.line[k]) + car.off[k] : car.p[k]
            for (let m = 0; m < pedVisible; m++) {
              if (Math.abs(ped.px[m] - bx) > 4 || Math.abs(ped.pz[m] - bz) > 4) continue
              if (r.km === 0 && !ped.board[m]) { ped.board[m] = 1; ped.bt[m] = 6 + rand() * 8 }
              if (hornCd[ri] <= 0) { honkCb(bx, bz); hornCd[ri] = 12 }
            }
            tgt = 0
          } else {
            const sd = (r.s[car.si[k]] - car.p[k]) * d
            if (sd < 1.5) car.dwell[k] = r.dw
            else if (sd < 26) tgt = Math.min(tgt, 3 + 3 * (1 - sd / 26))
            if (car.dwell[k] > 0) tgt = 0
          }
        }
        // B1: what sits ahead of me? lane keys alone miss parked, dwelling and turning cars, so
        // test world positions (cx/cz are last frame's mesh centres). O(CARS) — trivial
        const hx = Math.sin(car.h[k]), hz = Math.cos(car.h[k])
        const lane = line(car.line[k]) + car.off[k]
        const ox = a === 0 ? car.p[k] : lane, oz = a === 0 ? lane : car.p[k]
        for (let j = 0; j < activeN; j++) {
          if (j === k || j === driver.k) continue
          const dx = car.cx[j] - ox, dz = car.cz[j] - oz
          const along = dx * hx + dz * hz
          if (along <= 0 || along > 30) continue
          const lat = Math.abs(dx * hz - dz * hx)
          if (Math.sin(car.h[j]) * hx + Math.cos(car.h[j]) * hz < 0.7) {
            // cross traffic (or a car nose-on) across my path: stop rather than overlap
            if (lat < 5 && along < 11) tgt = 0
          } else if (lat < 2.4) {
            // match the leader's own speed inside 30m so a stop ripples backward (jam cascade)
            const safe = Math.max(0, along - 5) / 25 // 0 at 5m gap, 1 at 30m
            tgt = Math.min(tgt, car.v[j] * (0.35 + 0.65 * safe) + car.v0[k] * carF * safe)
          }
        }
        // yield to a pedestrian standing in this intersection's crosswalk
        if (tgt > 0 && g < 8) {
          const nx = a === 0 ? line(ai) : line(car.line[k])
          const nz = a === 0 ? line(car.line[k]) : line(ai)
          for (let m = 0; m < pedVisible; m++) {
            if (Math.abs(ped.px[m] - nx) < 7 && Math.abs(ped.pz[m] - nz) < 7) { tgt = 0; break }
          }
        }
        // B1: the walking player is a pedestrian anywhere in the road, not only in a crosswalk
        if (walking && tgt > 0) {
          const al = (px - ox) * hx + (pz - oz) * hz
          if (al > 0 && al < 24 && Math.abs((px - ox) * hz - (pz - oz) * hx) < 2.2)
            tgt = Math.min(tgt, (car.v0[k] * carF * Math.max(0, al - 4)) / 20)
        }
        car.v[k] += (tgt - car.v[k]) * Math.min(1, dt * 3)

        const toNode = (line(car.ni[k]) - car.p[k]) * d
        if (!car.rv[k] && toNode > 0 && toNode < 15 && car.dec[k] !== car.ni[k]) {
          car.dec[k] = car.ni[k]
          const r = rand()
          car.turn[k] = r < 0.6 ? 0 : r < 0.8 ? -1 : 1
        }
        if (car.turn[k] !== 0 && toNode <= 0 && car.ni[k] >= 0 && car.ni[k] < N) {
          const newAxis = 1 - a, newDir = car.turn[k]
          const newOff = ((newAxis === 0 ? 1 : -1) * newDir) * 3.1
          const fx = line(car.ni[k]) + newOff
          const x0 = a === 0 ? line(car.ni[k]) : line(car.line[k]) + car.off[k]
          const z0 = a === 0 ? line(car.line[k]) + car.off[k] : line(car.ni[k])
          const x1 = newAxis === 1 ? fx : x0 + newDir * D
          const z1 = newAxis === 1 ? z0 + newDir * D : fx
          const s = k * 6
          car.bx[s] = x0; car.bx[s + 1] = z0
          car.bx[s + 2] = newAxis === 1 ? x1 : x0; car.bx[s + 3] = newAxis === 1 ? z0 : z1
          car.bx[s + 4] = x1; car.bx[s + 5] = z1
          car.axis[k] = newAxis; car.line[k] = car.ni[k]; car.dir[k] = newDir; car.off[k] = newOff
          car.arc[k] = 0.001
        } else if (toNode <= 0) {
          car.ni[k] = nextNI(car.p[k], d)
          car.dec[k] = -1
          car.turn[k] = 0
        }
      }
      if (car.arc[k] > 0) continue

      const l = line(car.line[k])
      let p = car.p[k] + car.v[k] * d * dt
      if (p > lim) { p = -lim; car.ni[k] = nextNI(p, d); car.dec[k] = -1; car.turn[k] = 0 }
      else if (p < -lim) { p = lim; car.ni[k] = nextNI(p, d); car.dec[k] = -1; car.turn[k] = 0 }
      // B1: hard block — the soft yield above only eases speed, so a car still clips a body or
      // another car between frames. Test the candidate centre against its oriented box and, if it
      // would overlap, freeze in place instead of advancing (mesh stays at last frame's spot).
      {
        const laneO = l + car.off[k]
        const nx = a === 0 ? p : laneO, nz = a === 0 ? laneO : p
        const sx = Math.sin(car.h[k]), sz = Math.cos(car.h[k])
        const hl = (car.rv[k] ? (rvSpec[car.rv[k] - 1].km ? 3.4 : 5.7) : 2.3) + 1.2
        const hw = 1.2 + 1.2
        let blocked = false
        if (walking) {
          const dx = px - nx, dz = pz - nz
          if (Math.abs(dx * sx + dz * sz) < hl && Math.abs(dx * sz - dz * sx) < hw) blocked = true
        }
        for (let m = 0; !blocked && m < pedVisible; m++) {
          const dx = ped.px[m] - nx
          if (dx > hl || dx < -hl) continue
          const dz = ped.pz[m] - nz
          if (Math.abs(dx * sx + dz * sz) < hl && Math.abs(dx * sz - dz * sx) < hw) blocked = true
        }
        for (let j = 0; !blocked && j < activeN; j++) {
          if (j === k || j === driver.k) continue
          const dx = car.cx[j] - nx
          if (dx > hl + 2 || dx < -(hl + 2)) continue
          const dz = car.cz[j] - nz
          if (Math.abs(dx * sx + dz * sz) < hl && Math.abs(dx * sz - dz * sx) < hw) blocked = true
        }
        if (blocked) p = car.p[k]
      }
      car.p[k] = p
      if (car.rv[k]) {
        const ri = car.rv[k] - 1, km = rvSpec[ri].km, mi = km ? k - NB : k
        pos.set(a === 0 ? p : l + car.off[k], 0.055, a === 0 ? l + car.off[k] : p)
        q.setFromAxisAngle(up, car.h[k])
        m4.compose(pos, q, one)
        rvs[km].setMatrixAt(mi, m4)
        if (!km) busTL.setColorAt(k, tint.setRGB(1 + 1.2 * (1 - car.v[k] / car.v0[k]), 1, 1))
        // dwell done: pick up the next stop, ping-pong at the terminals
        if (car.dwell[k] < 0) {
          car.dwell[k] = 0
          const r = rvSpec[ri], at0 = car.si[k] === 0
          const nx = car.si[k] + (car.dir[k] > 0 ? 1 : -1)
          if (nx < 0 || nx >= r.s.length) { flip(k); car.si[k] = at0 ? 1 : r.s.length - 2 }
          else car.si[k] = nx
        }
        continue
      }
      const alongX = car.axis[k] === 0
      pos.set(alongX ? p : l + car.off[k], 0.055, alongX ? l + car.off[k] : p)
      const target = alongX ? (car.dir[k] > 0 ? Math.PI / 2 : -Math.PI / 2) : car.dir[k] > 0 ? 0 : Math.PI
      car.h[k] += ((target - car.h[k] + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 6)
      q.setFromAxisAngle(up, car.h[k])
      m4.compose(pos, q, one)
      setCar(k, m4)
      const brake = car.v0[k] > 0 ? 1 - car.v[k] / car.v0[k] : 0
      tint.setRGB(1 + 1.6 * brake, 1, 1)
      lights.setColorAt(k, tint)
      // player standing in the road blocks this car -> honk once it has been stuck >2s, then re-honk on a cooldown
      if (walking && car.arc[k] === 0 && car.v0[k] > 0) {
        const l2 = line(car.line[k]) + car.off[k]
        const cx = car.axis[k] === 0 ? car.p[k] : l2, cz = car.axis[k] === 0 ? l2 : car.p[k]
        const blocked = car.v[k] < 1 && (cx - px) ** 2 + (cz - pz) ** 2 < 9
        car.angry[k] = blocked ? car.angry[k] + dt : 0
        if (car.angry[k] > 2) { honkCb(cx, cz); car.angry[k] = -6 }
      }
    }
    for (const m of cvCars) m.instanceMatrix.needsUpdate = true
    lights.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true
    beams.instanceMatrix.needsUpdate = wet.instanceMatrix.needsUpdate = true
    for (let k = 0; k < carN; k++) {
      cvCars[carvar[k]].getMatrixAt(k, m4)
      car.cx[k] = m4.elements[12]
      car.cz[k] = m4.elements[14]
    }
    if (lights.instanceColor) lights.instanceColor.needsUpdate = true
    for (const m of rvs) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    if (busTL.instanceColor) busTL.instanceColor.needsUpdate = true
    hzMat[0].color.setScalar(Math.max(0.35, night) * 0.9)
    hzMat[1].color.setScalar(Math.max(0.35, night) * 0.9)
    busHL.visible = busTL.visible = night > 0.05
    headMat.color.setScalar(Math.max(0.35, night) * 0.9)
    tailMat.color.setScalar(Math.max(0.35, night) * 0.9)
    lights.visible = heads.visible = night > 0.05
    beamMat.opacity = night * 0.55
    beams.visible = night > 0.05
    wetMat.opacity = clamp((rain - 0.3) / 0.4, 0, 1) * 0.7
    wet.visible = rain > 0.3

    // police patrol: straight-lane cruise, wraps at the map edge, strobes, wails a distant siren near the player
    pp += 13 * pd * dt
    if (pp > lim) pp = -lim
    else if (pp < -lim) pp = lim
    const pLine = line(pl), pwx = pa === 0 ? pp : pLine + 3.1, pwz = pa === 0 ? pLine + 3.1 : pp
    police.position.set(pwx, 0.055, pwz)
    const pTgt = pa === 0 ? (pd > 0 ? Math.PI / 2 : -Math.PI / 2) : pd > 0 ? 0 : Math.PI
    ph += ((pTgt - ph + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 6)
    police.rotation.set(0, ph, 0)
    const flash = Math.floor(t * 4) % 2 === 0
    redLt.visible = flash
    blueLt.visible = !flash
    pSir -= dt
    if (pSir <= 0) {
      if ((pwx - px) ** 2 + (pwz - pz) ** 2 < 3600) { sirenCb(pwx, pwz); pSir = 7 }
      else pSir = 3
    }

    for (let k = 0; k < PEDS; k++) {
      if (ped.frz[k] > 0) {
        ped.frz[k] -= dt
        pos.set(ped.px[k], 0.16 + Math.sin(t * 1.5 + k * 2.3) * 0.012, ped.pz[k])
        q.setFromAxisAngle(up, ped.hd[k])
        m4.compose(pos, q, sc.setScalar(ped.s[k]))
        peds.setMatrixAt(k, m4)
        continue
      }
      if (ped.board[k]) {
        ped.bt[k] -= dt
        if (ped.bt[k] <= 0) ped.board[k] = 0
        else {
          m4.makeScale(0, 0, 0); peds.setMatrixAt(k, m4)
          m4u.makeScale(0, 0, 0); umbrellas.setMatrixAt(k, m4u)
          continue
        }
      }
      const i = ped.i[k], j = ped.j[k], s = Math.sign(ped.v[k])
      // phase 1 = resting at the current block; freeze in place until the timer expires, then flip
      if (ped.ps[k] === 1) {
        ped.rest[k] -= dt
        if (ped.rest[k] > 0) {
          ped.px[k] = line(i) + 7.4 + EDGE
          ped.pz[k] = line(j) + 7.4 + EDGE
          ped.hd[k] = Math.atan2(s, 0)
          q.setFromAxisAngle(up, ped.hd[k])
          pos.set(ped.px[k], 0.16 + Math.sin(t * 1.5 + k * 2.3) * 0.012, ped.pz[k])
          m4.compose(pos, q, sc.setScalar(ped.s[k]))
          peds.setMatrixAt(k, m4)
          m4u.compose(pos.set(line(i) + 7.4 + EDGE, 2.2, line(j) + 7.4 + EDGE), q, sc.setScalar(ped.umbrella[k]))
          umbrellas.setMatrixAt(k, m4u)
          continue
        }
        ped.ps[k] = ped.st[k]; ped.st[k] = 0
      }
      const ti = ped.ps[k] === 0 ? ped.di[k] : ped.hi[k]
      const tj = ped.ps[k] === 0 ? ped.dj[k] : ped.hj[k]
      // night keeps some walkers standing (waiting); reuses ped.s (a stable per-ped 0.85..1.2 value)
      const stand = ped.idle[k] === 1 || ped.s[k] < 0.85 + night * 0.16
      const x0 = line(i) + 7.4
      const z0 = line(j) + 7.4
      const x1 = line(i + 1) - 7.4
      const z1 = line(j + 1) - 7.4
      const wx = x1 - x0
      const wz = z1 - z0
      const per = 2 * (wx + wz)

      // corner detection (skip for idle): cross only toward the target, else keep circling to the facing corner
      if (!ped.idle[k] && ped.st[k] === 0) {
        const d0 = ped.u[k] * per
        const c = d0 < wx ? 0 : d0 < wx + wz ? 1 : d0 < 2 * wx + wz ? 2 : 3
        if (c !== ped.pc[k]) {
          ped.pc[k] = c
          const dx = ti - i, dz = tj - j
          if (dx === 0 && dz === 0) {
            // arrived: rest 20s at work then head home; longer rest at home then head to work
            ped.ps[k] = 1
            ped.st[k] = i === ped.di[k] && j === ped.dj[k] ? 2 : 0
            ped.rest[k] = ped.st[k] === 2 ? 20 : 30 + rand() * 60
          } else {
            const pref = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0)
            if (c === pref) { ped.st[k] = 1; ped.cx[k] = c }
            else {
              ped.pd[k] = 0.4 + rand() * 2
              // D13: hai người gặp nhau ở góc phố — 10% dừng lại nói chuyện 5-10s
              if (rand() < 0.1) {
                for (let m = 0; m < pedVisible; m++) {
                  if (m === k || ped.tk[m] > 0) continue
                  if ((ped.px[m] - ped.px[k]) ** 2 + (ped.pz[m] - ped.pz[k]) ** 2 < 16) {
                    const tl = 5 + rand() * 5
                    ped.tk[k] = tl
                    ped.tp[k] = m
                    ped.tk[m] = tl
                    ped.tp[m] = k
                    break
                  }
                }
              }
            }
          }
        }
      }
      // at corner c, the crosswalk runs along the axis the ped is heading (incoming edge), stepping to the next block
      const corner = ped.st[k] === 0 ? ped.pc[k] : ped.cx[k]
      const inE = (s > 0 ? (corner + 3) & 3 : (corner + 1) & 3) & 3
      const flip = s > 0 ? 1 : -1
      const cnx = flip * [1, 0, -1, 0][inE]
      const cnz = flip * [0, 1, 0, -1][inE]
      const I = i + (corner === 1 || corner === 2 ? 1 : 0)
      const J = j + (corner === 3 || (s < 0 && corner !== 1) ? 1 : 0)

      // motion gate: idle frozen, wait holds, cross moves along the crosswalk, else walks
      let vv = ped.v[k]
      if (ped.tk[k] > 0) { ped.tk[k] -= dt; vv = 0 }
      else if (stand) vv = 0
      else if (ped.st[k] === 1) {
        const req = cnx !== 0 ? 1 : 0 // wait until traffic on the crossed axis is stopped
        const g = greenAxis(I, J, t)
        const inRange = i + cnx >= 0 && i + cnx <= N - 2 && j + cnz >= 0 && j + cnz <= N - 2
        if (inRange && (g === -1 || g !== req)) {
          ped.st[k] = 2
          ped.cw[k] = 0
        }
        vv = 0
      } else if (ped.st[k] === 2) {
        ped.cw[k] += (Math.abs(ped.v[k]) * pedF * dt) / 14.8
        vv = 0
      } else if (ped.pd[k] > 0) {
        ped.pd[k] -= dt
        vv = 0
      }
      vv *= pedF
      let u = ped.u[k] + (vv * dt) / per
      u -= Math.floor(u)
      ped.u[k] = u
      ped.ph[k] += vv * dt
      const d = u * per
      let x: number, z: number, fx: number, fz: number
      if (d < wx) {
        x = x0 + d
        z = z0
        fx = s
        fz = 0
      } else if (d < wx + wz) {
        x = x1
        z = z0 + (d - wx)
        fx = 0
        fz = s
      } else if (d < 2 * wx + wz) {
        x = x1 - (d - wx - wz)
        z = z1
        fx = -s
        fz = 0
      } else {
        x = x0
        z = z1 - (d - 2 * wx - wz)
        fx = 0
        fz = -s
      }
      if (ped.st[k] === 2) {
        const w = Math.min(1, ped.cw[k])
        x += cnx * w * 14.8
        z += cnz * w * 14.8
        fx = cnx
        fz = cnz
        if (ped.cw[k] >= 1) {
          ped.i[k] = i + cnx
          ped.j[k] = j + cnz
          const nper = 4 * CELL
          const nstart = (s > 0 ? [0, 1, 2, 3][corner] : [0, 0, 1, 2][corner]) * CELL
          ped.u[k] = nstart / nper
          ped.pc[k] = corner
          ped.st[k] = 0
          ped.cw[k] = 0
        }
      }
      ped.px[k] = x
      ped.pz[k] = z
      // D13: world nhận ra player. Cổ quay tối đa 90° so với hướng bước (không ai quay hẳn lưng
      // đi lùi), và người lại quá gần thì đứng chờ thay vì đi xuyên qua nhau.
      const wh = Math.atan2(fx, fz)
      const dxp = px - x
      const dzp = pz - z
      const dp2 = dxp * dxp + dzp * dzp
      let off = ped.lk[k]
      if (ped.tk[k] > 0) {
        const pt = ped.tp[k]
        off = Math.atan2(ped.px[pt] - x, ped.pz[pt] - z) - wh + Math.sin(t * 2.2 + k) * 0.12
      } else if (dp2 < 36) {
        const dl = Math.atan2(dxp, dzp) - wh
        const w = ((dl + Math.PI * 3) % (Math.PI * 2)) - Math.PI
        off += ((Math.abs(w) < 1.5 ? w : Math.sign(w) * 1.5) - off) * Math.min(1, dt * 3)
        if (dp2 < 6.25) ped.pd[k] = 0.2
      } else {
        off -= off * Math.min(1, dt * 2)
      }
      ped.lk[k] = off
      ped.hd[k] = wh + off
      q.setFromAxisAngle(up, ped.hd[k])
      // y bob: standing = breathing, walker = walk bob (rain cranks stride rate and leans them forward)
      const bob = stand
        ? Math.sin(t * 1.5 + k * 2.3) * 0.012
        : Math.abs(Math.sin(ped.ph[k] * (8 + rain * 6) + k)) * 0.035
      if (rain > 0.05 && !stand) {
        rax.set(fz, 0, -fx)
        q.premultiply(q2.setFromAxisAngle(rax, 0.25 * rain))
      }
      pos.set(x, 0.16 + bob, z)
      m4.compose(pos, q, sc.setScalar(ped.s[k]))
      peds.setMatrixAt(k, m4)
      m4u.compose(pos.set(x, 2.2, z), q, sc.setScalar(ped.umbrella[k]))
      umbrellas.setMatrixAt(k, m4u)
    }
    peds.instanceMatrix.needsUpdate = true
    umbrellas.instanceMatrix.needsUpdate = true
    umbrellas.count = pedVisible
    umbrellas.visible = rain > 0.5

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
        if (near < 4) { c.st[k] = 1; c.g[k] = 0; meowCb(c.x[k], c.z[k]) }
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

  const slotPose = (k: number) => {
    const l = line(car.line[k]) + car.off[k]
    return car.axis[k] === 0 ? { x: car.p[k], z: l, h: car.h[k] } : { x: l, z: car.p[k], h: car.h[k] }
  }
  const headlights = (fx: number, fz: number, n: number) => {
    const out: { x: number; z: number; h: number; d: number }[] = []
    for (let k = 0; k < activeN; k++) {
      if (car.v0[k] === 0 || car.arc[k] > 0) continue
      const s = slotPose(k)
      out.push({ x: s.x, z: s.z, h: s.h, d: (s.x - fx) ** 2 + (s.z - fz) ** 2 })
    }
    out.sort((a, b) => a.d - b.d)
    return out.slice(0, n)
  }
  const tryEnter = (x: number, z: number, maxR: number) => {
    let best = -1
    let bd = maxR * maxR
    for (let k = 0; k < CARS; k++) {
      if (car.v0[k] !== 0) continue
      const s = slotPose(k)
      const dd = (s.x - x) ** 2 + (s.z - z) ** 2
      if (dd < bd) { bd = dd; best = k }
    }
    if (best < 0) return null
    driver.k = best
    return slotPose(best)
  }
  const drive = (x: number, z: number, h: number, roll = 0, pitch = 0, brake = 0) => {
    if (driver.k < 0) return
    car.h[driver.k] = h
    pos.set(x, 0.055, z)
    q.setFromAxisAngle(up, h)
    q.multiply(q2.setFromAxisAngle(axX, pitch))
    q.multiply(q2.setFromAxisAngle(axZ, roll))
    m4.compose(pos, q, one)
    setCar(driver.k, m4)
    tint.setRGB(1 + 1.6 * brake, 1, 1)
    lights.setColorAt(driver.k, tint)
  }
  const park = (x: number, z: number, h: number) => {
    if (driver.k < 0) return
    const k = driver.k
    const axis = Math.abs(Math.sin(h)) > Math.abs(Math.cos(h)) ? 0 : 1
    const dir = axis === 0 ? (Math.sin(h) > 0 ? 1 : -1) : (Math.cos(h) > 0 ? 1 : -1)
    const cross = axis === 0 ? z : x
    const li = Math.min(N - 1, Math.max(0, Math.round((cross + HALF) / CELL)))
    car.axis[k] = axis
    car.line[k] = li
    car.dir[k] = dir
    car.off[k] = (axis === 0 ? 1 : -1) * dir * (ROAD / 2 - 1.15)
    car.p[k] = axis === 0 ? x : z
    car.v0[k] = 0
    car.v[k] = 0
    car.h[k] = h
    car.arc[k] = 0
    car.turn[k] = 0
    car.dec[k] = -1
    car.ni[k] = nextNI(car.p[k], dir)
    lastParkedK = k
    driver.k = -1
  }
  // B1: cars are solid to the walking player — oriented box per type, because a bus is 11m long
  // and a circle around its centre lets you stand in half of it
  const carPush = (v: THREE.Vector3) => {
    const R = 0.32
    for (let k = 0; k < activeN; k++) {
      if (k === driver.k) continue
      const fx = Math.sin(car.h[k]), fz = Math.cos(car.h[k])
      const dx = v.x - car.cx[k], dz = v.z - car.cz[k]
      let along = dx * fx + dz * fz
      let lat = dx * fz - dz * fx
      const L = (car.rv[k] ? (rvSpec[car.rv[k] - 1].km ? 3.4 : 5.7) : 2.3) + R
      const W = 1.2 + R
      if (Math.abs(along) > L || Math.abs(lat) > W) continue
      if (L - Math.abs(along) < W - Math.abs(lat)) along = Math.sign(along || 1) * L
      else lat = Math.sign(lat || 1) * W
      v.x = car.cx[k] + along * fx + lat * fz
      v.z = car.cz[k] + along * fz - lat * fx
    }
  }
  // B1: the vehicle the player drives is solid to traffic and pedestrians. Same oriented-box push
  // as carPush but with the vehicle's own radius, plus a circle pass against peds.
  const vehPush = (v: THREE.Vector3, R: number) => {
    for (let k = 0; k < activeN; k++) {
      if (k === driver.k) continue
      const fx = Math.sin(car.h[k]), fz = Math.cos(car.h[k])
      const dx = v.x - car.cx[k], dz = v.z - car.cz[k]
      let along = dx * fx + dz * fz
      let lat = dx * fz - dz * fx
      const L = (car.rv[k] ? (rvSpec[car.rv[k] - 1].km ? 3.4 : 5.7) : 2.3) + R
      const W = 1.2 + R
      if (Math.abs(along) > L || Math.abs(lat) > W) continue
      if (L - Math.abs(along) < W - Math.abs(lat)) along = Math.sign(along || 1) * L
      else lat = Math.sign(lat || 1) * W
      v.x = car.cx[k] + along * fx + lat * fz
      v.z = car.cz[k] + along * fz - lat * fx
    }
    const PR = 0.5 + R
    for (let m = 0; m < pedVisible; m++) {
      const dx = v.x - ped.px[m], dz = v.z - ped.pz[m]
      const dd = dx * dx + dz * dz
      if (dd > PR * PR || dd === 0) continue
      const d = Math.sqrt(dd)
      v.x = ped.px[m] + (dx / d) * PR
      v.z = ped.pz[m] + (dz / d) * PR
    }
  }
  const talkNearest = (x: number, z: number, maxR: number) => {
    let best = -1
    let bd = maxR * maxR
    for (let k = 0; k < pedVisible; k++) {
      if (ped.frz[k] > 0 || ped.board[k]) continue
      const dd = (ped.px[k] - x) ** 2 + (ped.pz[k] - z) ** 2
      if (dd < bd) { bd = dd; best = k }
    }
    if (best < 0) return false
    ped.frz[best] = 3
    return true
  }

  // the nearest route vehicle: hold E beside one that is dwelling -> it sounds off
  const busHorn = () => {
    let best = -1
    let bd = 36
    let bx = 0, bz = 0
    for (let k = 0; k < RV; k++) {
      if (car.dwell[k] <= 0) continue
      const s = slotPose(k)
      const dd = (s.x - lpx) ** 2 + (s.z - lpz) ** 2
      if (dd < bd) { bd = dd; best = k; bx = s.x; bz = s.z }
    }
    if (best < 0) return false
    honkCb(bx, bz)
    car.dwell[best] = 1.5
    return true
  }

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
  const qd = new THREE.Quaternion()
  const rollAxis = new THREE.Vector3(0, 0, 1)

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

  update(0, 0, 12, 0, 0, 0, 0, false)
  return { group, update, tryEnter, drive, park, headlights, talkNearest, busHorn, onHonk: (fn: (x: number, z: number) => void) => { honkCb = fn }, onMeow: (fn: (x: number, z: number) => void) => { meowCb = fn }, onSiren: (fn: (x: number, z: number) => void) => { sirenCb = fn }, pedWorld: () => ({ px: ped.px, pz: ped.pz, n: pedVisible }), carWorld: () => ({ x: car.cx, z: car.cz, n: activeN }), carPush, vehPush }
}
