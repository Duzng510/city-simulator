import * as THREE from 'three'
import { clamp } from './util'
import type { Sim } from './types'
import type { World } from './world'
import type { Observer } from './player'

// The camera and its scratch vectors. Nothing here decides *where* the player is; it turns a
// focus point into a framed shot. All vectors are module-level so frame() never allocates.
export function makeCameraRig(
  camera: THREE.PerspectiveCamera,
  sim: Sim,
  world: World,
  observer: Observer,
) {
  const { player, city, ents } = world
  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const vel = new THREE.Vector3()
  const lookSmooth = new THREE.Vector3()
  const delta = new THREE.Vector3()
  const driveFx = new THREE.Vector3()
  const sitPos = new THREE.Vector3()
  const sitFwd = new THREE.Vector3()
  const sitLook = new THREE.Vector3()
  const easeCam = new THREE.Vector3()
  const hudFx = new THREE.Vector3()
  const hudDir = new THREE.Vector3()

  let standEase = 0

  // critically-damped-ish spring (ratio 0.9 -> slight overshoot); reads/writes pos/look
  function chase(dt: number, speed: number, maxSp: number) {
    const D = 2 * Math.sqrt(18) * 0.9
    vel.addScaledVector(delta.subVectors(pos, camera.position).multiplyScalar(18).addScaledVector(vel, -D), dt)
    camera.position.addScaledVector(vel, dt)
    lookSmooth.lerp(look, 1 - Math.exp(-8 * dt))
    camera.lookAt(lookSmooth)
    if (dt > 0) {
      const s = Math.abs(speed)
      const shake = sim.reduceMotion ? 0 : clamp((s - 15) / 15, 0, 1) * 0.08
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake
        camera.position.y += (Math.random() - 0.5) * shake * 0.6
      }
      const targetFov = 62 + (Math.min(s, maxSp) / maxSp) * 10
      camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-3 * dt))
      camera.updateProjectionMatrix()
    }
  }

  // sitting (B1): freeze the player on a bench and glide to a first-person cam
  function sitStart(x: number, z: number) {
    player.pos.set(x, 0, z)
    sim.sitting = true
    player.root.visible = false
  }

  function sitStop() {
    sim.sitting = false
    player.root.visible = true
    standEase = 1
  }

  function sitUpdate(dt: number) {
    sitPos.set(player.pos.x, 1.15, player.pos.z)
    camera.position.lerp(sitPos, 1 - Math.exp(-6 * dt))
    const cp = Math.cos(player.pitch)
    sitFwd.set(Math.sin(player.yaw) * cp, -Math.sin(player.pitch), Math.cos(player.yaw) * cp)
    sitLook.copy(camera.position).add(sitFwd)
    camera.lookAt(sitLook)
  }

  function playerUpdate(dt: number) {
    if (standEase > 0) easeCam.copy(camera.position)
    player.aim(camera, city, sim.paused ? 0 : dt, sim.reduceMotion)
    if (standEase > 0) {
      camera.position.lerp(easeCam, standEase)
      if (camera.position.y < 0.6) camera.position.y = 0.6
      standEase = Math.max(0, standEase - (sim.paused ? 0 : dt) * 4)
    }
  }

  function reset() {
    if (sim.mode === 'player') {
      player.pos.copy(city.spawn)
      player.yaw = Math.PI
      player.pitch = 0.32
    } else {
      observer.pos.set(city.spawn.x, 40, city.spawn.z + 30)
      observer.yaw = Math.PI
      observer.pitch = 0.25
    }
  }

  function focusPoint(fx: THREE.Vector3) {
    hudFx.copy(fx)
  }

  function hud() {
    camera.getWorldDirection(hudDir)
    return { x: hudFx.x, z: hudFx.z, yaw: Math.atan2(hudDir.x, hudDir.z), cars: ents.carWorld(), zones: city.zoneCenters }
  }

  // HUD labels are placed in CSS pixels, so this needs the canvas box rather than the buffer size
  function project(canvas: HTMLCanvasElement, x: number, y: number, z: number) {
    hudDir.set(x, y, z).project(camera)
    return { sx: (hudDir.x * 0.5 + 0.5) * canvas.clientWidth, sy: (-hudDir.y * 0.5 + 0.5) * canvas.clientHeight, front: hudDir.z < 1 }
  }

  return { pos, look, vel, lookSmooth, driveFx, sitPos, sitFwd, sitLook, chase, sitStart, sitStop, sitUpdate, playerUpdate, reset, focusPoint, hud, project }
}

export type CameraRig = ReturnType<typeof makeCameraRig>
