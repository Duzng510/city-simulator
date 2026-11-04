import * as THREE from 'three'

// one shared bike — stays where you step off
export function makeBike() {
  const bikeModel = new THREE.Group()
  const tyre = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.9 })
  const frame = new THREE.MeshStandardMaterial({ color: 0x2c7fb8, roughness: 0.45, metalness: 0.5 })
  for (const z of [0.55, -0.55]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.045, 6, 18), tyre)
    w.rotation.y = Math.PI / 2
    w.position.set(0, 0.33, z)
    w.castShadow = true
    bikeModel.add(w)
  }
  const mk = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frame)
    b.position.set(x, y, z)
    b.castShadow = true
    bikeModel.add(b)
  }
  mk(0.05, 0.05, 1.05, 0, 0.74, 0)
  mk(0.05, 0.66, 0.05, 0, 0.5, 0.5)
  mk(0.05, 0.6, 0.05, 0, 0.46, -0.5)
  mk(0.34, 0.05, 0.06, 0, 0.88, 0.52)
  mk(0.1, 0.06, 0.32, 0, 0.82, -0.5)
  bikeModel.visible = false
  return bikeModel
}

// one shared fake room, placed far under the city; enter/exit flips visibility + camera, not a real second scene
export function makeInterior() {
  const interior = new THREE.Group()
  interior.position.set(0, -3000, 0)
  interior.visible = false
  const RW = 8, RD = 8, RH = 3.4
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(RW, RH, RD),
    new THREE.MeshStandardMaterial({ color: 0x6f5340, roughness: 0.92, side: THREE.BackSide }),
  )
  shell.position.y = RH / 2
  interior.add(shell)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(RW, RD),
    new THREE.MeshStandardMaterial({ color: 0x3f2c1c, roughness: 0.8 }),
  )
  floor.rotation.x = -Math.PI / 2
  interior.add(floor)
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.08, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc37a, emissiveIntensity: 3 }),
  )
  lamp.position.set(0, RH - 0.2, 0)
  interior.add(lamp)
  for (const z of [-2.2, 2.2]) {
    const p = new THREE.PointLight(0xffb066, 22, 14, 2)
    p.position.set(0, RH - 0.5, z)
    interior.add(p)
  }
  const pm = new THREE.MeshStandardMaterial({ color: 0x5a4230, roughness: 0.85 })
  const mk = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), pm)
    b.position.set(x, y, z)
    interior.add(b)
  }
  mk(3, 0.95, 0.7, -1.4, 0.48, -3.2)          // counter
  mk(0.4, 0.5, 0.4, 0.3, 0.25, -3.1)          // stool
  mk(1.3, 0.72, 1.3, 2, 0.36, 0)              // table
  mk(2.6, 2.1, 0.35, 2, 1.05, -3.6)           // shelf
  mk(0.9, 1.9, 0.6, 3.4, 0.95, 3)             // vending
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.5, 10), pm)
  pot.position.set(-3.4, 0.25, 3.4)
  interior.add(pot)
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3d6b3a, roughness: 0.9 }))
  leaves.position.set(-3.4, 1, 3.4)
  interior.add(leaves)
  return interior
}
