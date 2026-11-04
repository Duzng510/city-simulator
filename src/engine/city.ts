import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clamp, lerp, rng } from './util'
import { WINDOW_GRID } from './textures'
import type { Textures } from './textures'

export const N = 13
export const SPAN = 720
export const HALF = SPAN / 2
export const CELL = SPAN / (N - 1)
export const ROAD = 12
export const TILE = 8
const CURB = 0.18
const SLOT = 60

export const line = (i: number) => -HALF + i * CELL

export interface City {
  group: THREE.Group
  spawn: THREE.Vector3
  blockers: THREE.Object3D[]
  hit: (pos: THREE.Vector3, r: number) => void
  facadeMats: THREE.MeshStandardMaterial[]
  treeMat: THREE.MeshStandardMaterial
  propMat: THREE.MeshStandardMaterial
  asphaltMat: THREE.MeshStandardMaterial
  lampGlow: THREE.Points
  neonMat: THREE.MeshBasicMaterial
  neonReflMat: THREE.MeshBasicMaterial
  pools: THREE.InstancedMesh
  puddles: THREE.InstancedMesh
  puddleSpots: { x: number; z: number; r: number }[]
  parkSpots: { x: number; z: number }[]
  zoneCenters: { x: number; z: number; kind: 'park' | 'market' | 'plaza' | 'tower' }[]
  doors: THREE.InstancedMesh
  doorSpots: Door[]
  lampSpots: { x: number; z: number }[]
  benches: { x: number; z: number }[]
  vending: { x: number; z: number; ry: number }[]
  trash: { x: number; z: number }[]
  bikeRacks: { x: number; z: number }[]
  acSpots: { x: number; y: number; z: number }[]
  acHumSpots: { x: number; z: number }[]
  constructionSpots: { x: number; z: number }[]
  steamSpots: { x: number; y: number; z: number }[]
  carts: { x: number; z: number }[]
  cafeTables: { x: number; z: number }[]
  alleySpots: { x: number; z: number; px: number; pz: number; py: number }[]
  shaftSpots: { x: number; z: number; nx: number; nz: number }[]
  bbMats: THREE.MeshStandardMaterial[]
}

type Geo = THREE.BufferGeometry
type Bag = Geo[]

function scaleUV(g: Geo, su: number, sv: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  return g
}

// box: facade tiles keep real-world size on the 4 side faces, roof gets a tight patch
function boxUV(g: Geo, w: number, h: number, d: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute
  const nor = g.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    const ny = Math.abs(nor.getY(i))
    if (ny > 0.5) uv.setXY(i, uv.getX(i) * 0.25, uv.getY(i) * 0.25)
    else {
      const nx = Math.abs(nor.getX(i))
      const su = (nx > 0.5 ? d : w) / TILE
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * (h / TILE))
    }
  }
  return g
}

const rect = (x0: number, z0: number, x1: number, z1: number, y: number, su: number, sv: number) => {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0)
  scaleUV(g, su, sv)
  g.rotateX(-Math.PI / 2)
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2)
  return g
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  return g
}

// aRand seeds the lighting bucket + flicker; aKind tags the vertex: 0 wall, 1 shop facade, 2 shop door
function addRand(g: Geo, r: number, kind = 0) {
  const n = g.attributes.position.count
  g.setAttribute('aRand', new THREE.BufferAttribute(new Float32Array(n).fill(r), 1))
  g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1))
  return g
}

function paint(g: Geo, c: THREE.Color) {
  const n = g.attributes.position.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
}

// wash = multiplicative tint, brightest channel pinned to f so brightness survives
// (an unnormalised mid-lightness colour would darken the facade ~2x)
function makeWash(rand: () => number) {
  const hue = rand()
  const sat = 0.05 + rand() * 0.12
  const c = new THREE.Color()
  return (f: number) => {
    c.setHSL(hue, sat, 0.5)
    return c.clone().multiplyScalar(f / Math.max(c.r, c.g, c.b))
  }
}

function merge(bag: Bag): Geo {
  const g = mergeGeometries(bag, false)!
  bag.length = 0
  return g
}

interface Lot {
  x0: number
  z0: number
  x1: number
  z1: number
}

function splitLot(l: Lot, rand: () => number, depth: number, out: Lot[]) {
  const w = l.x1 - l.x0
  const d = l.z1 - l.z0
  if (depth <= 0 || (w < 22 && d < 22) || rand() < 0.15) {
    out.push(l)
    return
  }
  const gap = 2.4
  if (w > d) {
    const m = l.x0 + w * (0.35 + rand() * 0.3)
    splitLot({ ...l, x1: m - gap / 2 }, rand, depth - 1, out)
    splitLot({ ...l, x0: m + gap / 2 }, rand, depth - 1, out)
  } else {
    const m = l.z0 + d * (0.35 + rand() * 0.3)
    splitLot({ ...l, z1: m - gap / 2 }, rand, depth - 1, out)
    splitLot({ ...l, z0: m + gap / 2 }, rand, depth - 1, out)
  }
}

type Style = 'tower' | 'midrise' | 'lowrise' | 'shop'
// texture buckets: 1/3/6 are 3-floor grids for the tall stuff, the rest are 1-2-floor masonry rhythm
const MODERN = [1, 3, 6]
const MASONRY = [0, 2, 4, 5, 7]
// hinge = world pivot of the door's left edge (outward offset baked in); ry = closed facing yaw
export interface Door { hx: number; hy: number; hz: number; ry: number; exit?: { x: number; z: number } }
type BuildingResult = { wallGeo: Geo; doorGeo: Geo | null; door: Door | null; roofGeo: Geo | null; propGeo: Geo | null; scaffoldGeo: Geo | null; laundryGeo: Geo | null; acs: { x: number; y: number; z: number }[]; topW: number; topD: number }

