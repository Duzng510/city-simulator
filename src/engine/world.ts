import * as THREE from 'three'
import { buildCity } from './city'
import { buildEntities } from './entities'
import { makeTraffic } from './traffic'
import { makePlayer } from './player'
import { spawnCharacter } from './character'
import { rng } from './util'
import { makeBike, makeInterior } from './props'
import { makeSteam, makeDrips, makeShafts, makePigeons } from './fx'
import type { Textures } from './textures'

// The street itself: blocks, traffic, pedestrians, and the small props a walker can bump into.
// Layout is seeded, so nothing here may use Math.random().
export function makeWorld(scene: THREE.Scene, tex: Textures) {
  const city = buildCity(tex)
  scene.add(city.group)
  const uNight = { value: 0 }
  const uHour = { value: 17.8 }
  const timeU = { value: 0 }

  // facade windows light up on a per-building schedule driven by the clock uniform
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

  const traffic = makeTraffic()
  scene.add(traffic.group)
  const ents = buildEntities(tex, 5150, city.doorSpots, city.parkSpots, city.alleySpots, traffic, city.benches, city.awnings)
  scene.add(ents.group)

  const player = makePlayer(city.spawn)
  scene.add(player.root)
  const character = spawnCharacter()
  player.root.add(character.root)

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

  // D11 — pigeons scatter from the food carts and bins when you walk up
  const pigeons = makePigeons([...city.carts, ...city.trash])
  scene.add(pigeons.mesh)

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

  // café patrons — reuse the character rig, seated at market café tables so the patio reads as occupied
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
      let close = pd < TRIG
      if (!close && pd < NEAR) {
        for (let m = 0; m < ped.n; m++) {
          if ((ped.px[m] - s.hx) ** 2 + (ped.pz[m] - s.hz) ** 2 < TRIG) { close = true; break }
        }
      }
      const o = doorOpen[i] + (close ? dt * 2 : -dt * 2)
      doorOpen[i] = o < 0 ? 0 : o > 1 ? 1 : o
      const e = doorOpen[i]
      dqu.setFromAxisAngle(DY, s.ry - e * e * (3 - 2 * e) * 1.7)
      city.doors.setMatrixAt(i, dm4.compose(dpos.set(s.hx, s.hy, s.hz), dqu, dscl))
    }
    city.doors.instanceMatrix.needsUpdate = true
  }

  function dispose() {
    ripple.geometry.dispose()
    ;(ripple.material as THREE.Material).dispose()
    canMesh.geometry.dispose()
    ;(canMesh.material as THREE.Material).dispose()
  }

  return {
    city, ents, traffic, player, character, steam, drips, shafts, pigeons, ripple,
    busker, busX, busZ, canMesh, bikeModel, interior, uNight, uHour, timeU, updateDoors, dispose,
  }
}

export type World = ReturnType<typeof makeWorld>
