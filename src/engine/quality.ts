import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js'
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js'
import { FILTERS } from './types'
import type { Filter, Sim, Tier } from './types'
import type { Dressing } from './scene'
import type { Reflection } from './reflect'

export const CONF: Record<Tier, { ratio: number; shadow: number; samples: number; post: boolean; fog: number; aoBlend: number }> = {
  low: { ratio: 1.0, shadow: 0, samples: 0, post: false, fog: 0.003, aoBlend: 0 },
  medium: { ratio: 1.0, shadow: 1024, samples: 2, post: true, fog: 0.0022, aoBlend: 0.55 },
  high: { ratio: 1.35, shadow: 2048, samples: 4, post: true, fog: 0.0018, aoBlend: 0.7 },
  ultra: { ratio: 1.6, shadow: 4096, samples: 4, post: true, fog: 0.0015, aoBlend: 0.85 },
  max: { ratio: 2.0, shadow: 8192, samples: 8, post: true, fog: 0.0013, aoBlend: 0.95 },
}
export const TIERS: Tier[] = ['low', 'medium', 'high', 'ultra', 'max']

const GRAIN_SHADER = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0.04 }, vignette: { value: 0.45 } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse;
uniform float time;
uniform float amount;
uniform float vignette;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = vUv - 0.5;
  c.rgb *= 1.0 - vignette * dot(d, d);
  c.rgb += (hash(vUv * 1024.0 + fract(time)) - 0.5) * amount;
  gl_FragColor = c;
}`,
}

const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, lift: { value: 0.015 }, gamma: { value: 0.98 }, gain: { value: 1.02 }, sat: { value: 1.08 }, tint: { value: new THREE.Vector3(1, 1, 1) }, ca: { value: 0 }, exposure: { value: 1 } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse;
uniform float lift, gamma, gain, sat, ca, exposure;
uniform vec3 tint;
varying vec2 vUv;
void main() {
  vec2 off = (vUv - 0.5) * ca;
  vec4 c = vec4(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b, 1.0);
  c.rgb = pow(max(c.rgb * gain + lift, 0.0), vec3(1.0 / gamma));
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(vec3(g), c.rgb, sat);
  c.rgb *= tint * exposure;
  gl_FragColor = c;
}`,
}