function buildingGeo(
  cx: number, cz: number, w: number, d: number, h: number,
  style: Style, rand: () => number,
): BuildingResult {
  const wallBag: Bag = []
  const roofBag: Bag = []
  const propBag: Bag = []
  const scaffoldBag: Bag = []
  const laundryBag: Bag = []
  const acs: { x: number; y: number; z: number }[] = []
  let topW = w, topD = d

  // cap sits flat on the highest tier of every style — footprint passed in so it can shrink for towers
  const capAt = (tw: number, td: number) => {
    roofBag.push(box(cx - tw / 2 - 0.5, h - 0.7, cz - td / 2 - 0.5, cx + tw / 2 + 0.5, h + 0.05, cz + td / 2 + 0.5))
  }

  // parapet ring + rooftop clutter, non-tower only — caller passes topW/topD (== w/d for non-tower)
  const rooftopProps = (tw: number, td: number) => {
    const rx0 = cx - tw / 2 - 0.5
    const rx1 = cx + tw / 2 + 0.5
    const rz0 = cz - td / 2 - 0.5
    const rz1 = cz + td / 2 + 0.5
    for (const [a0, a1, b0, b1] of [
      [rx0, rx1, rz0, rz0 + 0.16],
      [rx0, rx1, rz1 - 0.16, rz1],
      [rx0, rx0 + 0.16, rz0, rz1],
      [rx1 - 0.16, rx1, rz0, rz1],
    ] as number[][]) {
      propBag.push(box(a0, h, b0, a1, h + 0.85, b1))
    }
    const rc = rand()
    if (rc < 0.35) propBag.push(new THREE.CylinderGeometry(1.3, 1.3, 2.8, 10).translate(lerp(rx0 + 2, rx1 - 2, rand()), h + 1.4, lerp(rz0 + 2, rz1 - 2, rand())))
    else if (rc < 0.6) propBag.push(box(rx0 + 1, h, rz0 + 1, rx0 + 2.6, h + 1.2, rz0 + 2.6))
    else if (rc < 0.8) propBag.push(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 4).translate((rx0 + rx1) / 2, h + 1.7, (rz0 + rz1) / 2))
    if (rand() < 0.35) {
      const px = lerp(rx0 + 1, rx1 - 2, rand())
      const pz = lerp(rz0 + 1, rz1 - 2, rand())
      propBag.push(box(px, h, pz, px + 1, h + 1.4, pz + 1))
      acs.push({ x: px + 0.5, y: h + 0.05, z: pz + 0.5 })
    }
    if (rand() < 0.5) {
      propBag.push(new THREE.CylinderGeometry(0.7, 0.9, 3, 8).translate(lerp(rx0 + 1.5, rx1 - 1.5, rand()), h + 1.5, lerp(rz0 + 1.5, rz1 - 1.5, rand())))
    }
    // water tower — 4 legs + tank + cone roof
    if (rand() < 0.18) {
      const wx = lerp(rx0 + 2, rx1 - 3, rand())
      const wz = lerp(rz0 + 2, rz1 - 3, rand())
      const tw = 1.2 + rand() * 0.6
      for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as number[][]) {
        propBag.push(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 4).translate(wx + lx * tw, h + 1.1, wz + lz * tw))
      }
      propBag.push(new THREE.CylinderGeometry(tw, tw, 2.4, 10).translate(wx, h + 3.4, wz))
      propBag.push(new THREE.ConeGeometry(tw * 1.05, 0.7, 10).translate(wx, h + 4.9, wz))
    }
    // brick chimney stacks
    if (rand() < 0.25) {
      const count = 1 + Math.floor(rand() * 2)
      for (let i = 0; i < count; i++) {
        const px = lerp(rx0 + 1.5, rx1 - 1.5, rand())
        const pz = lerp(rz0 + 1.5, rz1 - 1.5, rand())
        const ch = 1.5 + rand() * 1.5
        propBag.push(box(px - 0.35, h, pz - 0.35, px + 0.35, h + ch, pz + 0.35))
      }
    }
    // satellite dish
    if (rand() < 0.15) {
      const dx = lerp(rx0 + 1.5, rx1 - 1.5, rand())
      const dz = lerp(rz0 + 1.5, rz1 - 1.5, rand())
      propBag.push(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4).translate(dx, h + 0.6, dz))
      const dish = new THREE.SphereGeometry(0.35, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)
      dish.rotateX(Math.PI * 0.3)
      dish.rotateZ(Math.PI * rand())
      dish.translate(dx, h + 1.3, dz)
      propBag.push(dish)
    }
  }

  // storefront awning + sign box, random face
  const streetAwning = () => {
    const face = Math.floor(rand() * 4)
    const ay = 3.2
    const aw = 2.5
    let ax: number, az: number, awid: number, adep: number
    if (face === 0) { ax = cx; az = cz - d / 2 - 0.4; awid = aw; adep = 0.8 }
    else if (face === 1) { ax = cx; az = cz + d / 2 + 0.4; awid = aw; adep = 0.8 }
    else if (face === 2) { ax = cx - w / 2 - 0.4; az = cz; awid = 0.8; adep = aw }
    else { ax = cx + w / 2 + 0.4; az = cz; awid = 0.8; adep = aw }
    propBag.push(box(ax - awid / 2, ay, az - adep / 2, ax + awid / 2, ay + 0.1, az + adep / 2))
    propBag.push(box(ax - awid / 2, ay + 0.5, az - adep / 2, ax + awid / 2, ay + 1.1, az + adep / 2))
  }

  if (style === 'tower') {
    // weights normalized so Σ th = h — cap lands exactly on top tier
    const tiers = 2 + Math.floor(rand() * 3)
    const wts: number[] = []
    for (let t = 0; t < tiers; t++) wts.push(0.75 + rand() * 0.5)
    const wSum = wts.reduce((a, b) => a + b, 0)
    let y = 0
    let cw = w, cd = d
    for (let t = 0; t < tiers; t++) {
      const th = (h * wts[t]) / wSum
      wallBag.push(boxUV(new THREE.BoxGeometry(cw, th, cd), cw, th, cd).translate(cx, y + th / 2, cz))
      topW = cw; topD = cd
      y += th
      if (t < tiers - 1) {
        // terrace cap between this tier and the next; the shrunk tier above covers the middle, only the grey ring shows
        roofBag.push(box(cx - cw / 2 - 0.5, y - 0.7, cz - cd / 2 - 0.5, cx + cw / 2 + 0.5, y + 0.05, cz + cd / 2 + 0.5))
      }
      cw *= 0.82 + rand() * 0.08
      cd *= 0.82 + rand() * 0.08
    }
    capAt(topW, topD)
    if (rand() < 0.4) {
      const ch = h * (0.06 + rand() * 0.12)
      if (rand() < 0.5) {
        roofBag.push(new THREE.ConeGeometry(topW * 0.55, ch, 4).rotateY(Math.PI / 4).translate(cx, h + ch / 2, cz))
      } else {
        const cw2 = topW * 0.5, ch2 = ch * 1.6
        roofBag.push(new THREE.BoxGeometry(cw2, ch2, topD * 0.5).translate(cx, h + ch2 / 2, cz))
      }
    }
  } else if (style === 'midrise') {
    wallBag.push(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d).translate(cx, h / 2, cz))
    capAt(w, d)
    rooftopProps(w, d)
    if (rand() < 0.25) streetAwning()
  } else if (style === 'shop') {
    wallBag.push(boxUV(new THREE.BoxGeometry(w, 4.8, d), w, 4.8, d).translate(cx, 2.4, cz))
    wallBag.push(boxUV(new THREE.BoxGeometry(w, h - 4.8, d), w, h - 4.8, d).translate(cx, 4.8 + (h - 4.8) / 2, cz))
    capAt(w, d)
    rooftopProps(w, d)
    if (rand() < 0.6) streetAwning()
  } else {
    wallBag.push(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d).translate(cx, h / 2, cz))
    capAt(w, d)
    const sw = w * 0.25, sh = 2.8
    roofBag.push(new THREE.BoxGeometry(sw, sh, sw).translate(cx + w * 0.2, h + sh / 2, cz + d * 0.2))
    rooftopProps(w, d)
  }

  const wash = makeWash(rand)
  const isShop = style === 'shop'
  const bRand = rand()
  const wallGeo = addRand(merge(wallBag), bRand, isShop ? 1 : 0)
  paint(wallGeo, wash(0.85 + rand() * 0.3))

  // shop ground-floor entrance: dark recess quad merged into the wall (aKind=2) + a hinge
  // spot for an instanced swing panel the engine animates. dw/dh shared with the panel builder.
  let doorGeo: Geo | null = null
  let door: Door | null = null
  if (isShop) {
    const dw = 1.3
    const dh = 2.4
    const face = Math.floor(rand() * 4)
    let px = cx, pz = cz, ry = 0
    if (face === 0) { pz = cz - d / 2 - 0.02; ry = Math.PI }
    else if (face === 1) { pz = cz + d / 2 + 0.02 }
    else if (face === 2) { px = cx - w / 2 - 0.02; ry = -Math.PI / 2 }
    else { px = cx + w / 2 + 0.02; ry = Math.PI / 2 }
    const g = new THREE.PlaneGeometry(dw, dh)
    g.rotateY(ry)
    g.translate(px, dh / 2 + 0.05, pz)
    addRand(g, bRand, 2)
    paint(g, wash(0.35))
    doorGeo = g
    const out = 0.05
    door = {
      hx: px - (dw / 2) * Math.cos(ry) + out * Math.sin(ry),
      hy: dh / 2 + 0.05,
      hz: pz + (dw / 2) * Math.sin(ry) + out * Math.cos(ry),
      ry,
    }
  }

  // B7 — laundry lines on residential frontages (floors 2-4, above the awning band)
  if ((style === 'lowrise' || style === 'shop' || style === 'midrise') && rand() < 0.4 && h > 9) {
    const ly = 4.5 + rand() * Math.min(9, h - 9)
    const zf = cz - d / 2 - 0.15
    const x0 = cx - w / 2 + 1.5
    const x1 = cx + w / 2 - 1.5
    if (x1 - x0 > 2) {
      const n = 2 + Math.floor(rand() * 3)
      const palette = [0xc94f4f, 0x4fb3c9, 0xe0c360, 0x77c97b, 0xd98ecb, 0xf2f2f2, 0x6a6a7a]
      for (let k = 0; k < n; k++) {
        const xk = lerp(x0, x1, n === 1 ? 0.5 : k / (n - 1)) + (rand() - 0.5) * 0.18
        const cc = new THREE.Color(palette[Math.floor(rand() * palette.length)])
        const hw = 0.16 + rand() * 0.06
        const hh = 0.32 + rand() * 0.2
        for (const [sx, sw, sh] of [[-hw - 0.03, hw * 0.55, hh * 0.55], [0, hw * 2, hh], [hw + 0.03, hw * 0.55, hh * 0.55]] as number[][]) {
          const q = new THREE.PlaneGeometry(sw, sh)
          q.rotateY(Math.PI)
          q.translate(xk + sx, ly - sh / 2 + 0.05, zf - 0.02)
          paint(q, cc)
          laundryBag.push(q)
        }
      }
    }
  }

  // B9 — fire escape: zigzag iron ladder on the front or left wall of mid/lowrise
  if ((style === 'midrise' || style === 'lowrise') && h >= 12 && rand() < 0.35) {
    const face = rand() < 0.7 ? 0 : 2
    const nf = Math.max(3, Math.min(4, Math.floor((h - 6) / 3.2)))
    const fH = 3.2
    const iron = new THREE.Color(0x2a2a2e)
    const wall = face === 0 ? cz - d / 2 : cx - w / 2
    const pf0 = wall - 0.85
    const spanLo = face === 0
      ? cx - w / 2 + Math.max(2, rand() * Math.max(2, w - 4)) - 0.9
      : cz - d / 2 + Math.max(2, rand() * Math.max(2, d - 4)) - 0.9
    const spanHi = spanLo + 1.8
    for (let k = 0; k < nf; k++) {
      const fy = 4.2 + k * fH
      const plat = face === 0
        ? box(spanLo, fy, pf0, spanHi, fy + 0.08, wall)
        : box(pf0, fy, spanLo, wall, fy + 0.08, spanHi)
      paint(plat, iron); scaffoldBag.push(plat)
      const rail = face === 0
        ? box(spanLo, fy, pf0, spanHi, fy + 0.9, pf0 + 0.04)
        : box(pf0, fy, spanLo, pf0 + 0.04, fy + 0.9, spanHi)
      paint(rail, iron); scaffoldBag.push(rail)
      if (k > 0) {
        const prev = (k - 1) % 2 === 0 ? spanLo : spanHi
        const cur = k % 2 === 0 ? spanLo : spanHi
        const lo = Math.min(prev, cur) - 0.15
        const hi = Math.max(prev, cur) + 0.15
        const mid = face === 0
          ? box(lo, fy - fH + 0.05, pf0 + 0.2, hi, fy - fH + 0.25, pf0 + 0.6)
          : box(pf0 + 0.2, fy - fH + 0.05, lo, pf0 + 0.6, fy - fH + 0.25, hi)
        paint(mid, iron); scaffoldBag.push(mid)
      }
    }
  }

  // ~5% of buildings read as under construction: a facade scaffold grid
  if (rand() < 0.05) {
    const scafH = Math.min(h, 13)
    const zf = cz - d / 2 - 0.4
    const ncol = Math.min(5, Math.max(3, Math.round(w / 4)))
    const nlev = Math.max(4, Math.min(5, Math.round(scafH / 2.6)))
    const pole = new THREE.Color(0xd8a72a)
    const plank = new THREE.Color(0x9a9a9a)
    for (let c = 0; c < ncol; c++) {
      const x = lerp(cx - w / 2 - 0.2, cx + w / 2 + 0.2, c / (ncol - 1))
      const g = box(x - 0.07, 0, zf - 0.07, x + 0.07, scafH, zf + 0.07)
      paint(g, pole); scaffoldBag.push(g)
    }
    for (let r = 1; r <= nlev; r++) {
      const y = (scafH / nlev) * r
      const g = box(cx - w / 2 - 0.3, y - 0.06, zf - 0.07, cx + w / 2 + 0.3, y + 0.06, zf + 0.07)
      paint(g, pole); scaffoldBag.push(g)
      if (r % 2 === 0) {
        const b = box(cx - w / 2 - 0.3, y, zf - 0.14, cx + w / 2 + 0.3, y + 0.13, zf + 0.14)
        paint(b, plank); scaffoldBag.push(b)
      }
    }
  }

  const scaffoldGeo = scaffoldBag.length ? merge(scaffoldBag) : null
  const laundryGeo = laundryBag.length ? merge(laundryBag) : null
  const roofGeo = roofBag.length ? merge(roofBag) : null
  if (roofGeo) paint(roofGeo, wash(0.55 + rand() * 0.3))

  return {
    wallGeo,
    doorGeo,
    door,
    roofGeo,
    propGeo: propBag.length ? merge(propBag) : null,
    scaffoldGeo,
    laundryGeo,
    acs,
    topW, topD,
  }
}

