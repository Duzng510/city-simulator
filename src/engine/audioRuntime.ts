import * as THREE from 'three'
import { clamp, rushHour } from './util'
import { makeAmbient } from './audio'
import type { Sim } from './types'
import type { World } from './world'

// All the WebAudio plumbing that has to be re-fed every frame: which zone you are standing in,
// how close the busker is, engine + skid from the car state, and the listener/reverb pair that
// follows the camera. Owns the ambience object itself, since nothing outside this file talks to it.
export function makeAudioRuntime(
  sim: Sim,
  world: World,
  camera: THREE.Camera,
  veh: { car: { sp: number; lat: number }; bike: { sp: number } },
) {
  const ambient = makeAmbient()
  const { city, ents, player } = world
  const fwd = new THREE.Vector3()
  let oneShotT = 20 + Math.random() * 20
  let sirenT = 0
  let stepAcc = 0
  let buskerGather = 0

  ents.onHonk((x, z) => ambient.horn(x, z))
  ents.onMeow((x, z) => ambient.meow(x, z))
  ents.onSiren((x, z) => ambient.siren(x, z))

  // returns true on the frame a footstep lands, so the puddle splash stays with it
  function step(dt: number, moving: boolean) {
    if (!moving || sim.paused || player.speed <= 0.3) return false
    stepAcc += player.speed * dt
    if (stepAcc <= 0.65) return false
    stepAcc = 0
    return true
  }

  function update(dt: number, fx: THREE.Vector3, night: number) {
    if (!sim.paused) {
      oneShotT -= dt
      if (oneShotT < 0) {
        const r = Math.random()
        if (r < 0.5) ambient.distantCar()
        else if (r < 0.8 && night > 0.3) ambient.dogBark()
        else if (r < 0.95 && rushHour(sim.hour) > 0.5) ambient.horn()
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

    let zp = 0, zm = 0, zl = 0
    for (const z of city.zoneCenters) {
      const k = clamp(1 - Math.hypot(fx.x - z.x, fx.z - z.z) / 26, 0, 1)
      if (z.kind === 'park') zp = Math.max(zp, k)
      else if (z.kind === 'market') zm = Math.max(zm, k)
      else if (z.kind === 'plaza') zl = Math.max(zl, k)
    }
    ambient.setZone(zp, zm, zl)
    const busProx = clamp(1 - Math.hypot(fx.x - world.busX, fx.z - world.busZ) / 22, 0, 1) * night
    ambient.setBusker(busProx, world.busX, world.busZ)
    buskerGather += dt
    if (busProx > 0.2 && buskerGather > 2) {
      buskerGather = 0
      ents.talkNearest(world.busX, world.busZ, 12)
    }
    ambient.setEngine(sim.inCar, Math.min(1, Math.abs(veh.car.sp) / 15))
    ambient.setSkid(sim.inCar ? clamp((Math.abs(veh.car.lat) - 1.5) / 6, 0, 1) : 0)
    let zac = 0, zdr = 0
    for (const a of city.acHumSpots) zac = Math.max(zac, clamp(1 - Math.hypot(fx.x - a.x, fx.z - a.z) / 14, 0, 1))
    for (const c of city.constructionSpots) zdr = Math.max(zdr, clamp(1 - Math.hypot(fx.x - c.x, fx.z - c.z) / 24, 0, 1))
    ambient.setBuild(zac, zdr)
    // C10 spatial audio: listener rides the camera; wet mix drops to zero inside a shop and slides
    // from street tail to alley slap near alleySpots
    camera.getWorldDirection(fwd)
    ambient.setListener(camera.position.x, camera.position.y, camera.position.z, fwd.x, fwd.y, fwd.z)
    let alley = 0
    for (const a of city.alleySpots) alley = Math.max(alley, clamp(1 - Math.hypot(fx.x - a.x, fx.z - a.z) / 8, 0, 1))
    ambient.setReverb(sim.inside ? 0 : 0.12 * (1 - alley), sim.inside ? 0 : 0.35 * alley)
  }

  function thunder(at: number, power: number) {
    ambient.thunder(at, power)
  }

  return {
    ambient, step, update, thunder,
    setVolume: (v: number) => ambient.setVolume(v),
    setVolumes: (v: Parameters<typeof ambient.setVolumes>[0]) => ambient.setVolumes(v),
    resume: () => ambient.resume(),
    footstep: (wet: boolean) => ambient.footstep(wet),
    dispose: () => ambient.dispose(),
  }
}

export type AudioRuntime = ReturnType<typeof makeAudioRuntime>
