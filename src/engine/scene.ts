import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { rng } from './util'

// Everything that lives above the street but is not the street: the Preetham sky dome, the sun/moon
// pair, the star field, the cloud deck, and the handful of real lights a walker can actually see.
// Construction only — timeline.ts drives their values.
export function makeDressing(scene: THREE.Scene, tex: { clouds: THREE.Texture; glow: THREE.Texture }) {
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

  function dispose() {
    sky.geometry.dispose()
    ;(sky.material as THREE.ShaderMaterial).dispose()
    starGeo.dispose()
    starMat.dispose()
    clouds.geometry.dispose()
    cloudMat.dispose()
    moonMat.dispose()
  }

  return { sky, su, hemi, sun, moonlight, stars, starMat, clouds, cloudMat, moon, moonMat, lamps, headlights, dispose }
}

export type Dressing = ReturnType<typeof makeDressing>
