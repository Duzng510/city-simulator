import * as THREE from 'three'
import type { City } from './city'

// D12: mặt đất ướt gương lại thành phố. Một lần render half-res qua camera lật theo y=0,
// asphalt + puddle lấy mẫu theo vị trí world đã chiếu — với mặt phẳng nằm ngang thì đây là
// ảnh gương chính xác, không phải xấp xỉ, và rẻ hơn SSR (SSR cần thêm một lần depth prepass
// cho cả scene). Chỉ chạy khi thật sự thấy được: đêm + mưa + tier high trở lên.
export function makeReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, city: City) {
  let rt: THREE.WebGLRenderTarget | null = null
  let on = false
  const cam = new THREE.PerspectiveCamera()
  cam.matrixAutoUpdate = false // ma trận world do ta ghi trực tiếp (phép lật có det = -1)
  const mirror = new THREE.Matrix4().makeScale(1, -1, 1)
  const vp = new THREE.Matrix4()
  const u = {
    tex: { value: null as THREE.Texture | null },
    vp: { value: vp },
    amt: { value: 0 },
  }
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
  const plane = new THREE.Plane()
  const clip = new THREE.Vector4()
  const q = new THREE.Vector4()
  const Y_UP = new THREE.Vector3(0, 1, 0)
  const GROUND = new THREE.Vector3()

  const PARS = `
varying vec3 vWPos;
uniform sampler2D uReflTex;
uniform mat4 uReflVP;
uniform float uReflAmt;
vec2 reflUv( vec2 d ) {
\tvec4 c = uReflVP * vec4( vWPos, 1.0 );
\tc.xy += d;
\treturn c.w > 0.0 ? c.xy / c.w : vec2( - 1.0 );
}`

  const VERT = `
#ifdef USE_INSTANCING
\tvWPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
#else
\tvWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif`

  function inject(mat: THREE.Material, hook: string, body: string) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uReflTex = u.tex
      sh.uniforms.uReflVP = u.vp
      sh.uniforms.uReflAmt = u.amt
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>' + VERT)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>' + PARS)
        .replace(hook, hook + body)
    }
  }

  // gương nhân theo fresnel (dọc theo tia nhìn thì mặt đất phản chiếu mạnh) và nhòe theo độ nhám
  const ASPHALT = `
\tif ( uReflAmt > 0.0 ) {
\t\tfloat ndv = clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 );
\t\tfloat b = 0.004 + 0.05 * roughnessFactor;
\t\tvec3 rr = texture2D( uReflTex, reflUv( vec2( b ) ) ).rgb + texture2D( uReflTex, reflUv( vec2( - b ) ) ).rgb + texture2D( uReflTex, reflUv( vec2( 0.0 ) ) ).rgb;
\t\ttotalEmissiveRadiance += ( rr * 0.3333 ) * uReflAmt * mix( 0.05, 0.6, pow( 1.0 - ndv, 4.0 ) ) * ( 1.0 - roughnessFactor );
\t}`

  // vũng nước là gương sắc: 2 tap, lệch theo gợn sóng của chính texture puddle
  const PUDDLE = `
\tif ( uReflAmt > 0.0 ) {
#ifdef USE_MAP
\t\tvec2 rip = ( texture2D( map, vMapUv ).rg - 0.5 ) * 0.04;
#else
\t\tvec2 rip = vec2( 0.0 );
#endif
\t\tvec3 rr = texture2D( uReflTex, reflUv( rip ) ).rgb + texture2D( uReflTex, reflUv( rip + vec2( 0.008, - 0.006 ) ) ).rgb;
\t\toutgoingLight += rr * 0.5 * uReflAmt;
\t}`

  inject(city.asphaltMat, '#include <emissivemap_fragment>', ASPHALT)
  inject(city.puddles.material as THREE.MeshBasicMaterial, '#include <envmap_fragment>', PUDDLE)

  function alloc(w: number, h: number) {
    free()
    rt = new THREE.WebGLRenderTarget(Math.floor(w / 2), Math.floor(h / 2), { type: THREE.HalfFloatType })
    u.tex.value = rt.texture
  }

  function free() {
    if (!rt) return
    rt.dispose()
    rt = null
    u.tex.value = null
    u.amt.value = 0
    on = false
  }

  function setSize(w: number, h: number) {
    rt?.setSize(Math.floor(w / 2), Math.floor(h / 2))
  }

  function draw() {
    if (!rt) return
    camera.updateMatrixWorld()
    // camera ảo = camera thật nhân qua phép lật y=0; sao đó lật trục x trong clip space để trả
    // lại thứ tự mặt (phép lật làm đảo winding) — cách ba làm trong Reflector
    cam.matrix.multiplyMatrices(mirror, camera.matrixWorld)
    cam.matrixWorld.copy(cam.matrix)
    cam.matrixWorldInverse.copy(cam.matrix).invert()
    cam.near = camera.near
    cam.far = camera.far
    cam.projectionMatrix.copy(camera.projectionMatrix)
    const p = cam.projectionMatrix.elements
    p[8] *= -1
    p[12] *= -1
    vp.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse)
    // mặt phẳng gần nghiêng (Lengyel) để camera ảo không nhìn xuyên xuống dưới lòng đường
    plane.setFromNormalAndCoplanarPoint(Y_UP, GROUND)
    plane.applyMatrix4(cam.matrixWorldInverse)
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
    q.x = (Math.sign(clip.x) + p[8]) / p[0]
    q.y = (Math.sign(clip.y) + p[9]) / p[5]
    q.z = -1
    q.w = (1 + p[10]) / p[14]
    clip.multiplyScalar(2 / clip.dot(q))
    p[2] = clip.x
    p[6] = clip.y
    p[10] = clip.z + 1 - 0.002
    p[14] = clip.w
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
    // puddle không được tự soi mình (vòng phản hồi sáng); các quad glow giả — vũng sáng 17×17 dưới
    // đèn và vệt neon trên mặt đường — cũng phải ẩn, không chúng biến gương thành một bãi sữa
    const pudOn = city.puddles.visible
    const poolOn = city.pools.visible
    const neonOp = city.neonReflMat.opacity
    city.puddles.visible = false
    city.pools.visible = false
    city.neonReflMat.opacity = 0
    const shAuto = renderer.shadowMap.autoUpdate
    renderer.shadowMap.autoUpdate = false
    const cur = renderer.getRenderTarget()
    renderer.setRenderTarget(rt)
    if (!renderer.autoClear) renderer.clear()
    renderer.render(scene, cam)
    renderer.setRenderTarget(cur)
    renderer.shadowMap.autoUpdate = shAuto
    city.puddles.visible = pudOn
    city.pools.visible = poolOn
    city.neonReflMat.opacity = neonOp
  }

  return { u, get on() { return on }, set on(v: boolean) { on = v }, get active() { return on && rt !== null }, alloc, free, setSize, draw }
}

export type Reflection = ReturnType<typeof makeReflection>
