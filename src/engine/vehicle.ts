import type * as THREE from 'three'
import { clamp } from './util'
import type { Sim } from './types'
import type { World } from './world'
import type { CameraRig } from './camera'

const TOP = 15, REV = 8, GRIP = 8

// driving (B1) and cycling (B6). Both are arcade velocity models that own the chase camera; the
// car additionally holds one parked traffic slot so the city can route around it.
export function makeVehicles(
  camera: THREE.Camera,
  sim: Sim,
  world: World,
  rig: CameraRig,
  keys: Set<string>,
) {
  const { city, ents, player, bikeModel } = world
  const car = { x: 0, z: 0, yaw: 0, sp: 0, vx: 0, vz: 0, yawVel: 0, pitch: 0, roll: 0, lat: 0 }
  const bike = { x: 0, z: 0, yaw: 0, sp: 0 }
  let bikeParked = false

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
    rig.pos.set(car.x + car.vx * dt, 0, car.z + car.vz * dt)
    city.hit(rig.pos, 1.4)
    ents.vehPush(rig.pos, 1.4)
    car.x = rig.pos.x
    car.z = rig.pos.z
    ents.drive(car.x, car.z, car.yaw, car.roll, car.pitch, thr < 0 ? 1 : 0)
    rig.pos.set(car.x - fx * 10, 3.6, car.z - fz * 10)
    rig.look.set(car.x + fx * 4, 1.4, car.z + fz * 4)
    rig.chase(dt, sa, TOP)
    if (camera.position.y < 1.2) camera.position.y = 1.2
  }

  function toggleCar() {
    if (sim.inCar) {
      ents.park(car.x, car.z, car.yaw)
      sim.inCar = false
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
      sim.inCar = true
      rig.vel.set(0, 0, 0)
      rig.lookSmooth.set(car.x + Math.sin(car.yaw) * 4, 1.4, car.z + Math.cos(car.yaw) * 4)
      player.root.visible = false
    }
  }

  function driveBike(dt: number) {
    const thr = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
    const steer = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
    const ACC = 9, BRK = 15, MAX = 9, REVERSE = 3
    if (thr > 0) bike.sp += ACC * dt
    else if (thr < 0) bike.sp += (bike.sp > 0 ? -BRK : -ACC) * dt
    else bike.sp -= Math.sign(bike.sp) * Math.min(Math.abs(bike.sp), 5 * dt)
    bike.sp = clamp(bike.sp, -REVERSE, MAX)
    bike.yaw -= steer * 3.1 * dt * (bike.sp / MAX)
    rig.pos.set(bike.x + Math.sin(bike.yaw) * bike.sp * dt, 0, bike.z + Math.cos(bike.yaw) * bike.sp * dt)
    city.hit(rig.pos, 0.5)
    ents.vehPush(rig.pos, 0.5)
    bike.x = rig.pos.x
    bike.z = rig.pos.z
    bikeModel.position.set(bike.x, 0, bike.z)
    bikeModel.rotation.y = bike.yaw
    const sx = Math.sin(bike.yaw), cz = Math.cos(bike.yaw)
    rig.pos.set(bike.x - sx * 6.5, 2.9, bike.z - cz * 6.5)
    rig.look.set(bike.x + sx * 3, 1.25, bike.z + cz * 3)
    rig.chase(dt, bike.sp, 9)
    if (camera.position.y < 1.1) camera.position.y = 1.1
  }

  function toggleBike() {
    if (sim.inBike) {
      sim.inBike = false
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
    sim.inBike = true
    rig.vel.set(0, 0, 0)
    rig.lookSmooth.set(bike.x + Math.sin(bike.yaw) * 3, 1.25, bike.z + Math.cos(bike.yaw) * 3)
    bikeModel.visible = true
    bikeModel.position.set(bike.x, 0, bike.z)
    bikeModel.rotation.y = bike.yaw
    player.root.visible = false
  }

  return { car, bike, get bikeParked() { return bikeParked }, driveCar, driveBike, toggleCar, toggleBike }
}

export type Vehicles = ReturnType<typeof makeVehicles>
