import * as THREE from 'three'

// looping soft-sprite columns driven entirely by time in the vertex shader — no per-frame CPU.
// steam rises and fades (normal blend); AC drips fall and glint (additive blend).
function puffs(
  spots: { x: number; y: number; z: number }[],
  map: THREE.Texture,
  o: { per: number; dist: number; size: number; grow: number; color: number; fade: number; add: boolean; alpha: number },
) {
  const n = spots.length * o.per
  const pos = new Float32Array(n * 3)
  const seed = new Float32Array(n)
  for (let s = 0; s < spots.length; s++) {
    const p = spots[s]
    for (let k = 0; k < o.per; k++) {
      const i = s * o.per + k
      pos[i * 3] = p.x
      pos[i * 3 + 1] = p.y
      pos[i * 3 + 2] = p.z
      seed[i] = k / o.per + Math.random() * 0.05
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map }, t: { value: 0 }, color: { value: new THREE.Color(o.color) },
      uDist: { value: o.dist }, uSize: { value: o.size }, uGrow: { value: o.grow }, uFade: { value: o.fade }, uA: { value: o.alpha },
    },
    vertexShader: `
      attribute float aSeed;
      uniform float t, uDist, uSize, uGrow, uFade;
      varying float vA;
      void main() {
        float life = fract(aSeed + t * uFade);
        vec3 p = position;
        p.y += uDist * life;
        p.x += sin(life * 6.2831 + aSeed * 40.0) * 0.18 * life;
        p.z += cos(life * 5.1 + aSeed * 30.0) * 0.18 * life;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = max(0.001, -mv.z);
        gl_PointSize = uSize * (1.0 + uGrow * life) * clamp(180.0 / d, 0.2, 3.0);
        vA = sin(life * 3.1416);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 color;
      uniform float uA;
      varying float vA;
      void main() {
        float a = texture2D(map, gl_PointCoord).a * vA * uA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(color * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  const points = new THREE.Points(g, mat)
  points.frustumCulled = false
  return { points, mat }
}

export const makeSteam = (spots: { x: number; y: number; z: number }[], map: THREE.Texture) =>
  puffs(spots, map, { per: 18, dist: 3.8, size: 13, grow: 2.4, color: 0xdfe6ee, fade: 0.08, add: false, alpha: 0.4 })

// sprint streaks: lines hung in camera space just off the edge of the view, stretched along -Z.
// The radius keeps the centre of the screen clear so it reads as speed, not rain; uAmt is the
// only per-frame cost.
export function makeSpeedLines(count = 220) {
  const pos = new Float32Array(count * 6)
  const t = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const r = 2.4 + Math.random() * 2.8
    const z = -(1.5 + Math.random() * 3.5)
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    pos.set([x, y, z, x, y, z - 2.4], i * 6)
    t.set([0, 1], i * 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  const mat = new THREE.ShaderMaterial({
    uniforms: { uAmt: { value: 0 }, color: { value: new THREE.Color(0xdcecff) } },
    vertexShader: `
      attribute float aT;
      varying float vA;
      void main() {
        vA = (1.0 - aT) * smoothstep(2.2, 4.4, length(position.xy));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uAmt;
      uniform vec3 color;
      varying float vA;
      void main() {
        float a = clamp(uAmt * vA, 0.0, 1.0);
        if (a < 0.01) discard;
        gl_FragColor = vec4(color * a, a);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const lines = new THREE.LineSegments(g, mat)
  lines.frustumCulled = false
  lines.visible = false
  return { lines, mat }
}

export const makeDrips = (spots: { x: number; y: number; z: number }[], map: THREE.Texture) =>
  puffs(spots, map, { per: 6, dist: -1.5, size: 4, grow: 0.2, color: 0xaecbe0, fade: 0.55, add: true, alpha: 0.8 })

// D11: pigeons pecking around a spot (a food cart, a bin). A few instanced grey birds that scatter
// in a flutter when the player steps close, circle for a couple seconds, then settle back down.
// No per-frame allocation — one scratch matrix/euler and typed arrays, so it's cheap to run every frame.
export function makePigeons(spots: { x: number; z: number }[], per = 3) {
  const n = spots.length * per
  const base = new Float32Array(n * 2) // home x/z
  const cur = new Float32Array(n * 3) // current x/y/z
  const sc = new Float32Array(n) // scared timer (>0 = airborne)
  const ph = new Float32Array(n) // phase: orbit dir + flap offset
  for (let i = 0; i < n; i++) {
    const s = spots[(i / per) | 0]
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * 1.4
    base[i * 2] = s.x + Math.cos(a) * r
    base[i * 2 + 1] = s.z + Math.sin(a) * r
    cur[i * 3] = base[i * 2]
    cur[i * 3 + 1] = 0.08
    cur[i * 3 + 2] = base[i * 2 + 1]
    ph[i] = Math.random() * Math.PI * 2
  }
  const body = new THREE.BoxGeometry(0.1, 0.13, 0.22)
  const wing = new THREE.BoxGeometry(0.34, 0.02, 0.14).translate(0, 0.02, 0)
  const geo = (() => {
    const g = new THREE.BufferGeometry()
    const b = body.toNonIndexed()
    const w = wing.toNonIndexed()
    const pb = b.getAttribute('position').array
    const pw = w.getAttribute('position').array
    const pos = new Float32Array(pb.length + pw.length)
    pos.set(pb, 0)
    pos.set(pw, pb.length)
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.computeVertexNormals()
    return g
  })()
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x8a93a3 }), n)
  mesh.frustumCulled = false
  const m4 = new THREE.Matrix4()
  const eu = new THREE.Euler()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const update = (dt: number, px: number, pz: number, t: number) => {
    for (let i = 0; i < n; i++) {
      const ix = i * 3
      const hx = base[i * 2], hz = base[i * 2 + 1]
      if (sc[i] <= 0) {
        // grounded: hop a hair, flee if the player gets close
        const ddx = cur[ix] - px, ddz = cur[ix + 2] - pz
        if (ddx * ddx + ddz * ddz < 5) { sc[i] = 2.2 + Math.random() * 1.8; ph[i] = ddx === 0 && ddz === 0 ? 0 : Math.atan2(ddx, ddz) }
        else cur[ix + 1] += (0.08 - cur[ix + 1]) * Math.min(1, dt * 6)
      } else {
        sc[i] -= dt
        const orbit = 1.5 + Math.sin(t * 3 + ph[i]) * 0.4
        const tx = hx + Math.cos(ph[i] + t * 2) * orbit
        const tz = hz + Math.sin(ph[i] + t * 2) * orbit
        const ty = sc[i] > 0.6 ? 1.8 + Math.sin(t * 9 + ph[i]) * 0.5 : 0.08
        const k = Math.min(1, dt * (sc[i] > 0.6 ? 4 : 7))
        cur[ix] += (tx - cur[ix]) * k
        cur[ix + 1] += (ty - cur[ix + 1]) * k
        cur[ix + 2] += (tz - cur[ix + 2]) * k
      }
      const flying = sc[i] > 0
      const flap = flying ? Math.sin(t * 26 + ph[i]) * 0.5 : 0
      eu.set(flap * 0.6, ph[i] + (flying ? t * 2 : 0), flap * 0.4)
      q.setFromEuler(eu)
      one.setScalar(1 + flap * 0.15)
      mesh.setMatrixAt(i, m4.compose(p.set(cur[ix], cur[ix + 1], cur[ix + 2]), q, one))
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  update(0, 0, 0, 0)
  return { mesh, update }
}

// C9 — ground-floor windows spill warm light onto the pavement when the sun is very low.
// One instanced quad per window laid flat on the ground, oriented along the facade normal;
// the shader fades each streak by how sun-facing the wall is, and a global dawn/dusk gate (uGate).
export function makeShafts(spots: { x: number; z: number; nx: number; nz: number }[]) {
  const plane = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = plane.index
  geo.setAttribute('position', plane.getAttribute('position'))
  const n = spots.length
  const ipos = new Float32Array(n * 3)
  const inrm = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    ipos[i * 3] = spots[i].x
    ipos[i * 3 + 1] = 0.18
    ipos[i * 3 + 2] = spots[i].z
    inrm[i * 3] = spots[i].nx
    inrm[i * 3 + 1] = 0
    inrm[i * 3 + 2] = spots[i].nz
  }
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(ipos, 3))
  geo.setAttribute('iNrm', new THREE.InstancedBufferAttribute(inrm, 3))
  geo.instanceCount = n
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLen: { value: 8.5 }, uWidth: { value: 1.8 }, uGate: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, color: { value: new THREE.Color(0xffb066) },
    },
    vertexShader: `
      attribute vec3 iPos;
      attribute vec3 iNrm;
      uniform float uLen, uWidth;
      uniform vec3 uSunDir;
      varying float vFade;
      varying vec2 vUv;
      void main() {
        vec3 along = normalize(vec3(iNrm.x, 0.0, iNrm.z));
        vec3 across = vec3(-along.z, 0.0, along.x);
        float aLong = position.y + 0.5;
        vec3 world = iPos + across * (position.x * uWidth) + along * (aLong * uLen);
        float facing = max(0.0, dot(along, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))));
        vFade = (1.0 - aLong * 0.75) * smoothstep(0.15, 0.7, facing);
        vUv = position.xy + 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: `
      uniform float uGate;
      uniform vec3 color;
      varying float vFade;
      varying vec2 vUv;
      void main() {
        float soft = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x) * smoothstep(1.0, 0.0, vUv.y);
        float a = soft * vFade * uGate;
        if (a < 0.004) discard;
        gl_FragColor = vec4(color * a * 1.9, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return { mesh, mat }
}
