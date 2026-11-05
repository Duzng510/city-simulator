import type * as THREE from 'three'
import { clamp } from './util'
import type { Sim, Stats } from './types'
import type { World } from './world'
import type { Dressing } from './scene'
import type { CameraRig } from './camera'
import type { Vehicles } from './vehicle'
import type { Interaction } from './interaction'
import type { Input } from './input'
import type { AudioRuntime } from './audioRuntime'
import type { Timeline } from './timeline'
import type { DistrictActivity } from './districtActivity'
import type { Quality } from './quality'
import type { Reflection } from './reflect'
import type { Capture } from './capture'
import type { Observer } from './player'
import type { makeSpeedLines } from './fx'
import type { makeRain } from './weather'

export interface RuntimeDeps {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  sim: Sim
  world: World
  dressing: Dressing
  rig: CameraRig
  veh: Vehicles
  act: Interaction
  input: Input
  sfx: AudioRuntime
  time: Timeline
  activity: DistrictActivity
  quality: Quality
  refl: Reflection
  capture: Capture
  observer: Observer
  speedLines: ReturnType<typeof makeSpeedLines>
  rain: ReturnType<typeof makeRain>
  onStats: (s: Stats) => void
}

// The per-frame order. Kept as one readable list of delegation calls: every system owns its own
// state, this only decides who is measured before whom.
export function makeRuntime(d: RuntimeDeps) {
  const { renderer, scene, camera, sim, world, dressing, rig, veh, act, input, sfx, time, activity, quality, refl, capture, observer, speedLines, rain, onStats } = d
  let raf = 0
  let last = performance.now()
  let acc = 0
  let frames = 0

  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    if (capture.run()) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    sim.clock += dt
    world.timeU.value = sim.clock
    act.fadeUpdate(dt)

    if (sim.inside) {
      const cp = Math.cos(world.player.pitch)
      rig.sitFwd.set(Math.sin(world.player.yaw) * cp, -Math.sin(world.player.pitch), Math.cos(world.player.yaw) * cp)
      world.interior.getWorldPosition(rig.sitPos)
      camera.position.copy(rig.sitPos)
      camera.position.y += 1.6
      rig.sitLook.copy(camera.position).add(rig.sitFwd)
      camera.lookAt(rig.sitLook)
      quality.render(dt)
      tickStats(dt, 0, 0)
      return
    }

    time.hourTick(dt)
    const { day, night } = time.skyFor(sim.hour)
    sim.night = night

    if (sim.inCar) {
      veh.driveCar(sim.paused ? 0 : dt)
    } else if (sim.inBike) {
      veh.driveBike(sim.paused ? 0 : dt)
    } else if (sim.sitting && sim.mode === 'player') {
      rig.sitUpdate(sim.paused ? 0 : dt)
    } else if (sim.mode === 'player') {
      world.player.update(sim.paused ? 0 : dt, input.keys, world.city, input.isCoarse ? input.touchMove : undefined)
      // B1: no walking through traffic
      if (!sim.paused && !sim.sitting) world.ents.carPush(world.player.pos)
      rig.playerUpdate(dt)
      if (sfx.step(dt, !sim.paused && world.player.speed > 0.3)) {
        sfx.footstep(rain.amount > 0.3)
        time.splashAt(world.player.pos.x, world.player.pos.z)
      }
    } else {
      observer.update(sim.idle ? 0 : dt, input.keys, input.isCoarse ? input.touchMove : undefined)
      if (sim.idle) observer.yaw += dt * 0.02
      observer.apply(camera)
    }

    world.character.update(sim.paused ? 0 : dt, sim.mode === 'player' && !sim.paused && world.player.root.visible ? world.player.speed : 0)
    world.busker.update(dt, 0)

    const sl = sim.inBike ? clamp((Math.abs(veh.bike.sp) - 6) / 3, 0, 0.8) : 0
    speedLines.lines.visible = sl > 0
    speedLines.mat.uniforms.uAmt.value = sl
    const afterimage = quality.afterimage
    if (afterimage) {
      const mb = sim.inCar ? Math.abs(veh.car.sp) : sim.inBike ? Math.abs(veh.bike.sp) : 0
      afterimage.enabled = sim.motion > 0
      afterimage.damp = sim.motion * 0.92 * Math.min(1, mb / 18)
    }

    const fx = sim.inCar ? rig.driveFx.set(veh.car.x, 0, veh.car.z) : sim.inBike ? rig.driveFx.set(veh.bike.x, 0, veh.bike.z) : sim.mode === 'player' ? world.player.pos : observer.pos
    rig.focusPoint(fx)
    sfx.update(sim.paused ? 0 : dt, fx, night)
    if (world.city.lampGlow.visible) time.placeLamps(fx)
    dressing.stars.position.copy(camera.position)
    rain.update(sim.paused ? 0 : dt, camera.position, sim.paused ? 0 : Math.min(1, sim.rainTarget * (1 + 0.5 * sim.storm)))
    world.pigeons.update(sim.paused ? 0 : dt, fx.x, fx.z, sim.clock)

    const bolt = time.updateWeather(dt)
    if (bolt.thunder) sfx.thunder(0, bolt.boltPow)
    quality.grainTime(sim.clock)

    time.followShadow(night)
    if (!sim.paused && sim.warmupT < 60) sim.warmupT += dt
    const pedBoost = sim.warmupT < 60 ? Math.floor((1 - sim.warmupT / 60) * 100) : 0
    world.traffic.update(sim.clock, night)
    world.ents.update(sim.paused ? 0 : dt, sim.clock, sim.hour, night, rain.amount, world.player.pos.x, world.player.pos.z, sim.mode === 'player' && !sim.inCar && !sim.paused, pedBoost, activity.density(fx.x, fx.z, sim.hour))
    time.placeHeadlights(fx.x, fx.z, night)
    world.updateDoors(sim.paused ? 0 : dt, fx)
    time.groundWetness(dt)
    time.maybeRefreshEnv()
    time.gateRays(day, night)

    // D12: đêm + mưa mới có gương; ban ngày asphalt nhám nên render thừa cũng không thấy gì
    const rAmt = refl.on ? night * clamp(rain.amount * 1.6, 0, 1) : 0
    if (rAmt > 0.03) refl.draw()
    refl.u.amt.value = rAmt

    quality.render(dt)
    tickStats(dt, fx.x, fx.z)
  }

  function tickStats(dt: number, x: number, z: number) {
    frames++
    acc += dt
    if (acc <= 0.4) return
    const fps = frames / acc
    const win = acc
    frames = 0
    acc = 0
    quality.adapt(win, fps)
    onStats({
      fps,
      hour: sim.hour,
      mode: sim.mode,
      speed: sim.inside ? 0 : sim.inCar ? veh.car.sp : sim.inBike ? veh.bike.sp : world.player.speed,
      x,
      z,
      tris: renderer.info.render.triangles,
      paused: sim.paused,
      inCar: sim.inCar,
      tier: sim.tier,
    })
  }

  function start() {
    raf = requestAnimationFrame(frame)
  }

  function stop() {
    cancelAnimationFrame(raf)
  }

  return { start, stop }
}

export type Runtime = ReturnType<typeof makeRuntime>