export function buildCity(tex: Textures, seed = 20261102): City {
  const rand = rng(seed)
  const group = new THREE.Group()
  const shadowy = (m: THREE.Mesh, cast = true) => { m.castShadow = cast; m.receiveShadow = true; return m }

  const wall: Bag[] = tex.facade.map(() => [])
  const roof: Bag = []
  const paved: Bag = []
  const roads: Bag = []
  const lawn: Bag = []
  const mark: Bag = []
  const props: Bag = []
  const scaffold: Bag = []
  const laundry: Bag = []
  const posters: Bag = []
  const neon: Bag = []
  const neonRefl: Bag = []
  const bbFace: Bag[] = tex.bb.map(() => [])
  const graf: Bag[] = tex.graffiti.map(() => [])
  const bags: Bag = []
  const wrecks: Bag = []
  let nBB = 0
  let nWreck = 0
  let nPoster = 0
  let nNews = 0
  const blockers: THREE.Object3D[] = []
  const boxes: THREE.Box3[] = []
  const hash = new Map<number, number[]>()
  const trees: THREE.Matrix4[] = []
  const lamps: { x: number; z: number }[] = []
  const doorSpots: Door[] = []
  const benches: { x: number; z: number }[] = []
  const vending: { x: number; z: number; ry: number }[] = []
  const trash: { x: number; z: number }[] = []
  const bikeRacks: { x: number; z: number }[] = []
  const parkSpots: { x: number; z: number }[] = []
  const zoneCenters: { x: number; z: number; kind: 'park' | 'market' | 'plaza' | 'tower' }[] = []
  const acHumSpots: { x: number; z: number }[] = []
  const constructionSpots: { x: number; z: number }[] = []
  const acSpots: { x: number; y: number; z: number }[] = []
  const manholeSpots: { x: number; z: number }[] = []
  const shaftSpots: { x: number; z: number; nx: number; nz: number }[] = []
  const carts: { x: number; z: number }[] = []
  const cafeTables: { x: number; z: number }[] = []
  const cartSteam: { x: number; y: number; z: number }[] = []
  const alleySpots: { x: number; z: number; px: number; pz: number; py: number }[] = []
  const SHAFT_CAP = 1400
  const solidGeo: Bag = []
  let spawn = new THREE.Vector3(line(6) - 7.6, 0, line(6) - 18)

  const cellKey = (x: number, z: number) => ((Math.floor((x + HALF) / SLOT) + 512) << 10) | (Math.floor((z + HALF) / SLOT) + 512)

  const addBlocker = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    boxes.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)))
    solidGeo.push(box(x0, y0, z0, x1, y1, z1))
  }

  const putTree = (x: number, z: number, s: number) => {
    const m = new THREE.Matrix4().makeScale(s * (0.8 + rand() * 0.4), s * (0.9 + rand() * 0.5), s * (0.8 + rand() * 0.4))
    m.setPosition(x, 0.16, z)
    trees.push(m)
  }

  // eye-level street props — all merged into the props bag, zero extra draw calls
  const hydrant = (x: number, z: number) => {
    props.push(new THREE.CylinderGeometry(0.14, 0.16, 0.7, 8).translate(x, 0.35, z))
    props.push(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6).rotateZ(Math.PI / 2).translate(x + 0.18, 0.55, z))
    props.push(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6).rotateZ(Math.PI / 2).translate(x - 0.18, 0.55, z))
  }
  // B8 — mailbox = post + box + round lid; newsstand = box + tilted cap
  const mailbox = (x: number, z: number) => {
    props.push(box(x - 0.05, 0, z - 0.05, x + 0.05, 0.85, z + 0.05))
    props.push(box(x - 0.22, 0.85, z - 0.16, x + 0.22, 1.12, z + 0.16))
    props.push(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 10).rotateZ(Math.PI / 2).translate(x, 1.15, z))
  }
  const newsStand = (x: number, z: number) => {
    props.push(box(x - 0.4, 0, z - 0.35, x + 0.4, 1.1, z + 0.35))
    const top = box(-0.45, -0.03, -0.5, 0.45, 0.03, 0.5)
    top.rotateX(-0.5)
    top.translate(x, 1.28, z)
    props.push(top)
  }
  const trashBin = (x: number, z: number) => {
    props.push(new THREE.CylinderGeometry(0.28, 0.32, 1.0, 8).translate(x, 0.5, z))
    props.push(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 8).translate(x, 1.02, z))
    trash.push({ x, z })
  }
  const bikeRack = (x: number, z: number) => {
    for (let k = 0; k < 3; k++) {
      props.push(new THREE.TorusGeometry(0.35, 0.03, 6, 12, Math.PI).rotateY(Math.PI / 2).translate(x + k * 0.7, 0.35, z))
    }
    bikeRacks.push({ x: x + 0.7, z })
  }
  const manhole = (x: number, z: number) => {
    props.push(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 16).translate(x, 0.05, z))
    manholeSpots.push({ x, z })
  }
  const streetSign = (x: number, z: number) => {
    props.push(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6).translate(x, 1.3, z))
    props.push(box(x - 0.5, 2.4, z - 0.04, x + 0.5, 2.6, z + 0.04))
  }
  const cafeTable = (x: number, z: number) => {
    props.push(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 12).translate(x, 0.72, z))
    props.push(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 6).translate(x, 0.36, z))
    for (const [ox, oz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]] as number[][]) {
      props.push(box(x + ox - 0.22, 0, z + oz - 0.22, x + ox + 0.22, 0.45, z + oz + 0.22))
      props.push(box(x + ox - 0.22, 0.45, z + oz - 0.04, x + ox + 0.22, 0.9, z + oz + 0.04))
    }
    cafeTables.push({ x, z })
  }
  const foodCart = (x: number, z: number) => {
    props.push(box(x - 0.95, 0.55, z - 0.5, x + 0.95, 1.05, z + 0.5))
    props.push(box(x - 1.0, 1.05, z - 0.55, x + 1.0, 1.2, z + 0.55))
    for (const sx of [-0.62, 0.62]) {
      props.push(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 10).rotateZ(Math.PI / 2).translate(x + sx, 0.22, z + 0.44))
      props.push(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 10).rotateZ(Math.PI / 2).translate(x + sx, 0.22, z - 0.44))
    }
    props.push(new THREE.CylinderGeometry(0.05, 0.05, 1.55, 6).translate(x, 1.95, z))
    props.push(new THREE.ConeGeometry(1.2, 0.5, 8).translate(x, 2.9, z))
    for (const [cx2, cz2] of [[x + 0.8, z + 1.2], [x - 0.85, z + 1.1]] as number[][]) {
      props.push(box(cx2 - 0.2, 0, cz2 - 0.15, cx2 + 0.2, 1.1, cz2 + 0.15))
      props.push(box(cx2 - 0.12, 1.1, cz2 - 0.12, cx2 + 0.12, 1.45, cz2 + 0.12))
    }
    addBlocker(x - 1.0, 0, z - 0.55, x + 1.0, 1.2, z + 0.55)
    carts.push({ x, z })
    cartSteam.push({ x, y: 1.25, z })
  }
  const bench = (x: number, z: number, yaw: number) => {
    const seat = box(-0.95, 0.45, -0.3, 0.95, 0.58, 0.3)
    const back = box(-0.95, 0.58, 0.3, 0.95, 1.15, 0.38)
    for (const g of [seat, back]) {
      g.rotateY(yaw + Math.PI)
      g.translate(x, 0, z)
      props.push(g)
    }
    benches.push({ x, z })
  }
  const planter = (x: number, z: number) => {
    props.push(box(x - 0.5, 0, z - 0.5, x + 0.5, 0.5, z + 0.5))
    putTree(x, z, 0.7)
  }
  const vendingMachine = (x: number, z: number, ry: number) => {
    const parts: THREE.BufferGeometry[] = [
      box(-0.45, 0, -0.3, 0.45, 1.9, 0.3),
      box(-0.36, 1.0, 0.3, 0.36, 1.75, 0.32),
      box(-0.3, 0.15, 0.31, 0.12, 0.45, 0.33),
    ]
    for (const g of parts) {
      g.rotateY(ry)
      g.translate(x, 0, z)
      props.push(g)
    }
    vending.push({ x, z, ry })
  }
  const trashBag = (x: number, z: number) => {
    const g = new THREE.SphereGeometry(0.3, 7, 5).scale(1 + rand() * 0.4, 0.72, 1)
    g.rotateY(rand() * 3)
    g.translate(x, 0.22, z)
    bags.push(g)
  }
  // abandoned car: long axis on local z, sunk roof and flat tyres so it reads as written off
  const wreck = (x: number, z: number, yaw: number) => {
    const rust = new THREE.Color(0x8a4b33)
    const dark = new THREE.Color(0x211c17)
    const parts: Geo[] = [
      box(-0.9, 0.24, -2.1, 0.9, 0.85, 2.1),
      box(-0.76, 0.85, -1.0, 0.76, 1.3, 0.85),
      box(-0.95, 0.3, -1.3, 0.95, 0.44, 0.3),
    ]
    paint(parts[0], rust)
    paint(parts[1], dark)
    paint(parts[2], rust)
    const tyre = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 8).rotateZ(Math.PI / 2)
    for (const [wx, wz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.4], [0.85, -1.4]] as number[][]) {
      const g = tyre.clone()
      paint(g, dark)
      g.translate(wx, 0.2, wz)
      parts.push(g)
    }
    const g = merge(parts)
    g.rotateZ(0.025)
    g.rotateY(yaw)
    g.translate(x, 0, z)
    wrecks.push(g)
    addBlocker(x - 2.2, 0, z - 1, x + 2.2, 1.4, z + 1)
  }
  const asphaltMat = new THREE.MeshStandardMaterial({ map: tex.asphalt, roughnessMap: tex.asphaltRough, roughness: 1, metalness: 0.06, envMapIntensity: 1.1 })
  const pavingMat = new THREE.MeshStandardMaterial({ map: tex.paving, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 })
  const lawnMat = new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 1, metalness: 0, envMapIntensity: 0.35 })
  const markMat = new THREE.MeshStandardMaterial({ color: 0x9a9a92, map: tex.markings, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  const facadeMats = tex.facade.map((f) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.82, metalness: 0.04, envMapIntensity: 0.35 })
    m.map!.repeat.set(1, 1)
    return m
  })
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x3b3f44, roughness: 0.95, envMapIntensity: 0.35 })
  const propMat = new THREE.MeshStandardMaterial({ color: 0x77716a, roughness: 0.85, envMapIntensity: 0.5 })
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x1e2226, roughness: 0.5, metalness: 0.08 })
  const wreckMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.12 })
  const bbMats = tex.bb.map((t) => new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.72, metalness: 0.08 }))
  const grafMats = tex.graffiti.map((t) => new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.3, roughness: 0.9, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }))
  const scaffoldMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1 })
  const laundryMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide })
  const posterMat = new THREE.MeshStandardMaterial({ map: tex.lostDog, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
  const NEON = [0xff3ea5, 0x33e1ff, 0xb14bff, 0xff8a2b]
  const NEON_T = [0.95, 0.55, 1, 0.35]
  const tint = new THREE.Color()

  group.add(new THREE.Mesh(rect(-HALF - 80, -HALF - 80, HALF + 80, HALF + 80, 0, (SPAN + 160) / 16, (SPAN + 160) / 16), asphaltMat))

  // markings: one strip per road segment between blocks, intersections left clear
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - 1; j++) {
      const a = line(j) + ROAD / 2
      const b = line(j + 1) - ROAD / 2
      const len = (b - a) / 6
      roads.push(rect(a, line(i) - ROAD / 2, b, line(i) + ROAD / 2, 0.05, len, 1))
      mark.push(rect(a, line(i) - ROAD / 2, b, line(i) + ROAD / 2, 0.055, len, 1))
      roads.push(rect(line(i) - ROAD / 2, a, line(i) + ROAD / 2, b, 0.05, len, 1))
      mark.push(rect(line(i) - ROAD / 2, a, line(i) + ROAD / 2, b, 0.055, len, 1))
    }
  }

  // zebra crossings: 5 stripes on each side of every intersection, none overhanging the ring
  const inner = (i: number) => i > 0 && i < N - 1
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const cx = line(i)
      const cz = line(j)
      for (const s of [-1, 1]) {
        const g = s > 0 ? ROAD / 2 + 0.6 : -(ROAD / 2 + 2.6)
        if (inner(j)) {
          for (let k = 0; k < 5; k++) {
            const o = -ROAD / 2 + 1.2 + k * 2.4
            mark.push(rect(cx + o - 0.4, cz + g, cx + o + 0.4, cz + g + 2, 0.056, 0.2, 1))
          }
        }
        if (inner(i)) {
          for (let k = 0; k < 5; k++) {
            const o = -ROAD / 2 + 1.2 + k * 2.4
            mark.push(rect(cx + g, cz + o - 0.4, cx + g + 2, cz + o + 0.4, 0.056, 0.2, 1))
          }
        }
      }
    }

  group.add(shadowy(new THREE.Mesh(merge(roads), asphaltMat), false))
  group.add(new THREE.Mesh(merge(mark), markMat))

  const special: Record<string, 'tower' | 'park' | 'market' | 'plaza'> = {
    '6,6': 'tower',
    '2,2': 'park',
    '3,2': 'park',
    '2,3': 'park',
    '10,9': 'park',
    '4,10': 'market',
    '5,10': 'market',
    '9,3': 'plaza',
  }

  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      const x0 = line(i) + ROAD / 2
      const z0 = line(j) + ROAD / 2
      const x1 = line(i + 1) - ROAD / 2
      const z1 = line(j + 1) - ROAD / 2
      const kind = special[`${i},${j}`]
      if (kind) zoneCenters.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, kind })
      const cx = (x0 + x1) / 2
      const cz = (z0 + z1) / 2
      const dist = Math.hypot(cx, cz)

      // curb ring + sidewalk paving
      paved.push(rect(x0, z0, x1, z1, 0.14, CELL / 4, CELL / 4))
      const t = CURB / 2
      for (const [a0, a1, b0, b1] of [
        [x0 - 0.6, x1 + 0.6, z0 - 0.6, z0 + 0.6],
        [x0 - 0.6, x1 + 0.6, z1 - 0.6, z1 + 0.6],
        [x0 - 0.6, x0 + 0.6, z0, z1],
        [x1 - 0.6, x1 + 0.6, z0, z1],
      ] as number[][]) {
        paved.push(box(a0, 0, b0, a1, CURB, b1))
      }

      // street trees at block corners and lights on diagonal
      for (let s = 0; s < 4; s++) {
        const px = s < 2 ? x0 + 2.2 : x1 - 2.2
        const pz = s % 2 === 0 ? z0 + 2.2 : z1 - 2.2
        if (rand() < 0.72) putTree(px, pz, 1)
      }
      lamps.push({ x: x0 + 0.9, z: z0 + 0.9 }, { x: x1 - 0.9, z: z1 - 0.9 })

      // eye-level sidewalk props scattered around the block
      if (rand() < 0.4) hydrant(x0 + 0.8, cz + (rand() < 0.5 ? -1 : 1) * 2)
      if (rand() < 0.5) {
        const tx = x1 - 1.2
        trashBin(tx, z0 + 1.2)
        for (let k = 0; k < 3 && bags.length < 46 && rand() < 0.6; k++) trashBag(tx + 0.4 + rand() * 0.9, z0 + 1.2 + (rand() - 0.5) * 1.6)
      }
      if (kind === 'park' || kind === 'plaza') {
        parkSpots.push({ x: cx, z: cz })
        bikeRack(x0 + 2, cz)
      }
      if (i > 0 && j > 0) manhole(x0 - 0.5, z0 - 0.5)
      if (rand() < 0.6) streetSign(x0 + 0.5, z0 + 0.5)
      // B8 — one mailbox/newsstand per ~block; capped so the whole city still reads sparse
      if (rand() < 0.35) mailbox(x0 + 1.7, cz + (rand() < 0.5 ? -2.6 : 2.6))
      if (nNews < 8 && rand() < 0.22) { nNews++; newsStand(x1 - 1.7, cz + (rand() < 0.5 ? -2.4 : 2.4)) }
      // B6 — lost-dog flyer pasted onto the last lamp post added for this block
      if (nPoster < 10 && rand() < 0.55) {
        nPoster++
        const lp = lamps[lamps.length - (rand() < 0.5 ? 1 : 2)]
        const ry = rand() * Math.PI * 2
        const pg = new THREE.PlaneGeometry(0.32, 0.42)
        pg.rotateY(ry)
        pg.translate(lp.x + Math.sin(ry) * 0.07, 1.35, lp.z + Math.cos(ry) * 0.07)
        posters.push(pg)
      }
      if (rand() < 0.1) {
        const sx = rand() < 0.5 ? x0 + 0.8 : x1 - 0.8
        const sz = cz + (rand() < 0.5 ? -2 : 2)
        const ry = sx === x0 + 0.8 ? Math.PI / 2 : -Math.PI / 2
        vendingMachine(sx, sz, ry)
      }
      if (kind === 'market') {
        cafeTable(x1 - 2, cz + (rand() < 0.5 ? -1 : 1) * 3)
        if (carts.length < 2) foodCart(x0 + 2.2, cz + (rand() < 0.5 ? -2.5 : 2.5))
      }
      if (rand() < 0.25) planter(x1 - 1.5, z0 + 3)
      if (!kind && nBB < 8 && rand() < 0.06) {
        nBB++
        const bxc = lerp(x0 + 10, x1 - 10, rand())
        for (const s of [-2.6, 2.6]) {
          props.push(new THREE.CylinderGeometry(0.18, 0.26, 6.2, 6).translate(bxc + s, 3.1, z0 + 1.5))
          addBlocker(bxc + s - 0.3, 0, z0 + 1.2, bxc + s + 0.3, 3, z0 + 1.8)
        }
        props.push(box(bxc - 4.2, 5.9, z0 + 1.34, bxc + 4.2, 10.3, z0 + 1.5))
        bbFace[nBB % tex.bb.length].push(new THREE.PlaneGeometry(8, 4).rotateY(Math.PI).translate(bxc, 8.1, z0 + 1.3))
      }
      if (!kind && nWreck < 6 && rand() < 0.05) {
        nWreck++
        wreck(lerp(x0 + 6, x1 - 6, rand()), line(j) + 5.2, Math.PI / 2 + (rand() - 0.5) * 0.3)
      }

      if (kind === 'park') {
        lawn.push(rect(x0 + 1, z0 + 1, x1 - 1, z1 - 1, 0.17, CELL / 6, CELL / 6))
        paved.push(rect(cx - 1.6, z0 + 1, cx + 1.6, z1 - 1, 0.175, 1, CELL / 4))
        paved.push(rect(x0 + 1, cz - 1.6, x1 - 1, cz + 1.6, 0.175, CELL / 4, 1))
        for (let k = 0; k < 26; k++) {
          const px = lerp(x0 + 4, x1 - 4, rand())
          const pz = lerp(z0 + 4, z1 - 4, rand())
          if (Math.abs(px - cx) < 3 || Math.abs(pz - cz) < 3) continue
          putTree(px, pz, 1.1 + rand() * 0.9)
        }
        props.push(box(cx - 3.2, 0.14, cz - 3.2, cx + 3.2, 0.6, cz + 3.2))
        addBlocker(cx - 3.2, 0, cz - 3.2, cx + 3.2, 0.6, cz + 3.2)
        props.push(new THREE.CylinderGeometry(2.6, 2.6, 0.2, 20).translate(cx, 0.66, cz))
        addBlocker(cx - 2.6, 0, cz - 2.6, cx + 2.6, 0.9, cz + 2.6)
        for (const b of [
          [cx - 5.5, cz, Math.PI / 2],
          [cx + 5.5, cz, -Math.PI / 2],
        ] as number[][]) {
          bench(b[0], b[1], b[2])
        }
        continue
      }

      if (kind === 'plaza') {
        paved.push(rect(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, 0.175, CELL / 2, CELL / 2))
        props.push(new THREE.CylinderGeometry(4, 4.4, 0.5, 24).translate(cx, 0.39, cz))
        addBlocker(cx - 4.2, 0, cz - 4.2, cx + 4.2, 0.9, cz + 4.2)
        for (const b of [
          [cx - 7, cz, Math.PI / 2],
          [cx + 7, cz, -Math.PI / 2],
        ] as number[][]) {
          bench(b[0], b[1], b[2])
        }
        for (let k = 0; k < 10; k++) putTree(lerp(x0 + 4, x1 - 4, rand()), lerp(z0 + 4, z1 - 4, rand()), 1.2)
        continue
      }

      const lots: Lot[] = []
      if (kind === 'tower') {
        const pad = 12
        paved.push(rect(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, 0.175, CELL / 2.5, CELL / 2.5))
        // stepped core
        const w0 = CELL - ROAD - pad * 2
        const h1 = 220
        const h2 = 300
        const wash = makeWash(rand)
        const put = (w: number, d: number, y0: number, y1: number, v: number) => {
          const g = boxUV(new THREE.BoxGeometry(w, y1 - y0, d), w, y1 - y0, d)
          g.translate(cx, (y0 + y1) / 2, cz)
          paint(addRand(g, rand()), wash(0.9 + rand() * 0.2))
          wall[v].push(g)
        }
        const roofBox = (g: Geo) => {
          paint(g, wash(0.6 + rand() * 0.25))
          roof.push(g)
        }
        put(w0, w0, 0, h1, 1)
        put(w0 * 0.62, w0 * 0.62, h1, h2, 1)
        const w2 = w0 * 0.62
        roofBox(box(cx - w0 / 2 - 0.4, h1 - 0.6, cz - w0 / 2 - 0.4, cx + w0 / 2 + 0.4, h1 + 0.05, cz + w0 / 2 + 0.4))
        roofBox(box(cx - w2 / 2 - 0.4, h2 - 0.6, cz - w2 / 2 - 0.4, cx + w2 / 2 + 0.4, h2 + 0.05, cz + w2 / 2 + 0.4))
        props.push(new THREE.CylinderGeometry(0.5, 1.4, 60, 8).translate(cx, h2 + 30, cz))
        addBlocker(cx - w0 / 2, 0, cz - w0 / 2, cx + w0 / 2, h2 + 60, cz + w0 / 2)
        for (let k = 0; k < 6; k++) putTree(lerp(x0 + 3, x1 - 3, rand()), lerp(z0 + 3, z1 - 3, rand()), 1)
        continue
      }

      splitLot({ x0: x0 + 3.2, z0: z0 + 3.2, x1: x1 - 3.2, z1: z1 - 3.2 }, rand, kind === 'market' ? 2 : 3, lots)
      const urban = 1 - clamp(dist / (HALF * 0.8), 0, 1)
      for (const l of lots) {
        const w = l.x1 - l.x0
        const d = l.z1 - l.z0
        if (w < 6 || d < 6) continue
        const inset = rand() * 2
        const bx0 = l.x0 + inset
        const bz0 = l.z0 + inset
        const bx1 = l.x1 - inset
        const bz1 = l.z1 - inset
        const base = lerp(7, 42, urban * urban)
        const span = lerp(14, 96, urban * urban * urban)
        let h = base + rand() * span
        if (rand() < 0.04) h += 50 + rand() * 40
        h = Math.round(h / TILE) * TILE
        const bw = bx1 - bx0, bd = bz1 - bz0
        const style: Style = h > 80 ? 'tower' : h > 35 ? 'midrise' : rand() < 0.35 ? 'shop' : 'lowrise'
        const grp = style === 'tower' || style === 'midrise' ? MODERN : MASONRY
        const v = grp[Math.floor(rand() * grp.length)]
        const built = buildingGeo((bx0 + bx1) / 2, (bz0 + bz1) / 2, bw, bd, h, style, rand)
        wall[v].push(built.wallGeo)
        if (built.doorGeo) wall[v].push(built.doorGeo)
        if (built.door) {
          const s = built.door
          const dx = s.hx - (bx0 + bx1) / 2
          const dz = s.hz - (bz0 + bz1) / 2
          const len = Math.hypot(dx, dz) || 1
          s.exit = { x: s.hx + (dx / len) * 2.8, z: s.hz + (dz / len) * 2.8 }
          doorSpots.push(s)
        }
        if (alleySpots.length < 10 && style !== 'tower' && rand() < 0.14) {
          const ax = (bx0 + bx1) / 2, az = bz1 + 1.4
          props.push(box(ax - 0.6, 0, az - 0.45, ax + 0.6, 1.0, az + 0.45))
          props.push(box(ax - 0.62, 1.0, az - 0.47, ax + 0.62, 1.16, az + 0.47))
          alleySpots.push({ x: ax + 1.15, z: az, px: ax, pz: az, py: 1.25 })
        }
        if ((style === 'lowrise' || style === 'shop') && rand() < 0.24) {
          const gv = Math.floor(rand() * graf.length)
          for (let f = 0, nf = rand() < 0.3 ? 2 : 1; f < nf; f++) {
            const face = Math.floor(rand() * 4)
            const g = new THREE.PlaneGeometry(2.4, 1.3)
            const ex = lerp(bx0 + 1.6, bx1 - 1.6, rand())
            const ez = lerp(bz0 + 1.6, bz1 - 1.6, rand())
            if (face === 0) { g.rotateY(Math.PI); g.translate(ex, 1.45, bz0 - 0.06) }
            else if (face === 1) g.translate(ex, 1.45, bz1 + 0.06)
            else if (face === 2) { g.rotateY(-Math.PI / 2); g.translate(bx0 - 0.06, 1.45, ez) }
            else { g.rotateY(Math.PI / 2); g.translate(bx1 + 0.06, 1.45, ez) }
            graf[gv].push(g)
          }
        }
        if (built.roofGeo) roof.push(built.roofGeo)
        if (built.propGeo) props.push(built.propGeo)
        if (built.scaffoldGeo) scaffold.push(built.scaffoldGeo)
        if (built.laundryGeo) laundry.push(built.laundryGeo)
        if (built.scaffoldGeo && constructionSpots.length < 12) constructionSpots.push({ x: (bx0 + bx1) / 2, z: (bz0 + bz1) / 2 })
        if (built.acs.length && acHumSpots.length < 24) acHumSpots.push({ x: (bx0 + bx1) / 2, z: (bz0 + bz1) / 2 })
        for (const a of built.acs) if (acSpots.length < 4) acSpots.push(a)
        // C9 — ground-floor windows spill light onto the pavement at low sun; thin to ~40% of
        // buildings so the shafts spread across the whole grid instead of clustering at the cap
        if (shaftSpots.length < SHAFT_CAP && rand() < 0.4) {
          const step = TILE / WINDOW_GRID[v].bays
          const faces: [number, number, number, number, number, number][] = [
            [0, 0, 1, bx0, bx1, bz1],
            [0, 0, -1, bx0, bx1, bz0],
            [1, 1, 0, bz0, bz1, bx1],
            [1, -1, 0, bz0, bz1, bx0],
          ]
          for (const [ax, nx, nz, s0, s1, fixed] of faces) {
            const n = Math.max(1, Math.floor((s1 - s0) / step))
            const d = (s1 - s0) / n
            for (let k = 0; k < n && shaftSpots.length < SHAFT_CAP; k++) {
              const c = s0 + d * (k + 0.5)
              shaftSpots.push({ x: ax === 0 ? c : fixed, z: ax === 0 ? fixed : c, nx, nz })
            }
          }
        }
        addBlocker(bx0, 0, bz0, bx1, h, bz1)
        if (urban > 0.6 && rand() < 0.45) {
          const cIdx = Math.floor(rand() * NEON.length)
          const o = rand()
          const sgn = rand() < 0.5 ? -1 : 1
          const vertical = rand() < 0.25
          const nw = vertical ? 0.9 : Math.min(bw * 0.55, 5)
          const nh = vertical ? 3.0 : 1.3
          const nyBase = vertical ? 2.4 : 3.2 + rand() * 2
          const sz = sgn < 0 ? bz0 - 0.15 : bz1 + 0.15
          const ng = new THREE.PlaneGeometry(nw, nh)
          if (sgn < 0) ng.rotateY(Math.PI)
          ng.translate((bx0 + bx1) / 2, nyBase + nh / 2, sz)
          ng.userData = { c: cIdx, o }
          neon.push(ng)

          // wet reflection — taller for vertical signs
          const reflW = nw * 1.4
          const reflH = vertical ? 6.5 : 5.5
          const refl = new THREE.PlaneGeometry(reflW, reflH)
          refl.rotateX(-Math.PI / 2)
          refl.translate((bx0 + bx1) / 2, 0.18, sgn < 0 ? sz - 2.2 : sz + 2.2)
          refl.userData = { c: cIdx, o }
          neonRefl.push(refl)
        }
      }
      // courtyard paving fills whatever the lots left open
      paved.push(rect(x0 + 1, z0 + 1, x1 - 1, z1 - 1, 0.15, CELL / 4, CELL / 4))
    }
  }

  for (let v = 0; v < wall.length; v++) if (wall[v].length) group.add(shadowy(new THREE.Mesh(merge(wall[v]), facadeMats[v])))
  group.add(shadowy(new THREE.Mesh(merge(roof), roofMat)))
  if (bags.length) group.add(shadowy(new THREE.Mesh(merge(bags), bagMat)))
  if (wrecks.length) group.add(shadowy(new THREE.Mesh(merge(wrecks), wreckMat)))
  for (let v = 0; v < bbFace.length; v++) if (bbFace[v].length) group.add(new THREE.Mesh(merge(bbFace[v]), bbMats[v]))
  for (let v = 0; v < graf.length; v++) if (graf[v].length) group.add(new THREE.Mesh(merge(graf[v]), grafMats[v]))
  group.add(shadowy(new THREE.Mesh(merge(paved), pavingMat), false))
  group.add(shadowy(new THREE.Mesh(merge(lawn), lawnMat), false))

  // street lights: posts, plus one additive point cloud for the bulbs
  const post: Bag = []
  for (const l of lamps) {
    post.push(new THREE.CylinderGeometry(0.12, 0.16, 8, 6).translate(l.x, 4, l.z))
    props.push(box(l.x - 0.1, 7.7, l.z - 0.1, l.x + 0.1, 7.95, l.z + 0.1))
    addBlocker(l.x - 0.18, 0, l.z - 0.18, l.x + 0.18, 3, l.z + 0.18)
  }
  for (const s of neon) {
    const c = s.userData.c as number
    const o = s.userData.o as number
    paint(s, tint.setHSL((c + o) / 7, NEON_T[c % 4], 0.6))
  }
  const neonMat = new THREE.MeshBasicMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    side: THREE.DoubleSide,
    opacity: 0,
    fog: true,
  })
  if (neon.length) {
    const signs = new THREE.Mesh(merge(neon), neonMat)
    signs.renderOrder = 5
    group.add(signs)
  }
  const reflTint = new THREE.Color()
  for (const s of neonRefl) {
    const c = s.userData.c as number
    const o = s.userData.o as number
    paint(s, reflTint.setHSL((c + o) / 7, NEON_T[c % 4] * 0.7, 0.4))
  }
  const neonReflMat = new THREE.MeshBasicMaterial({
    map: tex.pool,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    opacity: 0,
    fog: true,
  })
  if (neonRefl.length) {
    const reflMesh = new THREE.Mesh(merge(neonRefl), neonReflMat)
    reflMesh.renderOrder = 4
    group.add(reflMesh)
  }
  const glowPos = new Float32Array(lamps.length * 3)
  lamps.forEach((l, k) => {
    glowPos[k * 3] = l.x
    glowPos[k * 3 + 1] = 7.6
    glowPos[k * 3 + 2] = l.z
  })
  const glowGeo = new THREE.BufferGeometry()
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3))
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex.glow }, tint: { value: new THREE.Color(0x000000) } },
    vertexShader: `
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(0.001, -mv.z);
        gl_PointSize = clamp(2600.0 / d, 4.0, 74.0);
        vA = smoothstep(520.0, 90.0, d);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 tint;
      varying float vA;
      void main() {
        float a = texture2D(map, gl_PointCoord).a * vA;
        gl_FragColor = vec4(tint * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const lampGlow = new THREE.Points(glowGeo, glowMat)
  lampGlow.frustumCulled = false
  lampGlow.visible = false
  lampGlow.renderOrder = 6
  // poles get their own material so the awning sway patch never bends them
  group.add(new THREE.Mesh(merge(post), propMat.clone()))
  group.add(lampGlow)

  // light pool on the ground under each lamp: one instanced additive quad
  const poolMat = new THREE.MeshBasicMaterial({
    map: tex.pool,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0,
    fog: true,
  })
  const pools = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(17, 17).rotateX(-Math.PI / 2),
    poolMat,
    lamps.length,
  )
  lamps.forEach((l, k) => pools.setMatrixAt(k, new THREE.Matrix4().makeTranslation(l.x, 0.19, l.z)))
  pools.instanceMatrix.needsUpdate = true
  pools.frustumCulled = false
  pools.renderOrder = 4
  group.add(pools)

  // 10 fixed low spots on the roads; the engine ramps opacity (fill 5min in rain, drain 30min dry)
  const PUD = 10
  const puddleSpots: { x: number; z: number; r: number }[] = []
  const puddleMat = poolMat.clone()
  const puddles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), puddleMat, PUD)
  for (let k = 0; k < PUD; k++) {
    const onX = k % 2 === 0
    const idx = Math.floor(rand() * N)
    const across = line(idx) + (rand() - 0.5) * ROAD * 0.7
    const along = lerp(-HALF + 20, HALF - 20, rand())
    const s = 5 + rand() * 7
    const px = onX ? along : across
    const pz = onX ? across : along
    puddleSpots.push({ x: px, z: pz, r: s / 2 })
    puddles.setMatrixAt(k, new THREE.Matrix4().makeScale(s, 1, s).setPosition(px, 0.07, pz))
  }
  puddles.instanceMatrix.needsUpdate = true
  puddles.frustumCulled = false
  puddles.visible = false
  group.add(puddles)

  // trees: one instanced merged geometry, vertex colours separate canopy from trunk
  const canopy = new THREE.IcosahedronGeometry(2.2, 1).toNonIndexed()
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6).toNonIndexed()
  trunk.translate(0, 1.6, 0)
  canopy.translate(0, 4.4, 0)
  paint(trunk, new THREE.Color(0x4a3a2a))
  paint(canopy, new THREE.Color(0xffffff))
  const treeGeo = mergeGeometries([trunk, canopy], false)!
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.4 })
  // trees: 4×4 chunks, one instanced mesh per cell with its own bounding sphere, so the
  // frustum culler can drop whole quadrants instead of drawing every tree each frame
  const TC = 4
  const tc = new THREE.Color()
  for (let iz = 0; iz < TC; iz++) {
    for (let ix = 0; ix < TC; ix++) {
      const cx = (ix + 0.5) * (SPAN / TC) - HALF
      const cz = (iz + 0.5) * (SPAN / TC) - HALF
      const cell: number[] = []
      trees.forEach((m, k) => {
        const e = m.elements
        if (Math.abs(e[12] - cx) < SPAN / (TC * 2) && Math.abs(e[14] - cz) < SPAN / (TC * 2)) cell.push(k)
      })
      if (!cell.length) continue
      const mesh = new THREE.InstancedMesh(treeGeo, treeMat, cell.length)
      cell.forEach((k, i) => {
        mesh.setMatrixAt(i, trees[k])
        tc.setHSL(0.28 + (k % 7) * 0.008, 0.34 + (k % 5) * 0.03, 0.3 + (k % 3) * 0.04)
        mesh.setColorAt(i, tc)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.castShadow = true
      mesh.computeBoundingSphere()
      group.add(mesh)
    }
  }

  if (props.length) group.add(shadowy(new THREE.Mesh(merge(props), propMat)))
  if (scaffold.length) group.add(shadowy(new THREE.Mesh(merge(scaffold), scaffoldMat), false))
  if (laundry.length) group.add(new THREE.Mesh(merge(laundry), laundryMat))
  if (posters.length) group.add(new THREE.Mesh(merge(posters), posterMat))

  // instanced shop doors: one left-hinged panel per door, swung open by the engine on proximity.
  // geometry is offset +dw/2 in local x so its left edge sits on the instance origin = the hinge.
  const dgeo = new THREE.PlaneGeometry(1.3, 2.4).translate(0.65, 0, 0)
  const dmat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 0.4 })
  const doors = new THREE.InstancedMesh(dgeo, dmat, Math.max(doorSpots.length, 1))
  doors.frustumCulled = false
  doors.castShadow = true
  doorSpots.forEach((d, i) => doors.setMatrixAt(i, new THREE.Matrix4().makeRotationY(d.ry).setPosition(d.hx, d.hy, d.hz)))
  if (doorSpots.length) group.add(doors)

  // solid proxy used only by the camera ray (never rendered)
  const blocker = new THREE.Mesh(merge(solidGeo), new THREE.MeshBasicMaterial())
  blocker.visible = false
  blocker.matrixAutoUpdate = false
  group.add(blocker)
  blockers.push(blocker)

  group.updateMatrixWorld(true)
  boxes.forEach((b, idx) => {
    const kx = cellKey((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2)
    let arr = hash.get(kx)
    if (!arr) hash.set(kx, (arr = []))
    arr.push(idx)
  })

  const hit = (pos: THREE.Vector3, r: number) => {
    const k = cellKey(pos.x, pos.z)
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const arr = hash.get(k + dx * 1024 + dz)
        if (!arr) continue
        for (const idx of arr) {
          const b = boxes[idx]
          const nx = clamp(pos.x, b.min.x, b.max.x)
          const nz = clamp(pos.z, b.min.z, b.max.z)
          let ox = pos.x - nx
          let oz = pos.z - nz
          const d2 = ox * ox + oz * oz
          if (d2 >= r * r) continue
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2)
            pos.x = nx + (ox / d) * r
            pos.z = nz + (oz / d) * r
          } else {
            const toL = pos.x - b.min.x + r
            const toR = b.max.x - pos.x + r
            const toB = pos.z - b.min.z + r
            const toF = b.max.z - pos.z + r
            const m = Math.min(toL, toR, toB, toF)
            if (m === toL) pos.x = b.min.x - r
            else if (m === toR) pos.x = b.max.x + r
            else if (m === toB) pos.z = b.min.z - r
            else pos.z = b.max.z + r
          }
        }
      }
    pos.x = clamp(pos.x, -HALF - 60, HALF + 60)
    pos.z = clamp(pos.z, -HALF - 60, HALF + 60)
  }

  return { group, spawn, blockers, hit, facadeMats, bbMats, treeMat, propMat, asphaltMat, lampGlow, neonMat, neonReflMat, pools, puddles, puddleSpots, parkSpots, zoneCenters, doors, doorSpots, lampSpots: lamps, benches, vending, trash, bikeRacks, acSpots, acHumSpots, constructionSpots, steamSpots: [...manholeSpots.slice(0, 3).map((m) => ({ x: m.x, y: 0.15, z: m.z })), ...cartSteam], carts, cafeTables, alleySpots, shaftSpots }
}
