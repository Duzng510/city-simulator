import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js'
import { buildCity, type Door } from './city'
import { buildEntities } from './entities'
import { makeObserver, makePlayer } from './player'
import { spawnCharacter } from './character'
import { clamp, lerp, smooth, rng, rushHour } from './util'
import { makeTextures } from './textures'
import { makeBike, makeInterior } from './props'
import { makeRain } from './weather'
import { makeSteam, makeDrips, makeShafts, makeSpeedLines } from './fx'
import { makeAmbient } from './audio'

export type Tier = 'low' | 'medium' | 'high' | 'ultra'
export type Mode = 'player' | 'observe'

export interface Effects {
  shadows: boolean
  ao: boolean
  bloom: boolean
  grain: boolean
  grade: boolean
}

export interface Stats {
  fps: number
  hour: number
  mode: Mode
  speed: number
  x: number
  z: number
  tris: number
  paused: boolean
  inCar: boolean
  tier: Tier
}

const CONF: Record<Tier, { ratio: number; shadow: number; samples: number; post: boolean; fog: number; aoBlend: number }> = {
  low: { ratio: 1.0, shadow: 0, samples: 0, post: false, fog: 0.003, aoBlend: 0 },
  medium: { ratio: 1.0, shadow: 1024, samples: 2, post: true, fog: 0.0022, aoBlend: 0.55 },
  high: { ratio: 1.35, shadow: 2048, samples: 4, post: true, fog: 0.0018, aoBlend: 0.7 },
  ultra: { ratio: 1.6, shadow: 4096, samples: 4, post: true, fog: 0.0015, aoBlend: 0.85 },
}
const TIERS: Tier[] = ['low', 'medium', 'high', 'ultra']

const DAY = new THREE.Color(0xa6bed8)
const DUSK = new THREE.Color(0xd07840)
const NIGHT = new THREE.Color(0x080e1a)
const GREY = new THREE.Color(0x6b7684)
const WHITE = new THREE.Color(0xffffff)

const GRAIN_SHADER = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0.04 }, vignette: { value: 0.45 } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse;
uniform float time;
uniform float amount;
uniform float vignette;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = vUv - 0.5;
  c.rgb *= 1.0 - vignette * dot(d, d);
  c.rgb += (hash(vUv * 1024.0 + fract(time)) - 0.5) * amount;
  gl_FragColor = c;
}`,
}

const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, lift: { value: 0.015 }, gamma: { value: 0.98 }, gain: { value: 1.02 }, sat: { value: 1.08 }, tint: { value: new THREE.Vector3(1, 1, 1) }, ca: { value: 0 } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse;
uniform float lift, gamma, gain, sat, ca;
uniform vec3 tint;
varying vec2 vUv;
void main() {
  vec2 off = (vUv - 0.5) * ca;
  vec4 c = vec4(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b, 1.0);
  c.rgb = pow(max(c.rgb * gain + lift, 0.0), vec3(1.0 / gamma));
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(vec3(g), c.rgb, sat);
  c.rgb *= tint;
  gl_FragColor = c;
}`,
}

export const FILTERS = {
  none: { lift: 0.015, gamma: 0.98, gain: 1.02, sat: 1.08, tint: [1, 1, 1] },
  film: { lift: 0.035, gamma: 1.02, gain: 0.96, sat: 0.82, tint: [1.02, 1, 0.96] },
  noir: { lift: 0.02, gamma: 1.0, gain: 1.08, sat: 0, tint: [1, 1, 1.03] },
  warm: { lift: 0.02, gamma: 0.97, gain: 1.05, sat: 1.18, tint: [1.12, 1, 0.85] },
  cool: { lift: 0.01, gamma: 1.01, gain: 1.0, sat: 1.05, tint: [0.85, 0.98, 1.15] },
} as const
export type Filter = keyof typeof FILTERS