// C11 — fake god rays: threshold + radial blur from one light's screen position. The threshold
// doubles as the occlusion test (a lamp behind a wall contributes no bright pixels), which is why
// this needs no depth pre-pass. Tap count is baked in so the loop bound stays a compile-time const.
const raysShader = (taps: number) => ({
  uniforms: {
    tDiffuse: { value: null },
    uOrigin: { value: new THREE.Vector2(0.5, 0.5) },
    uTint: { value: new THREE.Color(0xffe0b0) },
    uAmount: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse;
uniform vec2 uOrigin;
uniform vec3 uTint;
uniform float uAmount;
varying vec2 vUv;
#define TAPS ${taps}
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  vec2 dv = (vUv - uOrigin) * (1.35 / float(TAPS));
  vec2 coord = vUv;
  float illum = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < TAPS; i++) {
    coord -= dv;
    float inside = step(0.0, coord.x) * step(coord.x, 1.0) * step(0.0, coord.y) * step(coord.y, 1.0);
    vec3 s = texture2D(tDiffuse, coord).rgb * inside;
    s *= smoothstep(0.68, 0.95, max(s.r, max(s.g, s.b))) * uTint;
    acc += s * illum;
    illum *= 0.93;
  }
  gl_FragColor = vec4(base.rgb + acc * (uAmount / float(TAPS)), base.a);
}`,
})

export function makeQuality(
  canvas: HTMLCanvasElement,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sim: Sim,
  dressing: Dressing,
  refl: Reflection,
  onLine?: (t: string) => void,
) {
  let composer: EffectComposer | null = null
  let bloom: UnrealBloomPass | null = null
  let afterimage: AfterimagePass | null = null
  let grain: ShaderPass | null = null
  let gtao: GTAOPass | null = null
  let gtaoK = 1
  let gradePass: ShaderPass | null = null
  let raysPass: ShaderPass | null = null
  let dof: BokehPass | null = null
  const size = new THREE.Vector2()

  let probeT = 0
  let probeMin = 1e9
  let goodT = 0

  // 5s probe windows: a sub-40fps sample drops a tier; 10s of 58+ raises one back
  function adapt(win: number, f: number) {
    if (!sim.adaptive) return
    const i = TIERS.indexOf(sim.tier)
    probeT += win
    probeMin = Math.min(probeMin, f)
    goodT = f > 58 ? goodT + win : 0
    if (goodT >= 10 && i < TIERS.length - 1) {
      sim.tier = TIERS[i + 1]
      applyTier()
      onLine?.(`tự động nâng lên ${sim.tier}`)
      goodT = probeT = 0
      probeMin = 1e9
      return
    }
    if (probeT >= 5) {
      if (probeMin < 40 && i > 0) {
        sim.tier = TIERS[i - 1]
        applyTier()
        onLine?.(`tự động hạ xuống ${sim.tier} · FPS ${probeMin.toFixed(0)}`)
      }
      probeT = 0
      probeMin = 1e9
      goodT = 0
    }
  }

  function applyFilter() {
    if (!gradePass) return
    const f = FILTERS[sim.filter]
    for (const k of ['lift', 'gamma', 'gain', 'sat'] as const) gradePass.uniforms[k].value = f[k]
    gradePass.uniforms.tint.value.set(...f.tint)
    gradePass.uniforms.ca.value = sim.ca
  }

  // E9: look controls live on passes that may not exist (tier low → no composer; effects off →
  // no grade/grain). Each guard is a real boundary, so a missing pass silently skips that control.
  function applyPhoto() {
    if (dof) {
      const u = dof.uniforms as Record<string, { value: number }>
      dof.enabled = sim.dof
      u.focus.value = sim.dofFocus
      u.aperture.value = sim.dofAperture * 0.05
    }
    if (gradePass) gradePass.uniforms.exposure.value = sim.exposure
    if (grain) grain.uniforms.vignette.value = sim.vignette
  }

  function teardownComposer() {
    if (!composer) return
    // dispose each pass — EffectComposer.dispose() doesn't, leaks GTAO/Bloom RTs on every toggle
    composer.passes.forEach((p) => {
      const d = (p as unknown as { dispose?: () => void }).dispose
      if (typeof d === 'function') d.call(p)
    })
    composer.dispose()
    composer = null
    refl.free()
    bloom = null
    afterimage = null
    grain = null
    gtao = null
    gradePass = null
    raysPass = null
    dof = null
  }

  function applyTier() {
    const c = CONF[sim.tier]
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, c.ratio))
    const useShadow = sim.effects.shadows && c.shadow > 0
    dressing.sun.castShadow = useShadow
    dressing.sun.shadow.mapSize.set(c.shadow || 512, c.shadow || 512)
    if (dressing.sun.shadow.map) {
      dressing.sun.shadow.map.dispose()
      dressing.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget
    }
    teardownComposer()
    if (c.post) {
      renderer.getDrawingBufferSize(size)
      composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: c.samples }))
      composer.addPass(new RenderPass(scene, camera))
      if (sim.effects.ao) {
        gtao = new GTAOPass(scene, camera, size.x, size.y)
        gtao.output = GTAOPass.OUTPUT.Default
        const top = sim.tier === 'ultra' || sim.tier === 'max'
        const aoR = top ? 1.2 : sim.tier === 'high' ? 1.0 : 0.7
        const aoD = top ? 1.5 : sim.tier === 'high' ? 1.35 : 1.2
        gtao.updateGtaoMaterial({ radius: aoR, distanceExponent: aoD, thickness: 1.5, scale: 1.0 })
        gtao.blendIntensity = c.aoBlend
        // half-res AO: the pass re-renders the whole scene for normals, so shrinking its
        // buffers is where the medium tier's post cost actually sits
        gtaoK = sim.tier === 'medium' ? 0.5 : 1
        composer.addPass(gtao)
      }
      if (sim.effects.bloom) {
        bloom = new UnrealBloomPass(size.clone(), 0.4, 0.45, 0.9)
        composer.addPass(bloom)
      }
      composer.addPass(new OutputPass())
      // E9 real bokeh: BokehPass re-renders the scene to a depth target each frame it is enabled,
      // so it is built once with the chain and left disabled until the camera panel turns it on.
      dof = new BokehPass(scene, camera, { focus: 12, aperture: 0.025, maxblur: 0.012 })
      dof.enabled = false
      composer.addPass(dof)
      // C11 runs on the tonemapped frame so the 0.68 threshold maps to "visibly blown out";
      // gated per frame, and taps scale with tier because UHD can't afford 28 fetches at 2x
      if (sim.effects.rays) {
        raysPass = new ShaderPass(raysShader(sim.tier === 'medium' ? 12 : sim.tier === 'high' ? 20 : 28))
        raysPass.enabled = false
        composer.addPass(raysPass)
      }
      // afterimage keeps its own history buffer, so it stays in the chain and is gated per frame
      afterimage = new AfterimagePass(0)
      afterimage.enabled = false
      composer.addPass(afterimage)
      if (sim.effects.grade || sim.filter !== 'none') {
        gradePass = new ShaderPass(GRADE_SHADER)
        applyFilter()
        composer.addPass(gradePass)
      }
      if (sim.effects.grain) {
        grain = new ShaderPass(GRAIN_SHADER)
        grain.uniforms.amount.value = sim.tier === 'high' || sim.tier === 'ultra' || sim.tier === 'max' ? 0.055 : 0.03
        composer.addPass(grain)
      }
      // D12: medium trở xuống không còn draw call budget cho lần render gương thứ hai
      const wantRefl = TIERS.indexOf(sim.tier) >= 2
      if (wantRefl) {
        refl.alloc(size.x, size.y)
        refl.on = true
      }
    }
    resize()
    applyPhoto()
  }

  function sizeGtao() {
    if (!gtao || gtaoK === 1) return
    renderer.getDrawingBufferSize(size)
    gtao.setSize(Math.floor(size.x * gtaoK), Math.floor(size.y * gtaoK))
  }

  function resize() {
    const w = canvas.clientWidth || 1280
    const h = canvas.clientHeight || 720
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
    composer?.setSize(w, h)
    sizeGtao()
    if (refl.active) {
      renderer.getDrawingBufferSize(size)
      refl.setSize(size.x, size.y)
    }
  }

  // one-off oversize buffer for capture(): the caller must grab toDataURL() before resize() puts
  // the window size back, otherwise it reads a buffer that was never drawn into
  function oversize(w: number, h: number) {
    renderer.setSize(w, h, false)
    composer?.setSize(w, h)
    sizeGtao()
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  function render(dt: number) {
    if (composer) composer.render(dt)
    else renderer.render(scene, camera)
  }

  function grainTime(t: number) {
    if (grain) grain.uniforms.time.value = t
  }

  return {
    applyTier, teardownComposer, applyFilter, applyPhoto, adapt, resize, sizeGtao, render, oversize, grainTime,
    get composer() { return composer },
    get bloom() { return bloom },
    get afterimage() { return afterimage },
    get raysPass() { return raysPass },
    get gradePass() { return gradePass },
    get grain() { return grain },
  }
}

export type Quality = ReturnType<typeof makeQuality>
