import * as THREE from 'three'
import { clamp } from './util'
import type { City } from './city'

export interface MoveInput {
  x: number
  z: number
  run: boolean
}

export interface Player {
  root: THREE.Group
  pos: THREE.Vector3
  yaw: number
  pitch: number
  dist: number
  speed: number
  update: (dt: number, keys: Set<string>, city: City, move?: MoveInput) => void
  aim: (camera: THREE.Camera, city: City, dt: number, reduceMotion?: boolean) => void
}

export function makePlayer(spawn: THREE.Vector3): Player {
  const root = new THREE.Group()
  root.position.copy(spawn)

  const pos = spawn.clone()
  const vel = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const wish = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  const right = new THREE.Vector3()
  const yUp = new THREE.Vector3(0, 1, 0)
  const target = new THREE.Vector3()
  const leadV = new THREE.Vector3()
  const ray = new THREE.Raycaster()
  let travelled = 0
  let clock = 0
  let lean = 0

  const self: Player = {
    root,
    pos,
    yaw: Math.PI,
    pitch: 0.32,
    dist: 4.6,
    speed: 0,
    update: (dt, keys, city, move) => {
      const run = (keys.has('ShiftLeft') || keys.has('ShiftRight')) || !!move?.run
      const kx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
      const kz = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0)
      dir.set(move ? move.x : kx, 0, move ? move.z : kz)
      fwd.set(Math.sin(self.yaw), 0, Math.cos(self.yaw))
      right.crossVectors(fwd, yUp)
      wish.set(0, 0, 0)
      if (dir.lengthSq() > 0) {
        const mag = Math.min(1, dir.length())
        dir.normalize()
        wish.addScaledVector(fwd, -dir.z).addScaledVector(right, dir.x).normalize().multiplyScalar((run ? 6.4 : 2.9) * mag)
      }
      vel.lerp(wish, 1 - Math.exp(-9 * dt))
      pos.addScaledVector(vel, dt)
      city.hit(pos, 0.32)
      pos.y = 0
      self.speed = Math.hypot(vel.x, vel.z)
      if (dt > 0) { clock += dt; travelled += self.speed * dt }
      if (self.speed > 0.3) {
        root.quaternion.setFromAxisAngle(yUp, Math.atan2(vel.x, vel.z))
      }
      root.position.copy(pos)
    },
    aim: (camera, city, dt, reduceMotion) => {
      target.set(pos.x, pos.y + 1.45, pos.z)
      const lead = Math.min(self.speed * 0.4, 2.5)
      if (lead > 0) {
        leadV.set(vel.x, 0, vel.z)
        if (leadV.lengthSq() > 0) target.addScaledVector(leadV.normalize(), lead)
      }
      const cp = Math.cos(self.pitch)
      const sp = Math.sin(self.pitch)
      fwd.set(Math.sin(self.yaw) * cp, -sp, Math.cos(self.yaw) * cp)
      ray.set(target, fwd)
      ray.far = self.dist
      ray.near = 0
      const hits = ray.intersectObjects(city.blockers, false)
      const d = hits.length ? Math.max(1.2, hits[0].distance - 0.3) : self.dist
      camera.position.copy(target).addScaledVector(fwd, -d)
      if (camera.position.y < 0.6) camera.position.y = 0.6
      if (dt > 0) {
        const norm = clamp(self.speed / 2.9, 0, 1)
        // 0.45m per bob = two beats per the 0.9m stride in character.ts, so camera lands on each footfall
        const ph = (travelled / 0.45) * Math.PI
        right.crossVectors(fwd, yUp).normalize()
        lean += ((vel.dot(right) / 6.4) * 0.05 - lean) * (1 - Math.exp(-7 * dt))
        const offY = Math.sin(ph) * 0.028 * norm + Math.sin(clock * 1.2) * 0.008 * (1 - norm)
        const offX = Math.cos(ph * 0.5) * 0.02 * norm + Math.cos(clock * 0.8) * 0.005 * (1 - norm) - lean * 0.6
        dir.copy(yUp).applyAxisAngle(fwd, -lean)
        camera.position.addScaledVector(right, offX).addScaledVector(dir, offY)
        camera.up.copy(dir)
      }
      camera.lookAt(target)
      camera.up.copy(yUp)
      if (dt > 0) {
        const s = self.speed
        const shake = reduceMotion ? 0 : clamp((s - 5) / 15, 0, 1) * 0.08
        if (shake > 0) {
          camera.position.x += (Math.random() - 0.5) * shake
          camera.position.y += (Math.random() - 0.5) * shake * 0.6
        }
        const cam = camera as THREE.PerspectiveCamera
        const targetFov = 62 + (Math.min(s, 6.4) / 6.4) * 10
        cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-3 * dt))
        cam.updateProjectionMatrix()
      }
    },
  }
  return self
}

export interface Observer {
  pos: THREE.Vector3
  yaw: number
  pitch: number
  fov: number
  update: (dt: number, keys: Set<string>, move?: MoveInput) => void
  apply: (camera: THREE.PerspectiveCamera) => void
}

export function makeObserver(start: THREE.Vector3): Observer {
  const pos = start.clone().setY(30)
  const vel = new THREE.Vector3()
  const wish = new THREE.Vector3()
  const f = new THREE.Vector3()
  const r = new THREE.Vector3()
  const look = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const o: Observer = {
    pos,
    yaw: Math.PI,
    pitch: 0.25,
    fov: 60,
    update: (dt, keys, move) => {
      const boost = keys.has('ShiftLeft') || move?.run ? 3.4 : 1
      const kx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
      const kz = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0)
      wish.set(
        move ? move.x : kx,
        (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0),
        move ? move.z : kz,
      )
      f.set(Math.sin(o.yaw), 0, Math.cos(o.yaw))
      r.crossVectors(f, yAxis)
      const hy = wish.y
      wish.set(0, hy, 0).addScaledVector(f, -wish.z).addScaledVector(r, wish.x)
      if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(15 * boost)
      vel.lerp(wish, 1 - Math.exp(-6 * dt))
      pos.addScaledVector(vel, dt)
      pos.y = clamp(pos.y, 1.7, 340)
    },
    apply: (camera) => {
      camera.position.copy(pos)
      const cp = Math.cos(o.pitch)
      look.set(pos.x + Math.sin(o.yaw) * cp, pos.y - Math.sin(o.pitch), pos.z + Math.cos(o.yaw) * cp)
      camera.lookAt(look)
      camera.fov = o.fov
      camera.updateProjectionMatrix()
    },
  }
  return o
}
