import * as THREE from 'three'
import { clamp } from './util'

export interface Character {
  root: THREE.Group
  update: (dt: number, speed: number) => void
  sit: () => void
}

const legMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.8, envMapIntensity: 0.5 })
const clothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, envMapIntensity: 0.5 })
const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.7, envMapIntensity: 0.5 })

const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

export function spawnCharacter(): Character {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  // limbs hang from a pivot group so rotation.x swings them from hip/shoulder
  const limb = (w: number, h: number, d: number, x: number, y: number, mat: THREE.Material) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, 0)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.y = -h / 2
    mesh.castShadow = true
    pivot.add(mesh)
    body.add(pivot)
    return pivot
  }

  const legL = limb(0.15, 0.82, 0.16, -0.11, 0.82, legMat)
  const legR = limb(0.15, 0.82, 0.16, 0.11, 0.82, legMat)
  const armL = limb(0.12, 0.55, 0.14, -0.27, 1.41, clothMat)
  const armR = limb(0.12, 0.55, 0.14, 0.27, 1.41, clothMat)

  const torso = new THREE.Mesh(boxAt(0.42, 0.6, 0.24, 0, 1.12, 0), clothMat)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8).translate(0, 1.55, 0), skinMat)
  torso.castShadow = true
  head.castShadow = true
  body.add(torso, head)

  let travelled = 0
  return {
    root,
    sit: () => {
      legL.rotation.x = -Math.PI / 2
      legR.rotation.x = -Math.PI / 2
      body.position.y = -0.37
    },
    update: (dt, speed) => {
      travelled += speed * dt
      // one cycle per stride of ground covered, so the swing keeps step with real movement
      const phase = (travelled / 0.9) * Math.PI * 2
      const amp = clamp(speed / 6.4, 0, 1) * 0.7
      const s = Math.sin(phase) * amp
      legL.rotation.x = s
      legR.rotation.x = -s
      armL.rotation.x = -s * 0.7
      armR.rotation.x = s * 0.7
      body.position.y = Math.abs(Math.cos(phase)) * amp * 0.05
    },
  }
}
