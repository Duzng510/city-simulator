import * as THREE from 'three'
import { clamp, lerp, smooth } from './util'
import { CONF } from './quality'
import type { Sim } from './types'
import type { Dressing } from './scene'
import type { World } from './world'
import type { Quality } from './quality'
import type { Observer } from './player'
import type { makeRain } from './weather'
import type { makeAmbient } from './audio'

const DAY = new THREE.Color(0xa6bed8)
const DUSK = new THREE.Color(0xd07840)
const NIGHT = new THREE.Color(0x080e1a)
const GREY = new THREE.Color(0x6b7684)
const WHITE = new THREE.Color(0xffffff)
const STORM = new THREE.Color(0.4, 0.4, 0.45)

// Sun geometry, sky/air response, storm cells and the wet ground — everything that changes with
// the clock rather than with the player. skyFor(t) is the single writer of light values.
export function makeTimeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sim: Sim,
  dressing: Dressing,
  world: World,
  observer: Observer,
  quality: Quality,
  rain: ReturnType<typeof makeRain>,
  ambient: ReturnType<typeof makeAmbient>,
) {
  const { city, ents, shafts, uNight, uHour, ripple } = world
  const { su, lamps, headlights } = dressing

  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const envScene = new THREE.Scene()
  let envDoneHour = -99

  const sunDir = new THREE.Vector3()
  const moonDir = new THREE.Vector3()
  const fogCol = new THREE.Color()
  const focus = new THREE.Vector3()
  const hlTmp = new THREE.Vector3()
  const LAT = (21 * Math.PI) / 180
  const DEC = (18 * Math.PI) / 180
  let lastDay = -1

  // D9 thunderstorm: level ramps 0→1 over ~2s; bolts fire on boltT, thunder lags by boltD
  let stormEnd = -1
  let stormCheck = 0
  let boltT = 0
  let boltFlash = 0
  let thunderAt = -1
  let boltPow = 1

  // puddles rise while it rains hard (>0.5) over 5min and drain over 30min once the rain stops
  let puddle = 0
  let rippleT = 1

  function skyFor(t: number) {
    const H = ((t - 12) * 15 * Math.PI) / 180
    const sinEl = Math.sin(LAT) * Math.sin(DEC) + Math.cos(LAT) * Math.cos(DEC) * Math.cos(H)
    const el = Math.asin(clamp(sinEl, -1, 1))
    const az = Math.atan2(-Math.sin(H), Math.tan(DEC) * Math.cos(LAT) - Math.sin(LAT) * Math.cos(H))
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    const day0 = smooth(-0.06, 0.16, sinEl)
    const day = day0 * (1 - 0.7 * sim.storm)
    const dusk = smooth(0.3, 0, Math.abs(sinEl)) * day
    su.sunPosition.value.copy(sunDir)
    su.dusk.value = dusk
    sim.dusk = dusk
    su.rayleigh.value = lerp(0.35, 2.2, day)
    su.turbidity.value = 7 + 8 * sim.storm
    su.mieCoefficient.value = 0.006 + 0.05 * sim.storm
    dressing.sun.position.copy(sunDir).multiplyScalar(260)
    dressing.sun.color.setRGB(1, lerp(0.72, 0.97, smooth(0.02, 0.35, sinEl)), lerp(0.5, 0.92, smooth(0.02, 0.35, sinEl)))
    dressing.sun.intensity = 3.0 * day
    dressing.hemi.intensity = 0.15 + 0.35 * day
    scene.environmentIntensity = 0.6
    dressing.hemi.color.copy(NIGHT).lerp(DAY, day)
    const wet = rain.amount
    fogCol.copy(NIGHT).lerp(DAY, day).lerp(DUSK, dusk * 0.55)
    if (wet > 0.01) {
      // overcast: sun muted, fog greyed out and thinner, asphalt lacquered
      dressing.sun.intensity *= 1 - 0.75 * wet
      fogCol.lerp(GREY, 0.5 * wet)
      dressing.hemi.intensity += 0.25 * wet
    }
    scene.fog!.color.copy(fogCol)
    // C9 dawn fog bank: ground mist thickens across 5:30-6:00 and burns off by 7:30, clear nights only
    let dawnFog = 0
    if (t > 5.5 && t < 7.5 && wet < 0.1) dawnFog = smooth(5.5, 6, t) * (1 - smooth(6.6, 7.5, t))
    ;(scene.fog as THREE.FogExp2).density = CONF[sim.tier].fog * (1 - 0.25 * dusk) * (1 - 0.3 * wet) * (1 + dawnFog)
    renderer.toneMappingExposure = lerp(0.7, 0.95, day)
    const night = 1 - day0
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
    const bloom = quality.bloom
    if (bloom) bloom.strength = (0.06 + night * 0.4) * sim.bloomGain
    dressing.moonlight.intensity = 0.08 * night
    const md = moonDir.copy(sunDir).negate().multiplyScalar(4000)
    dressing.moonlight.position.copy(md)
    dressing.moonlight.target.position.set(0, 0, 0)
    dressing.moon.position.copy(md)
    dressing.starMat.opacity = night
    dressing.stars.visible = night > 0.05
    dressing.moonMat.opacity = night * 0.9
    dressing.cloudMat.opacity = day0 * (0.35 + 0.4 * wet + 0.5 * sim.storm)
    dressing.cloudMat.color.setRGB(1 - 0.35 * wet, 1 - 0.35 * wet, 1 - 0.45 * wet)
    if (sim.storm > 0) dressing.cloudMat.color.lerp(STORM, sim.storm)
    dressing.clouds.rotation.y = t * 0.01
    dressing.clouds.visible = day0 > 0.02
    if (Math.abs(day - lastDay) > 0.01) {
      lastDay = day
      ambient.setDay(day)
    }
    return { day, night }
  }

  function refreshEnv() {
    scene.remove(dressing.sky)
    envScene.add(dressing.sky)
    const f = pmrem.fromScene(envScene, 0, 1, 20000)
    scene.add(dressing.sky)
    const prev = scene.environment
    scene.environment = f.texture
    prev?.dispose()
  }

  function followShadow(night: number) {
    if (!dressing.sun.castShadow) return
    focus.copy(sim.mode === 'player' ? world.player.pos : observer.pos)
    dressing.sun.target.position.set(focus.x, 0, focus.z)
    dressing.sun.position.set(focus.x, 0, focus.z).addScaledVector(sunDir, 260)
    const r = sim.tier === 'high' || sim.tier === 'ultra' || sim.tier === 'max' ? 170 : 120
    const c = dressing.sun.shadow.camera
    c.left = -r
    c.right = r
    c.top = r
    c.bottom = -r
    c.near = 1
    c.far = 620
    c.updateProjectionMatrix()
    dressing.sun.visible = night < 0.95
  }

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

  // storm cell + lightning bleach; returns true on the frame thunder should be heard
  function updateWeather(dt: number) {
    if (!sim.paused) {
      if (stormEnd < sim.clock && rain.amount > 0.7 && sim.clock > stormCheck) {
        stormCheck = sim.clock + 4
        if (Math.random() < 0.05) {
          stormEnd = sim.clock + 60 + Math.random() * 60
          boltT = 1 + Math.random() * 3
        }
      }
      sim.storm += ((stormEnd > sim.clock ? 1 : 0) - sim.storm) * Math.min(1, dt * 0.6)
    }
    if (sim.storm > 0.5 && !sim.paused) {
      boltT -= dt
      if (boltT <= 0) {
        boltT = 4 + Math.random() * 4
        boltFlash = 1
        const dist = 1 + Math.random() * 2
        thunderAt = sim.clock + dist
        boltPow = clamp(1.5 - dist * 0.35, 0.4, 1)
      }
    }
    if (boltFlash > 0) {
      if (!sim.noLightning) {
        dressing.hemi.intensity += boltFlash * 8 * sim.storm
        su.turbidity.value += boltFlash * 15
        su.mieCoefficient.value += boltFlash * 0.3
        fogCol.lerp(WHITE, boltFlash * 0.6)
        scene.fog!.color.copy(fogCol)
        renderer.toneMappingExposure += boltFlash * 0.6
      }
      boltFlash = Math.max(0, boltFlash - dt * 12)
    }
    if (rain.flash > 0 && !sim.noLightning) {
      dressing.hemi.intensity += rain.flash * (3.5 + 4.5 * sim.storm)
      fogCol.lerp(WHITE, rain.flash * 0.5)
      scene.fog!.color.copy(fogCol)
    }
    const thunder = thunderAt >= 0 && sim.clock >= thunderAt
    if (thunder) thunderAt = -1
    return { thunder, boltPow }
  }

  function groundWetness(dt: number) {
    puddle = rain.amount > 0.5 ? Math.min(1, puddle + (sim.paused ? 0 : dt) / 300) : Math.max(0, puddle - (sim.paused ? 0 : dt) / 1800)
    ;(city.puddles.material as THREE.MeshBasicMaterial).opacity = puddle * 0.6
    city.puddles.visible = puddle > 0.01
    if (rippleT < 1) {
      rippleT = Math.min(1, rippleT + (sim.paused ? 0 : dt) / 0.5)
      const s = lerp(0.6, 2.6, rippleT)
      ripple.scale.set(s, 1, s)
      ;(ripple.material as THREE.MeshBasicMaterial).opacity = (1 - rippleT) * puddle
      ripple.visible = rippleT < 1
    } else ripple.visible = false
  }

  // a footstep only throws a ripple when it lands inside a live puddle
  function splashAt(x: number, z: number) {
    if (puddle <= 0.05 || rippleT >= 1) return
    const hitPud = city.puddleSpots.find((p) => Math.hypot(x - p.x, z - p.z) < p.r * 0.9)
    if (!hitPud) return
    rippleT = 0
    ripple.position.set(hitPud.x, 0.08, hitPud.z)
  }

  function hourTick(dt: number) {
    if (!sim.paused) sim.hour = (sim.hour + (dt * sim.timeScale) / 3600) % 24
  }

  // the PMREM probe re-renders the sky, so only rebuild it once the light has actually moved
  function maybeRefreshEnv() {
    if (Math.abs(sim.hour - envDoneHour) <= 0.4) return
    envDoneHour = sim.hour
    refreshEnv()
  }

  // C11 one origin per frame: the sun (or the anti-sun moon) when it's in frame, else the lit
  // street lamp closest to screen centre — at night that's the bright thing you're looking at.
  const raysV = new THREE.Vector3()
  function gateRays(day: number, night: number) {
    const raysPass = quality.raysPass
    if (!raysPass) return
    camera.updateMatrixWorld()
    raysV.copy(camera.position).addScaledVector(sunDir, 700 * (day > 0.02 ? 1 : -1)).project(camera)
    let amt = 0
    let ox = 0.5
    let oy = 0.5
    let tint = 0xffdca8
    if (raysV.z < 1 && Math.abs(raysV.x) < 1.3 && Math.abs(raysV.y) < 1.3) {
      amt = day > 0.02 ? (0.12 + 0.88 * sim.dusk) * day * (1 - 0.85 * sim.storm) : night * 0.3
      ox = raysV.x * 0.5 + 0.5
      oy = raysV.y * 0.5 + 0.5
      if (day <= 0.02) tint = 0xbcd2ff
    }
    if (night > 0.05) {
      let lAmt = 0
      let lx = 0
      let ly = 0
      for (const l of lamps) {
        if (l.position.y < 0) continue
        raysV.copy(l.position).project(camera)
        if (raysV.z > 1) continue
        const d = Math.hypot(raysV.x, raysV.y)
        if (d > 1) continue
        const a = night * (0.5 - 0.4 * d)
        if (a > lAmt) {
          lAmt = a
          lx = raysV.x * 0.5 + 0.5
          ly = raysV.y * 0.5 + 0.5
        }
      }
      if (lAmt > amt) {
        amt = lAmt
        ox = lx
        oy = ly
        tint = 0xffc98a
      }
    }
    amt *= sim.raysGain * (1 + 0.6 * rain.amount)
    raysPass.enabled = amt > 0.02
    if (raysPass.enabled) {
      ;(raysPass.uniforms.uOrigin.value as THREE.Vector2).set(ox, oy)
      ;(raysPass.uniforms.uTint.value as THREE.Color).setHex(tint)
      raysPass.uniforms.uAmount.value = Math.min(1.5, amt)
    }
  }

  function primeEnv() {
    refreshEnv()
    envDoneHour = sim.hour
  }

  function dispose() {
    pmrem.dispose()
  }

  return { skyFor, refreshEnv, maybeRefreshEnv, primeEnv, followShadow, placeLamps, placeHeadlights, gateRays, updateWeather, groundWetness, splashAt, hourTick, dispose }
}

export type Timeline = ReturnType<typeof makeTimeline>