export function createEngine(canvas: HTMLCanvasElement, onStats: (s: Stats) => void, onLine?: (t: string) => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(62, 1, 0.25, 1600)
  scene.fog = new THREE.FogExp2(0x9fb6cf, 0.0032)
  const speedLines = makeSpeedLines()
  camera.add(speedLines.lines)

  const tex = makeTextures(renderer.capabilities.getMaxAnisotropy())
  const city = buildCity(tex)
  scene.add(city.group)
  const uNight = { value: 0 }
  const uHour = { value: 17.8 }
  const timeU = { value: 0 }
  city.facadeMats.forEach((m, v) => {
    m.onBeforeCompile = (s) => {
      s.uniforms.uNight = uNight
      s.uniforms.uHour = uHour
      s.uniforms.uTime = timeU
      s.uniforms.uInterior = { value: tex.facade[v].interior }
      s.uniforms.uInteriorMix = { value: 0.55 }
      s.vertexShader =
        'attribute float aRand;\nattribute float aKind;\nvarying float vRand;\nvarying float vKind;\n' +
        'varying vec3 vObjN;\nvarying vec3 vObjT;\nvarying vec3 vObjB;\nvarying vec3 vObjView;\nvarying float vDist;\n' +
        s.vertexShader.replace('void main() {', `void main() {
  vRand = aRand;
  vKind = aKind;
  vec3 _n = normalize(normal);
  vObjN = _n;
  vec3 _T, _B;
  if (abs(_n.y) > 0.5) { _T = vec3(1.0, 0.0, 0.0); _B = vec3(0.0, 0.0, 1.0); }
  else if (abs(_n.x) > 0.5) { _T = vec3(0.0, 0.0, sign(_n.x)); _B = vec3(0.0, 1.0, 0.0); }
  else { _T = vec3(sign(_n.z), 0.0, 0.0); _B = vec3(0.0, 1.0, 0.0); }
  vObjT = _T; vObjB = _B;
  vec3 _wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vDist = distance(cameraPosition, _wp);
  vObjView = normalize(cameraPosition - _wp);`)
      s.fragmentShader = `uniform float uNight;\nuniform float uHour;\nuniform float uTime;\nuniform sampler2D uInterior;\nuniform float uInteriorMix;\nvarying float vRand;\nvarying float vKind;\nvarying vec3 vObjN;\nvarying vec3 vObjT;\nvarying vec3 vObjB;\nvarying vec3 vObjView;\nvarying float vDist;\n` +
        s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float _stagger = (vRand - 0.5) * 1.0;
        float _t = uHour + _stagger;
        float _shop = smoothstep(6.5, 7.5, _t) * (1.0 - smoothstep(20.5, 21.5, _t));
        float _isDoor = step(1.5, vKind);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.10, 0.07, 0.05), vec3(0.30, 0.31, 0.34), 1.0 - _shop), _isDoor);
        if (vDist < 200.0) {
          vec3 _V = normalize(vObjView);
          float _graze = 1.0 - abs(dot(_V, vObjN));
          vec2 _poff = vec2(dot(_V, vObjT), dot(_V, vObjB)) * 0.022 * _graze;
          vec4 _room = texture2D(uInterior, vMapUv + _poff);
          float _win = _room.a * (1.0 - _isDoor) * (1.0 - step(0.5, abs(vObjN.y)));
          diffuseColor.rgb = mix(diffuseColor.rgb, _room.rgb, _win * uInteriorMix);
        }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float _office   = smoothstep(7.5, 8.5, _t) * (1.0 - smoothstep(17.5, 18.5, _t));
        float _resident = max(smoothstep(18.0, 19.0, _t), 1.0 - smoothstep(5.5, 6.5, _t));
        float _bar      = max(smoothstep(19.5, 20.5, _t), 1.0 - smoothstep(2.5, 3.5, _t));
        float _isOffice   = step(vRand, 0.4);
        float _isResident = step(0.4, vRand) * step(vRand, 0.8);
        float _isBar      = step(0.8, vRand);
        float _isShopB = step(0.5, vKind) * (1.0 - _isDoor);
        float _lit = mix(_office * _isOffice + _resident * _isResident + _bar * _isBar, _shop, _isShopB);
        float _flicker = 0.85 + 0.15 * sin(uTime * 3.7 + vRand * 91.3);
        _lit *= mix(1.0, _flicker, step(0.7, vRand) * step(vRand, 0.75));
        totalEmissiveRadiance *= _lit * uNight;
        float _openSign = _isDoor * uNight * (0.15 + 0.5 * _shop);
        totalEmissiveRadiance.rgb = mix(totalEmissiveRadiance.rgb, vec3(1.0, 0.62, 0.26), _openSign);`)
    }
    m.emissiveIntensity = 1.05
  })
  city.treeMat.onBeforeCompile = (s) => {
    s.uniforms.uTime = timeU
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec4 wp = instanceMatrix * vec4(transformed, 1.0);
       float sway = sin(uTime * 1.1 + wp.x * 0.09 + wp.z * 0.07);
       transformed.x += sway * 0.05 * max(0.0, position.y - 2.2);
       transformed.z += sway * 0.03 * max(0.0, position.y - 2.2);`,
    )
  }
  // canopy band only — awnings sit at y 3.2..4.3, rooftop props are above it
  city.propMat.onBeforeCompile = (s) => {
    s.uniforms.uTime = timeU
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float band = step(3.0, position.y) * step(position.y, 4.5);
       transformed.z += sin(uTime * 1.8 + position.x * 0.5 + position.z * 0.4) * 0.02 * band;`,
    )
  }
  const ents = buildEntities(tex, 5150, city.doorSpots, city.parkSpots, city.alleySpots)
  scene.add(ents.group)

  // C8 — rooftop AC drips + manhole steam: two time-driven point clouds, no per-frame CPU
  const steam = makeSteam(city.steamSpots, tex.glow)
  const drips = makeDrips(city.acSpots, tex.glow)
  steam.mat.uniforms.t = timeU
  drips.mat.uniforms.t = timeU
  steam.points.renderOrder = 6
  drips.points.renderOrder = 6
  scene.add(steam.points, drips.points)

  // C9 — dawn/dusk window light shafts spilling onto the pavement
  const shafts = makeShafts(city.shaftSpots)
  shafts.mesh.renderOrder = 5
  scene.add(shafts.mesh)

  const q = new URLSearchParams(location.search)
  const rain = makeRain(tex.rain, Number(q.get('rain')) || 0)
  let rainTarget = rain.amount
  let puddle = 0
  // one reusable ring mesh: a step in a puddle throws an expanding, fading ripple
  const ripple = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 1, 12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0xdcecff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  )
  ripple.renderOrder = 5
  ripple.visible = false
  scene.add(ripple)
  let rippleT = 1
  scene.add(rain.points)
  scene.add(rain.splashes)
  const ambient = makeAmbient()
  ents.onHonk(() => ambient.horn())
  ents.onMeow(() => ambient.meow())
  ents.onSiren(() => ambient.siren())
  let stepAcc = 0

  const player = makePlayer(city.spawn)
  scene.add(player.root)
  const character = spawnCharacter()
  player.root.add(character.root)

  // busker: one character parked at the plaza, plugging an acoustic set after dark
  const busker = spawnCharacter()
  const plazaZone = city.zoneCenters.find((z) => z.kind === 'plaza')
  const busX = plazaZone ? plazaZone.x + 4 : city.spawn.x
  const busZ = plazaZone ? plazaZone.z : city.spawn.z
  busker.root.position.set(busX, 0, busZ)
  busker.root.rotation.y = Math.PI * 0.5
  const wood = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })
  const gtrBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.14), wood(0x7a4a24))
  gtrBody.position.set(0.05, 1.1, 0.32)
  gtrBody.rotation.x = -0.3
  const gtrNeck = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.05), wood(0x4a2c14))
  gtrNeck.position.set(0.02, 1.62, 0.22)
  gtrNeck.rotation.x = 0.5
  const tipBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.3), wood(0x2b2f3a))
  tipBox.position.set(0.05, 0.11, 0.7)
  busker.root.add(gtrBody, gtrNeck, tipBox)
  scene.add(busker.root)
  let buskerTipped = false
  let buskerGather = 0

  // B?: café patrons — reuse the character rig, seated at market café tables so the patio reads as occupied
  const SEAT = [{ ox: 0.9, oz: 0 }, { ox: -0.9, oz: 0 }, { ox: 0, oz: 0.9 }, { ox: 0, oz: -0.9 }]
  const crnd = rng(7717)
  let seated = 0
  for (const tb of city.cafeTables) {
    if (seated >= 12) break
    if (crnd() >= 0.6) continue
    const spots = crnd() < 0.4
      ? [SEAT[Math.floor(crnd() * 4)]]
      : crnd() < 0.5 ? [SEAT[0], SEAT[1]] : [SEAT[2], SEAT[3]]
    for (const s of spots) {
      const c = spawnCharacter()
      c.sit()
      c.root.position.set(tb.x + s.ox, 0, tb.z + s.oz)
      c.root.rotation.y = Math.atan2(-s.ox, -s.oz)
      scene.add(c.root)
      seated++
    }
  }

  // litter (B5): the can you bought rides in your hand until a bin takes it
  const canMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0xd03050, roughness: 0.35, metalness: 0.4 }))
  canMesh.position.set(0.34, 1.06, 0.16)
  canMesh.visible = false
  player.root.add(canMesh)

  const bikeModel = makeBike()
  scene.add(bikeModel)

  const interior = makeInterior()
  scene.add(interior)
  const observer = makeObserver(new THREE.Vector3(city.spawn.x, 40, city.spawn.z + 30))

  // driving (B1): arcade velocity model that owns one parked traffic slot
  let inCar = false
  const car = { x: 0, z: 0, yaw: 0, sp: 0, vx: 0, vz: 0, yawVel: 0, pitch: 0, roll: 0, lat: 0 }
  const camPos = new THREE.Vector3()
  const camLook = new THREE.Vector3()
  const camVel = new THREE.Vector3()
  const camLookSmooth = new THREE.Vector3()
  const camDelta = new THREE.Vector3()
  // critically-damped-ish spring (ratio 0.9 -> slight overshoot); reads/writes camPos/camLook
  function chaseCam(dt: number, speed: number, maxSp: number) {
    const D = 2 * Math.sqrt(18) * 0.9
    camVel.addScaledVector(camDelta.subVectors(camPos, camera.position).multiplyScalar(18).addScaledVector(camVel, -D), dt)
    camera.position.addScaledVector(camVel, dt)
    camLookSmooth.lerp(camLook, 1 - Math.exp(-8 * dt))
    camera.lookAt(camLookSmooth)
    if (dt > 0) {
      const s = Math.abs(speed)
      const shake = clamp((s - 15) / 15, 0, 1) * 0.08
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake
        camera.position.y += (Math.random() - 0.5) * shake * 0.6
      }
      const targetFov = 62 + (Math.min(s, maxSp) / maxSp) * 10
      camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-3 * dt))
      camera.updateProjectionMatrix()
    }
  }
  const driveFx = new THREE.Vector3()
  // sitting (B1): freeze the player on a bench and glide to a first-person cam
  let sitting = false
  const sitPos = new THREE.Vector3()
  const sitFwd = new THREE.Vector3()
  const sitLook = new THREE.Vector3()
  let standEase = 0
  const easeCam = new THREE.Vector3()
  const TOP = 15, REV = 8, GRIP = 8
  function driveCar(dt: number) {
    const thr = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
    const steer = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw)
    const rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw)
    // split world velocity into forward speed and sideways slip
    let sa = car.vx * fx + car.vz * fz
    let lat = car.vx * rx + car.vz * rz
    // longitudinal: engine, brake (only opposes motion), quadratic + rolling drag
    sa += ((thr > 0 ? 12 : 0) - (thr < 0 ? 20 * Math.sign(sa) : 0) - 0.018 * sa * Math.abs(sa) - 0.6 * sa) * dt
    sa = clamp(sa, -REV, TOP)
    // lateral grip eats the slip; low GRIP = drift, high = rails
    lat -= lat * Math.min(1, GRIP * dt)
    car.vx = fx * sa + rx * lat
    car.vz = fz * sa + rz * lat
    // speed-scaled steering feeds a damped yaw rate, so the car leans into and holds a turn
    car.yawVel -= steer * 2.8 * clamp(Math.abs(sa) / TOP, 0, 1) * Math.sign(sa) * dt
    car.yawVel *= 1 - 4 * dt
    car.yaw += car.yawVel * dt
    // visual lean/squat sells the mass (roll into the turn, dive on brake, squat on accel)
    car.roll += (-lat * 0.02 - car.roll) * (1 - Math.exp(-8 * dt))
    car.pitch += ((thr < 0 ? 0.04 : 0) - (thr > 0 ? 0.02 : 0) - car.pitch) * (1 - Math.exp(-10 * dt))
    car.sp = sa
    car.lat = lat
    camPos.set(car.x + car.vx * dt, 0, car.z + car.vz * dt)
    city.hit(camPos, 1.4)
    car.x = camPos.x
    car.z = camPos.z
    ents.drive(car.x, car.z, car.yaw, car.roll, car.pitch, thr < 0 ? 1 : 0)
    camPos.set(car.x - fx * 10, 3.6, car.z - fz * 10)
    camLook.set(car.x + fx * 4, 1.4, car.z + fz * 4)
    chaseCam(dt, sa, TOP)
    if (camera.position.y < 1.2) camera.position.y = 1.2
  }
  function toggleCar() {
    if (inCar) {
      ents.park(car.x, car.z, car.yaw)
      inCar = false
      player.pos.set(car.x + Math.cos(car.yaw) * 2.4, 0, car.z - Math.sin(car.yaw) * 2.4)
      player.yaw = car.yaw
      player.root.visible = true
    } else {
      const s = ents.tryEnter(player.pos.x, player.pos.z, 6)
      if (!s) return
      car.x = s.x
      car.z = s.z
      car.yaw = s.h
      car.sp = car.vx = car.vz = car.yawVel = car.pitch = car.roll = car.lat = 0
      inCar = true
      camVel.set(0, 0, 0)
      camLookSmooth.set(car.x + Math.sin(car.yaw) * 4, 1.4, car.z + Math.cos(car.yaw) * 4)
      player.root.visible = false
    }
  }

  // cycling (B6): own free state, speed between walking (2.9) and driving (24), no traffic slot
  let inBike = false
  let bikeParked = false
  // litter (B5): a bought can is held until a bin takes it
  let holdingCan = false
  const bike = { x: 0, z: 0, yaw: 0, sp: 0 }
  function driveBike(dt: number) {
    const thr = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
    const steer = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
    const ACC = 9, BRK = 15, MAX = 9, REV = 3
    if (thr > 0) bike.sp += ACC * dt
    else if (thr < 0) bike.sp += (bike.sp > 0 ? -BRK : -ACC) * dt
    else bike.sp -= Math.sign(bike.sp) * Math.min(Math.abs(bike.sp), 5 * dt)
    bike.sp = clamp(bike.sp, -REV, MAX)
    bike.yaw -= steer * 3.1 * dt * (bike.sp / MAX)
    camPos.set(bike.x + Math.sin(bike.yaw) * bike.sp * dt, 0, bike.z + Math.cos(bike.yaw) * bike.sp * dt)
    city.hit(camPos, 0.5)
    bike.x = camPos.x
    bike.z = camPos.z
    bikeModel.position.set(bike.x, 0, bike.z)
    bikeModel.rotation.y = bike.yaw
    const sx = Math.sin(bike.yaw), cz = Math.cos(bike.yaw)
    camPos.set(bike.x - sx * 6.5, 2.9, bike.z - cz * 6.5)
    camLook.set(bike.x + sx * 3, 1.25, bike.z + cz * 3)
    chaseCam(dt, bike.sp, 9)
    if (camera.position.y < 1.1) camera.position.y = 1.1
  }
  function toggleBike() {
    if (inBike) {
      inBike = false
      bikeParked = true
      bike.sp = 0
      player.pos.set(bike.x + Math.cos(bike.yaw) * 1.3, 0, bike.z - Math.sin(bike.yaw) * 1.3)
      player.yaw = bike.yaw
      player.root.visible = true
      return
    }
    // grab the bike you left on the pavement if you still stand by it, otherwise take one off a rack
    const near = bikeParked && Math.hypot(player.pos.x - bike.x, player.pos.z - bike.z) < 2.8
    if (!near) {
      let r: { x: number; z: number } | null = null
      let rd = 2.6
      for (const s of city.bikeRacks) {
        const d = Math.hypot(player.pos.x - s.x, player.pos.z - s.z)
        if (d < rd) {
          rd = d
          r = s
        }
      }
      if (!r) return
      bike.x = r.x
      bike.z = r.z
      bike.yaw = 0
    }
    bikeParked = false
    bike.sp = 0
    inBike = true
    camVel.set(0, 0, 0)
    camLookSmooth.set(bike.x + Math.sin(bike.yaw) * 3, 1.25, bike.z + Math.cos(bike.yaw) * 3)
    bikeModel.visible = true
    bikeModel.position.set(bike.x, 0, bike.z)
    bikeModel.rotation.y = bike.yaw
    player.root.visible = false
  }

  // NPC interaction (B2): freeze a nearby ped and show a context line — flavour, not quests
  let nightNow = 0
  const LINES: Record<'rain' | 'night' | 'rush' | 'generic', string[]> = {
    rain: ['Mưa thế này mà còn đi dạo?', 'Trời mưa, đường trơn lắm đấy.', 'Cậu không mang ô à?'],
    night: ['Khuya rồi, sao còn lang thang?', 'Ban đêm khu này vắng lắm.', 'Đèn đường hỏng nửa dãy rồi.'],
    rush: ['Kẹt xe kinh hoàng, tôi chờ 20 phút rồi.', 'Giờ cao điểm, ai cũng vội.', 'Bến xe đông nghịt.'],
    generic: ['Thành phố này dạo này đổi nhiều quá.', 'Ông chủ quán cà phê đầu ngõ vui tính lắm.', 'Cậu sống ở khu này lâu chưa?', 'Cuối tuần này có chợ trời đấy.'],
  }
  function pickLine() {
    const ctx = rain.amount > 0.3 ? 'rain' : nightNow > 0.5 ? 'night' : rushHour(hour) > 0.5 ? 'rush' : 'generic'
    const pool = LINES[ctx]
    return pool[Math.floor(Math.random() * pool.length)]
  }
  function interact() {
    if (inside) {
      exitShop()
      return
    }
    if (sitting) {
      sitting = false
      player.root.visible = true
      standEase = 1
      return
    }
    if (!inCar && !inBike) {
      let best: { x: number; z: number } | null = null
      let bd = 2.6
      for (const b of city.benches) {
        const d = Math.hypot(player.pos.x - b.x, player.pos.z - b.z)
        if (d < bd) {
          bd = d
          best = b
        }
      }
      if (best) {
        player.pos.set(best.x, 0, best.z)
        sitting = true
        player.root.visible = false
        return
      }
      // vending (B4): buy a soda from the nearest machine — small touch, city you can poke
      let vbest: { x: number; z: number } | null = null
      let vd = 2.3
      for (const v of city.vending) {
        const d = Math.hypot(player.pos.x - v.x, player.pos.z - v.z)
        if (d < vd) {
          vd = d
          vbest = v
        }
      }
      if (vbest) {
        holdingCan = true
        canMesh.visible = true
        onLine?.('Bạn mua một lon nước.')
        ambient.clunk()
        return
      }
      // food cart (feature 2): buy a bánh mì from the market cart — the payoff beat for the steam
      let cbest: { x: number; z: number } | null = null
      let cbd = 2.4
      for (const c of city.carts) {
        const d = Math.hypot(player.pos.x - c.x, player.pos.z - c.z)
        if (d < cbd) {
          cbd = d
          cbest = c
        }
      }
      if (cbest) {
        onLine?.('Bạn mua một ổ bánh mì.')
        ambient.sizzle()
        return
      }
      // litter (B5): holding a can makes every bin on the block worth walking over to
      if (holdingCan) {
        let tbest: { x: number; z: number } | null = null
        let tbd = 2.2
        for (const t of city.trash) {
          const d = Math.hypot(player.pos.x - t.x, player.pos.z - t.z)
          if (d < tbd) {
            tbd = d
            tbest = t
          }
        }
        if (tbest) {
          holdingCan = false
          canMesh.visible = false
          onLine?.('Bạn vứt lon vào thùng rác.')
          ambient.clunk()
          return
        }
      }
      // shop (B3): stand at a shop threshold and press E to duck inside
      let dbest: Door | null = null
      let dd = 2.0
      for (const s of city.doorSpots) {
        const d = Math.hypot(player.pos.x - s.hx, player.pos.z - s.hz)
        if (d < dd) {
          dd = d
          dbest = s
        }
      }
      if (dbest) {
        enterShop(dbest)
        return
      }
      // bike (B6): beside a rack, or beside the bike you left, E puts you in the saddle
      if (bikeParked ? Math.hypot(player.pos.x - bike.x, player.pos.z - bike.z) < 2.8 : city.bikeRacks.some((s) => Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < 2.6)) {
        onLine?.('Bạn lấy xe đạp.')
        toggleBike()
        return
      }
      // busker: drop a coin in the guitar case and he plays another song, a touch sharper
      if (Math.hypot(player.pos.x - busX, player.pos.z - busZ) < 2.6) {
        onLine?.(buskerTipped ? 'Busker gảy thêm một bài.' : 'Bạn thả 10.000đ vào hộp đàn.')
        ambient.tipBusker()
        buskerTipped = true
        return
      }
    }
    if (inCar) return toggleCar()
    if (inBike) {
      onLine?.('Bạn dựng xe lại.')
      toggleBike()
      return
    }
    if (ents.talkNearest(player.pos.x, player.pos.z, 2.5)) {
      onLine?.(pickLine())
      return
    }
    if (ents.busHorn()) return
    toggleCar()
  }

  // interior transition (B3): fade through black, swap street <-> shared room.
  const fogRef = scene.fog!
  const fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
  const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMat)
  fadeQuad.position.z = -0.3
  fadeQuad.renderOrder = 999
  fadeQuad.frustumCulled = false
  camera.add(fadeQuad)
  scene.add(camera)
  let inside = false
  let currentDoor: Door | null = null
  let streetYaw = 0
  let fadeState = 0
  let fadeT = 0
  let fadeCb: (() => void) | null = null
  function setInterior(on: boolean) {
    city.group.visible = !on
    ents.group.visible = !on
    steam.points.visible = !on
    drips.points.visible = !on
    shafts.mesh.visible = !on
    player.root.visible = !on
    rain.points.visible = !on
    rain.splashes.visible = !on
    sky.visible = !on
    stars.visible = !on
    moon.visible = !on
    hemi.visible = !on
    sun.visible = !on
    moonlight.visible = !on
    for (const l of lamps) l.visible = !on
    for (const s of headlights) s.visible = !on
    scene.fog = on ? null : fogRef
    interior.visible = on
  }
  function fadeThrough(cb: () => void) {
    fadeCb = cb
    fadeState = 1
    fadeT = 0
  }
  function enterShop(d: Door) {
    fadeThrough(() => {
      currentDoor = d
      streetYaw = player.yaw
      player.pitch = 0.1
      inside = true
      setInterior(true)
    })
  }
  function exitShop() {
    fadeThrough(() => {
      inside = false
      setInterior(false)
      if (currentDoor?.exit) player.pos.set(currentDoor.exit.x, 0, currentDoor.exit.z)
      player.yaw = streetYaw + Math.PI
      currentDoor = null
    })
  }

  const sky = new Sky()
  sky.scale.setScalar(9000)
  scene.add(sky)
  // the sky shader bakes a 0.04 exposure; bring it to a displayable range we control
  sky.material.uniforms.dusk = { value: 0 }
  sky.material.fragmentShader = sky.material.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    `vec3 horizon = pow( max( 0.0, 1.0 - abs( direction.y ) * 2.0 ), 3.0 )
        * vec3( 1.0, 0.4, 0.13 ) * dusk * ( 0.3 + 0.7 * pow( max( cosTheta, 0.0 ), 3.0 ) );
      gl_FragColor = vec4( texColor * 0.55 + horizon + vec3( 0.0, 0.0007, 0.0025 ), 1.0 );`,
  )
  sky.material.fragmentShader = 'uniform float dusk;\n' + sky.material.fragmentShader
  sky.material.needsUpdate = true
  const su = sky.material.uniforms as Record<string, { value: any }>
  su.turbidity.value = 7
  su.rayleigh.value = 1.6
  su.mieCoefficient.value = 0.006
  su.mieDirectionalG.value = 0.82

  const hemi = new THREE.HemisphereLight(0xbcd4ee, 0x4a453c, 0.7)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff3e0, 3)
  sun.castShadow = true
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.7
  scene.add(sun, sun.target)

  const moonlight = new THREE.DirectionalLight(0x8fb4ff, 0)
  scene.add(moonlight, moonlight.target)

  const starPos = new Float32Array(600 * 3)
  const sr = rng(1)
  for (let i = 0; i < 600; i++) {
    const u = sr() * Math.PI * 2
    const v = sr() * 0.9
    const r = 900
    const y = Math.sqrt(v)
    const xz = Math.sqrt(1 - v)
    starPos[i * 3] = Math.cos(u) * xz * r
    starPos[i * 3 + 1] = y * r
    starPos[i * 3 + 2] = Math.sin(u) * xz * r
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
  const starMat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, color: 0xdde6ff, fog: false })
  const stars = new THREE.Points(starGeo, starMat)
  stars.frustumCulled = true
  stars.renderOrder = 1
  scene.add(stars)

  // cloud deck: a back-side dome just overhead, faded in by daylight and thickened by rain
  const cloudMat = new THREE.MeshBasicMaterial({ map: tex.clouds, transparent: true, opacity: 0, depthWrite: false, side: THREE.BackSide, fog: false })
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(780, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), cloudMat)
  clouds.frustumCulled = false
  scene.add(clouds)

  const moonMat = new THREE.SpriteMaterial({ map: tex.glow, transparent: true, opacity: 0, depthWrite: false, fog: false, sizeAttenuation: true, color: 0xcfe0ff })
  const moon = new THREE.Sprite(moonMat)
  moon.scale.setScalar(160)
  moon.renderOrder = 2
  scene.add(moon)

  // a few real lights so the street right outside the player reads at night
  const lamps: THREE.PointLight[] = []
  for (let i = 0; i < 6; i++) {
    const l = new THREE.PointLight(0xffc98a, 0, 34, 2)
    scene.add(l)
    lamps.push(l)
  }

  // C10 — real headlight pools: a few spotlights track the nearest moving cars so their
  // cones actually light the road, not just the additive beam quad.
  const headlights: THREE.SpotLight[] = []
  for (let i = 0; i < 6; i++) {
    const s = new THREE.SpotLight(0xfff0d0, 0, 26, 0.52, 0.5, 2)
    s.target.position.set(0, 0, 0)
    scene.add(s, s.target)
    headlights.push(s)
  }

  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  let envDoneHour = -99

  let tier: Tier = 'medium'
  let mode: Mode = 'player'
  let hour = Number(q.get('h')) || 17.8
  let timeScale = 240
  let bloomGain = 1
  let motion = 0
  let caAmt = 0
  let paused = false
  let warmupT = 0
  let idle = false
  let effects: Effects = { shadows: true, ao: true, bloom: true, grain: true, grade: true }

  let composer: EffectComposer | null = null
  let bloom: UnrealBloomPass | null = null
  let afterimage: AfterimagePass | null = null
  let grain: ShaderPass | null = null
  let gtao: GTAOPass | null = null
  let gtaoK = 1
  let gradePass: ShaderPass | null = null
  let filter: Filter = 'none'
  let adaptive = q.get('adaptive') !== '0'
  let probeT = 0
  let probeMin = 1e9
  let goodT = 0

  // 5s probe windows: a sub-40fps sample drops a tier; 10s of 58+ raises one back
  function adapt(win: number, f: number) {
    if (!adaptive) return
    const i = TIERS.indexOf(tier)
    probeT += win
    probeMin = Math.min(probeMin, f)
    goodT = f > 58 ? goodT + win : 0
    if (goodT >= 10 && i < TIERS.length - 1) {
      tier = TIERS[i + 1]
      applyTier()
      onLine?.(`tự động nâng lên ${tier}`)
      goodT = probeT = 0
      probeMin = 1e9
      return
    }
    if (probeT >= 5) {
      if (probeMin < 40 && i > 0) {
        tier = TIERS[i - 1]
        applyTier()
        onLine?.(`tự động hạ xuống ${tier} · FPS ${probeMin.toFixed(0)}`)
      }
      probeT = 0
      probeMin = 1e9
      goodT = 0
    }
  }

  function applyFilter() {
    if (!gradePass) return
    const f = FILTERS[filter]
    for (const k of ['lift', 'gamma', 'gain', 'sat'] as const) gradePass.uniforms[k].value = f[k]
    gradePass.uniforms.tint.value.set(...f.tint)
    gradePass.uniforms.ca.value = caAmt
  }

  const size = new THREE.Vector2()
  function teardownComposer() {
    if (!composer) return
    // dispose each pass — EffectComposer.dispose() doesn't, leaks GTAO/Bloom RTs on every toggle
    composer.passes.forEach((p) => {
      const d = (p as unknown as { dispose?: () => void }).dispose
      if (typeof d === 'function') d.call(p)
    })
    composer.dispose()
    composer = null
    bloom = null
    afterimage = null
    grain = null
    gtao = null
    gradePass = null
  }

  function applyTier() {
    const c = CONF[tier]
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, c.ratio))
    const useShadow = effects.shadows && c.shadow > 0
    sun.castShadow = useShadow
    sun.shadow.mapSize.set(c.shadow || 512, c.shadow || 512)
    if (sun.shadow.map) {
      sun.shadow.map.dispose()
      sun.shadow.map = null as unknown as THREE.WebGLRenderTarget
    }
    teardownComposer()
    if (c.post) {
      renderer.getDrawingBufferSize(size)
      composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: c.samples }))
      composer.addPass(new RenderPass(scene, camera))
      if (effects.ao) {
        gtao = new GTAOPass(scene, camera, size.x, size.y)
        gtao.output = GTAOPass.OUTPUT.Default
        const aoR = tier === 'ultra' ? 1.2 : tier === 'high' ? 1.0 : 0.7
        const aoD = tier === 'ultra' ? 1.5 : tier === 'high' ? 1.35 : 1.2
        gtao.updateGtaoMaterial({ radius: aoR, distanceExponent: aoD, thickness: 1.5, scale: 1.0 })
        gtao.blendIntensity = c.aoBlend
        // half-res AO: the pass re-renders the whole scene for normals, so shrinking its
        // buffers is where the medium tier's post cost actually sits
        gtaoK = tier === 'medium' ? 0.5 : 1
        composer.addPass(gtao)
      }
      if (effects.bloom) {
        bloom = new UnrealBloomPass(size.clone(), 0.4, 0.45, 0.9)
        composer.addPass(bloom)
      }
      composer.addPass(new OutputPass())
      // afterimage keeps its own history buffer, so it stays in the chain and is gated per frame
      afterimage = new AfterimagePass(0)
      afterimage.enabled = false
      composer.addPass(afterimage)
      if (effects.grade || filter !== 'none') {
        gradePass = new ShaderPass(GRADE_SHADER)
        applyFilter()
        composer.addPass(gradePass)
      }
      if (effects.grain) {
        grain = new ShaderPass(GRAIN_SHADER)
        grain.uniforms.amount.value = tier === 'high' || tier === 'ultra' ? 0.055 : 0.03
        composer.addPass(grain)
      }
    }
    resize()
  }

  function sizeGtao() {
    if (!gtao || gtaoK === 1) return
    renderer.getDrawingBufferSize(size)
    gtao.setSize(Math.floor(size.x * gtaoK), Math.floor(size.y * gtaoK))
  }

  function resize() {
    const w = canvas.clientWidth || 1280
    const h = canvas.clientHeight || 720
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
    composer?.setSize(w, h)
    sizeGtao()
  }

  const sunDir = new THREE.Vector3()
  const moonDir = new THREE.Vector3()
  const fogCol = new THREE.Color()
  const LAT = (21 * Math.PI) / 180
  const DEC = (18 * Math.PI) / 180

  let lastDay = -1
  function skyFor(t: number) {
    const H = ((t - 12) * 15 * Math.PI) / 180
    const sinEl = Math.sin(LAT) * Math.sin(DEC) + Math.cos(LAT) * Math.cos(DEC) * Math.cos(H)
    const el = Math.asin(clamp(sinEl, -1, 1))
    const az = Math.atan2(-Math.sin(H), Math.tan(DEC) * Math.cos(LAT) - Math.sin(LAT) * Math.cos(H))
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    const day = smooth(-0.06, 0.16, sinEl)
    const dusk = smooth(0.3, 0, Math.abs(sinEl)) * day
    su.sunPosition.value.copy(sunDir)
    su.dusk.value = dusk
    su.rayleigh.value = lerp(0.35, 2.2, day)
    sun.position.copy(sunDir).multiplyScalar(260)
    sun.color.setRGB(1, lerp(0.72, 0.97, smooth(0.02, 0.35, sinEl)), lerp(0.5, 0.92, smooth(0.02, 0.35, sinEl)))
    sun.intensity = 3.0 * day
    hemi.intensity = 0.15 + 0.35 * day
    scene.environmentIntensity = 0.6
    hemi.color.copy(NIGHT).lerp(DAY, day)
    const wet = rain.amount
    fogCol.copy(NIGHT).lerp(DAY, day).lerp(DUSK, dusk * 0.55)
    if (wet > 0.01) {
      // overcast: sun muted, fog greyed out and thinner, asphalt lacquered
      sun.intensity *= 1 - 0.75 * wet
      fogCol.lerp(GREY, 0.5 * wet)
      hemi.intensity += 0.25 * wet
    }
    scene.fog!.color.copy(fogCol)
    ;(scene.fog as THREE.FogExp2).density = CONF[tier].fog * (1 - 0.25 * dusk) * (1 - 0.3 * wet)
    renderer.toneMappingExposure = lerp(0.7, 0.95, day)
    const night = 1 - day
    uNight.value = night
    uHour.value = t
    shafts.mat.uniforms.uGate.value = smooth(-0.05, 0.05, sinEl) * (1 - smooth(0.18, 0.45, sinEl)) * (1 - 0.7 * wet)
    ;(shafts.mat.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir)
    city.asphaltMat.roughness = lerp(1.0, 0.72, night) * (1 - 0.62 * wet)
    city.asphaltMat.envMapIntensity = 1.1 + 1.6 * wet
    const lg = city.lampGlow.material as THREE.ShaderMaterial
    ;(lg.uniforms.tint.value as THREE.Color).setScalar(night > 0.15 ? (night - 0.15) * 1.15 : 0)
    city.lampGlow.visible = night > 0.15
    city.neonMat.opacity = night * 0.9
    for (const m of city.bbMats) m.emissiveIntensity = night * 1.15
    city.neonReflMat.opacity = night * wet * 0.7
    ;(city.pools.material as THREE.MeshBasicMaterial).opacity = night * 0.85
    for (const l of lamps) l.intensity = night * 70
    if (bloom) bloom.strength = (0.06 + night * 0.4) * bloomGain
    moonlight.intensity = 0.08 * night
    const md = moonDir.copy(sunDir).negate().multiplyScalar(4000)
    moonlight.position.copy(md)
    moonlight.target.position.set(0, 0, 0)
    moon.position.copy(md)
    starMat.opacity = night
    stars.visible = night > 0.05
    moonMat.opacity = night * 0.9
    cloudMat.opacity = day * (0.35 + 0.4 * wet)
    cloudMat.color.setRGB(1 - 0.35 * wet, 1 - 0.35 * wet, 1 - 0.45 * wet)
    clouds.rotation.y = t * 0.01
    clouds.visible = day > 0.02
    if (Math.abs(day - lastDay) > 0.01) {
      lastDay = day
      ambient.setDay(day)
    }
    return { day, night }
  }

  const focus = new THREE.Vector3()
  const hudFx = new THREE.Vector3()
  const hudDir = new THREE.Vector3()
  const envScene = new THREE.Scene()
  function refreshEnv() {
    scene.remove(sky)
    envScene.add(sky)
    const f = pmrem.fromScene(envScene, 0, 1, 20000)
    scene.add(sky)
    const prev = scene.environment
    scene.environment = f.texture
    prev?.dispose()
  }

  function followShadow(night: number) {
    if (!sun.castShadow) return
    focus.copy(mode === 'player' ? player.pos : observer.pos)
    sun.target.position.set(focus.x, 0, focus.z)
    sun.position.set(focus.x, 0, focus.z).addScaledVector(sunDir, 260)
    const r = tier === 'high' || tier === 'ultra' ? 170 : 120
    const c = sun.shadow.camera
    c.left = -r
    c.right = r
    c.top = r
    c.bottom = -r
    c.near = 1
    c.far = 620
    c.updateProjectionMatrix()
    sun.visible = night < 0.95
  }

  const keys = new Set<string>()
  const isCoarse = window.matchMedia('(pointer: coarse)').matches
  const touchMove = { x: 0, z: 0, run: false }
  const applyLook = (dx: number, dy: number) => {
    const s = 0.0022
    const tgt = mode === 'player' ? player : observer
    tgt.yaw -= dx * s
    tgt.pitch = clamp(tgt.pitch + dy * s, mode === 'player' ? -0.55 : -1.3, mode === 'player' ? 1.15 : 1.3)
  }
  const kd = (e: KeyboardEvent) => {
    if (e.code === 'Space') e.preventDefault()
    keys.add(e.code)
    if (e.code === 'KeyO') api.setMode(mode === 'player' ? 'observe' : 'player')
    if (e.code === 'KeyP') paused = !paused
    if (e.code === 'KeyE' && mode === 'player' && !idle && !inside) interact()
  }
  const ku = (e: KeyboardEvent) => keys.delete(e.code)
  const mm = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return
    applyLook(e.movementX, e.movementY)
  }
  const wh = (e: WheelEvent) => {
    e.preventDefault()
    if (mode === 'player') player.dist = clamp(player.dist + Math.sign(e.deltaY) * 0.45, 1.6, 12)
    else observer.fov = clamp(observer.fov - Math.sign(e.deltaY) * 3, 18, 82)
  }
  // hold RMB while framing (observe mode) to punch the lens in for a cinematic shot, release restores the wide view
  let adsFov = 0
  const mdn = (e: MouseEvent) => { if (e.button === 2 && mode === 'observe' && !adsFov) { adsFov = observer.fov; observer.fov = clamp(adsFov * 0.4, 10, 82) } }
  const mup = (e: MouseEvent) => { if (e.button === 2 && adsFov) { observer.fov = adsFov; adsFov = 0 } }
  const ctxMenu = (e: Event) => e.preventDefault()
  const lock = () => {
    ambient.resume()
    if (!isCoarse && document.pointerLockElement !== canvas) canvas.requestPointerLock()
  }
  window.addEventListener('keydown', kd)
  window.addEventListener('keyup', ku)
  window.addEventListener('mousemove', mm)
  window.addEventListener('wheel', wh, { passive: false })
  window.addEventListener('mousedown', mdn)
  window.addEventListener('mouseup', mup)
  canvas.addEventListener('click', lock)
  canvas.addEventListener('contextmenu', ctxMenu)
  window.addEventListener('resize', resize)

  const near = lamps.map(() => ({ d: Infinity, i: -1 }))
  function placeLamps(fx: THREE.Vector3) {
    for (const n of near) n.d = Infinity
    city.lampSpots.forEach((s, i) => {
      const d = (s.x - fx.x) ** 2 + (s.z - fx.z) ** 2
      const w = near[near.length - 1]
      if (d >= w.d) return
      w.d = d
      w.i = i
      for (let a = near.length - 1; a > 0 && near[a].d < near[a - 1].d; a--) {
        const t = near[a]
        near[a] = near[a - 1]
        near[a - 1] = t
      }
    })
    near.forEach((n, k) => {
      const s = city.lampSpots[n.i]
      if (!s || n.d > 3600) lamps[k].position.set(0, -50, 0)
      else lamps[k].position.set(s.x, 7.4, s.z)
    })
  }

  const hlTmp = new THREE.Vector3()
  function placeHeadlights(fx: number, fz: number, night: number) {
    const spots = night > 0.05 ? ents.headlights(fx, fz, headlights.length) : []
    headlights.forEach((s, k) => {
      const c = spots[k]
      if (!c) {
        s.intensity = 0
        return
      }
      const sx = Math.sin(c.h)
      const cz = Math.cos(c.h)
      s.position.set(c.x + sx * 0.9, 0.7, c.z + cz * 0.9)
      hlTmp.set(c.x + sx * 9, 0, c.z + cz * 9)
      s.target.position.copy(hlTmp)
      s.target.updateMatrixWorld()
      s.intensity = night * 45
    })
  }

  let raf = 0
  let pendingCapture: { w: number; h: number; resolve: (s: string) => void } | null = null
  let last = performance.now()
  let clock = 0
  let oneShotT = 20 + Math.random() * 20
  let sirenT = 0
  let acc = 0
  let frames = 0
  let fps = 0

  // shop doors swing open for 0.5s when the focus (player/car/cam) or a nearby ped stands at the
  // threshold; only doors within 34m of the focus are simulated — distant doors aren't visible.
  const doorOpen = new Float32Array(Math.max(city.doorSpots.length, 1))
  const dm4 = new THREE.Matrix4()
  const dqu = new THREE.Quaternion()
  const DY = new THREE.Vector3(0, 1, 0)
  const dpos = new THREE.Vector3()
  const dscl = new THREE.Vector3(1, 1, 1)
  function updateDoors(dt: number, fx: THREE.Vector3) {
    if (!city.doorSpots.length) return
    const spots = city.doorSpots
    const ped = ents.pedWorld()
    const TRIG = 2.2 * 2.2
    const NEAR = 34 * 34
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]
      const pd = (s.hx - fx.x) ** 2 + (s.hz - fx.z) ** 2
      let near = pd < TRIG
      if (!near && pd < NEAR) {
        for (let m = 0; m < ped.n; m++) {
          if ((ped.px[m] - s.hx) ** 2 + (ped.pz[m] - s.hz) ** 2 < TRIG) { near = true; break }
        }
      }
      const o = doorOpen[i] + (near ? dt * 2 : -dt * 2)
      doorOpen[i] = o < 0 ? 0 : o > 1 ? 1 : o
      const e = doorOpen[i]
      dqu.setFromAxisAngle(DY, s.ry - e * e * (3 - 2 * e) * 1.7)
      city.doors.setMatrixAt(i, dm4.compose(dpos.set(s.hx, s.hy, s.hz), dqu, dscl))
    }
    city.doors.instanceMatrix.needsUpdate = true
  }

  function frame(now: number) {
    if (pendingCapture) {
      const { w, h, resolve } = pendingCapture
      pendingCapture = null
      renderer.setSize(w, h, false)
      composer?.setSize(w, h)
      sizeGtao()
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      if (!inside) skyFor(hour)
      if (composer) composer.render(0)
      else renderer.render(scene, camera)
      const url = canvas.toDataURL('image/png')
      resize()
      resolve(url)
      raf = requestAnimationFrame(frame)
      return
    }
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    clock += dt
    timeU.value = clock
    if (fadeState === 1) {
      fadeT += dt
      const a = Math.min(1, fadeT / 0.25)
      fadeMat.opacity = a
      if (a >= 1) {
        fadeCb?.()
        fadeCb = null
        fadeState = 2
        fadeT = 0
      }
    } else if (fadeState === 2) {
      fadeT += dt
      const a = Math.min(1, fadeT / 0.3)
      fadeMat.opacity = 1 - a
      if (a >= 1) fadeState = 0
    }
    if (inside) {
      const cp = Math.cos(player.pitch)
      sitFwd.set(Math.sin(player.yaw) * cp, -Math.sin(player.pitch), Math.cos(player.yaw) * cp)
      interior.getWorldPosition(sitPos)
      camera.position.copy(sitPos)
      camera.position.y += 1.6
      sitLook.copy(camera.position).add(sitFwd)
      camera.lookAt(sitLook)
      if (composer) composer.render(dt)
      else renderer.render(scene, camera)
      frames++
      acc += dt
      if (acc > 0.4) {
        fps = frames / acc
        const win = acc
        frames = 0
        acc = 0
        adapt(win, fps)
        onStats({ fps, hour, mode: 'player', speed: 0, x: 0, z: 0, tris: renderer.info.render.triangles, paused, inCar: false, tier })
      }
      return
    }
    if (!paused) hour = (hour + (dt * timeScale) / 3600) % 24
    const { day, night } = skyFor(hour)
    nightNow = night

    if (!paused) {
      oneShotT -= dt
      if (oneShotT < 0) {
        const r = Math.random()
        if (r < 0.5) ambient.distantCar()
        else if (r < 0.8 && night > 0.3) ambient.dogBark()
        else if (r < 0.95 && rushHour(hour) > 0.5) ambient.horn()
        oneShotT = 15 + Math.random() * 35
      }
      // D3: a distant siren ~1-2 times per night
      sirenT -= dt
      if (night > 0.6 && sirenT <= 0) {
        if (Math.random() < 0.02) {
          ambient.siren()
          sirenT = 400 + Math.random() * 800
        } else sirenT = 30
      }
    }

    if (inCar) {
      driveCar(paused ? 0 : dt)
    } else if (inBike) {
      driveBike(paused ? 0 : dt)
    } else if (sitting && mode === 'player') {
      sitPos.set(player.pos.x, 1.15, player.pos.z)
      camera.position.lerp(sitPos, 1 - Math.exp(-6 * dt))
      const cp = Math.cos(player.pitch)
      sitFwd.set(Math.sin(player.yaw) * cp, -Math.sin(player.pitch), Math.cos(player.yaw) * cp)
      sitLook.copy(camera.position).add(sitFwd)
      camera.lookAt(sitLook)
    } else if (mode === 'player') {
      player.update(paused ? 0 : dt, keys, city, isCoarse ? touchMove : undefined)
      if (standEase > 0) easeCam.copy(camera.position)
      player.aim(camera, city, paused ? 0 : dt)
      if (standEase > 0) {
        camera.position.lerp(easeCam, standEase)
        if (camera.position.y < 0.6) camera.position.y = 0.6
        standEase = Math.max(0, standEase - (paused ? 0 : dt) * 4)
      }
      if (!paused && player.speed > 0.3) {
        stepAcc += player.speed * dt
        if (stepAcc > 0.65) {
          stepAcc = 0
          ambient.footstep(rain.amount > 0.3)
          if (puddle > 0.05 && rippleT >= 1) {
            const hitPud = city.puddleSpots.find((p) => Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < p.r * 0.9)
            if (hitPud) {
              rippleT = 0
              ripple.position.set(hitPud.x, 0.08, hitPud.z)
            }
          }
        }
      }
    } else {
      observer.update(idle ? 0 : dt, keys, isCoarse ? touchMove : undefined)
      if (idle) observer.yaw += dt * 0.02
      observer.apply(camera)
    }

    character.update(paused ? 0 : dt, mode === 'player' && !paused && player.root.visible ? player.speed : 0)
    busker.update(dt, 0)
    const sl = inBike ? clamp((Math.abs(bike.sp) - 6) / 3, 0, 0.8) : 0
    speedLines.lines.visible = sl > 0
    speedLines.mat.uniforms.uAmt.value = sl
    if (afterimage) {
      const mb = inCar ? Math.abs(car.sp) : inBike ? Math.abs(bike.sp) : 0
      afterimage.enabled = motion > 0
      afterimage.damp = motion * 0.92 * Math.min(1, mb / 18)
    }
    const fx = inCar ? driveFx.set(car.x, 0, car.z) : inBike ? driveFx.set(bike.x, 0, bike.z) : mode === 'player' ? player.pos : observer.pos
    hudFx.copy(fx)
    let zp = 0, zm = 0, zl = 0
    for (const z of city.zoneCenters) {
      const k = clamp(1 - Math.hypot(fx.x - z.x, fx.z - z.z) / 26, 0, 1)
      if (z.kind === 'park') zp = Math.max(zp, k)
      else if (z.kind === 'market') zm = Math.max(zm, k)
      else if (z.kind === 'plaza') zl = Math.max(zl, k)
    }
    ambient.setZone(zp, zm, zl)
    const busProx = clamp(1 - Math.hypot(fx.x - busX, fx.z - busZ) / 22, 0, 1) * night
    ambient.setBusker(busProx)
    buskerGather += dt
    if (busProx > 0.2 && buskerGather > 2) {
      buskerGather = 0
      ents.talkNearest(busX, busZ, 12)
    }
    ambient.setEngine(inCar, Math.min(1, Math.abs(car.sp) / 15))
    ambient.setSkid(inCar ? clamp((Math.abs(car.lat) - 1.5) / 6, 0, 1) : 0)
    let zac = 0, zdr = 0
    for (const a of city.acHumSpots) zac = Math.max(zac, clamp(1 - Math.hypot(fx.x - a.x, fx.z - a.z) / 14, 0, 1))
    for (const c of city.constructionSpots) zdr = Math.max(zdr, clamp(1 - Math.hypot(fx.x - c.x, fx.z - c.z) / 24, 0, 1))
    ambient.setBuild(zac, zdr)
    if (city.lampGlow.visible) placeLamps(fx)
    stars.position.copy(camera.position)
    rain.update(paused ? 0 : dt, camera.position, paused ? 0 : rainTarget)
    if (rain.flash > 0) {
      hemi.intensity += rain.flash * 3.5
      fogCol.lerp(WHITE, rain.flash * 0.5)
      scene.fog!.color.copy(fogCol)
    }
    if (grain) grain.uniforms.time.value = clock
    followShadow(night)
    if (!paused && warmupT < 60) warmupT += dt
    const pedBoost = warmupT < 60 ? Math.floor((1 - warmupT / 60) * 100) : 0
    ents.update(paused ? 0 : dt, clock, hour, night, rain.amount, player.pos.x, player.pos.z, mode === 'player' && !inCar && !paused, pedBoost)
    placeHeadlights(fx.x, fx.z, night)
    updateDoors(paused ? 0 : dt, fx)
    // puddles rise while it rains hard (>0.5) over 5min and drain over 30min once the rain stops
    puddle = rain.amount > 0.5 ? Math.min(1, puddle + (paused ? 0 : dt) / 300) : Math.max(0, puddle - (paused ? 0 : dt) / 1800)
    ;(city.puddles.material as THREE.MeshBasicMaterial).opacity = puddle * 0.6
    city.puddles.visible = puddle > 0.01
    if (rippleT < 1) {
      rippleT = Math.min(1, rippleT + (paused ? 0 : dt) / 0.5)
      const s = lerp(0.6, 2.6, rippleT)
      ripple.scale.set(s, 1, s)
      ;(ripple.material as THREE.MeshBasicMaterial).opacity = (1 - rippleT) * puddle
      ripple.visible = rippleT < 1
    } else ripple.visible = false

    if (Math.abs(hour - envDoneHour) > 0.4) {
      envDoneHour = hour
      refreshEnv()
    }

    if (composer) composer.render(dt)
    else renderer.render(scene, camera)

    frames++
    acc += dt
    if (acc > 0.4) {
      fps = frames / acc
      const win = acc
      frames = 0
      acc = 0
      adapt(win, fps)
      onStats({ fps, hour, mode, speed: inCar ? car.sp : inBike ? bike.sp : player.speed, x: fx.x, z: fx.z, tris: renderer.info.render.triangles, paused, inCar, tier })
    }
  }

  // initial overrides from URL
  if (q.get('tier')) tier = q.get('tier') as Tier
  if (q.get('mode')) mode = q.get('mode') as Mode
  if (q.get('bloom')) bloomGain = clamp(Number(q.get('bloom')), 0, 2)
  const fxOff = (q.get('fx') || '').split(',').filter(Boolean)
  if (fxOff.length) {
    effects = { ...effects, ...Object.fromEntries(fxOff.map((k) => [k, false])) } as Effects
  }

  applyTier()
  skyFor(hour)
  refreshEnv()
  envDoneHour = hour
  raf = requestAnimationFrame(frame)

  const api = {
    setTier(t: Tier) {
      tier = t
      adaptive = false
      applyTier()
    },
    setEffects(e: Partial<Effects>) {
      effects = { ...effects, ...e }
      applyTier()
    },
    setFilter(f: Filter) {
      if (f === filter) return
      filter = f
      applyTier()
    },
    setMode(m: Mode) {
      if (inside || m === mode) return
      if (inCar) toggleCar()
      if (inBike) toggleBike()
      if (sitting) {
        sitting = false
        player.root.visible = true
        standEase = 1
      }
      if (m === 'observe') {
        observer.pos.copy(camera.position)
        observer.yaw = player.yaw
        observer.pitch = player.pitch
      }
      mode = m
    },
    setTime(h: number) {
      hour = h
    },
    setTimeScale(s: number) {
      timeScale = s
    },
    setBloom(g: number) {
      bloomGain = g
    },
    setMotion(v: number) {
      motion = clamp(v, 0, 1)
    },
    setCA(v: number) {
      caAmt = clamp(v, 0, 1) * 0.0025
      applyFilter()
    },
    setRain(v: number) {
      rainTarget = clamp(v, 0, 1)
    },
    setAmbient(v: number) {
      ambient.setVolume(v)
    },
    setPaused(p: boolean) {
      paused = p
    },
    resetCamera() {
      if (mode === 'player') {
        player.pos.copy(city.spawn)
        player.yaw = Math.PI
        player.pitch = 0.32
      } else {
        observer.pos.set(city.spawn.x, 40, city.spawn.z + 30)
        observer.yaw = Math.PI
        observer.pitch = 0.25
      }
    },
    setIdle(v: boolean) {
      idle = v
    },
    start() {
      lock()
    },
    setMove(x: number, z: number, run: boolean) {
      touchMove.x = x
      touchMove.z = z
      touchMove.run = run
    },
    look(dx: number, dy: number) {
      applyLook(dx, dy)
    },
    resumeAudio() {
      ambient.resume()
    },
    // deterministic framing for the headless verify harness: drive the observe camera, then capture()
    cam(x: number, y: number, z: number, yaw: number, pitch: number, fov: number) {
      mode = 'observe'
      idle = false
      observer.pos.set(x, y, z)
      observer.yaw = yaw
      observer.pitch = clamp(pitch, -1.3, 1.3)
      observer.fov = clamp(fov, 18, 82)
      observer.apply(camera)
    },
    getState() {
      return { h: hour, rain: rainTarget, tier, mode, bloom: bloomGain, effects }
    },
    hud() {
      camera.getWorldDirection(hudDir)
      return { x: hudFx.x, z: hudFx.z, yaw: Math.atan2(hudDir.x, hudDir.z), cars: ents.carWorld(), zones: city.zoneCenters }
    },
    project(x: number, y: number, z: number) {
      hudDir.set(x, y, z).project(camera)
      return { sx: (hudDir.x * 0.5 + 0.5) * canvas.clientWidth, sy: (-hudDir.y * 0.5 + 0.5) * canvas.clientHeight, front: hudDir.z < 1 }
    },
    capture(w: number, h: number) {
      return new Promise<string>((resolve) => { pendingCapture = { w, h, resolve } })
    },
    dispose() {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('wheel', wh)
      window.removeEventListener('mousedown', mdn)
      window.removeEventListener('mouseup', mup)
      canvas.removeEventListener('click', lock)
      canvas.removeEventListener('contextmenu', ctxMenu)
      window.removeEventListener('resize', resize)
      teardownComposer()
      pmrem.dispose()
      camera.remove(fadeQuad)
      scene.remove(camera)
      fadeQuad.geometry.dispose()
      fadeMat.dispose()
      rain.points.geometry.dispose()
      rain.splashes.geometry.dispose()
      sky.geometry.dispose()
      ;(sky.material as THREE.ShaderMaterial).dispose()
      ambient.dispose()
      renderer.dispose()
    },
  }
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) (window as unknown as { __sim: typeof api }).__sim = api
  return api
}
