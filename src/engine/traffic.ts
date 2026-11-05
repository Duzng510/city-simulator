import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { N, ROAD, line } from './city'
import { rng } from './util'
import { boxAt, paint } from './geo'

// F1: đèn giao thông là nguồn sự thật cho cả xe lẫn người đi bộ. Trước đây bảng pha nằm trong
// entities.ts và không có trụ đèn nào, nên xe dừng trước một cái đèn vô hình.
const GREEN = 10
const AMBER = 1.6
export const STOP = 7.6 // vạch dừng: mép giao lộ cộng phần vỉa hè, xe phải dừng trước nó
const PER = 2 * (GREEN + AMBER) // hai trục, mỗi trục một pha xanh + hổ phách

export interface Traffic {
  group: THREE.Group
  update: (t: number, night: number) => void
  greenAxis: (I: number, J: number, t: number) => number
  level: (I: number, J: number, axis: number, t: number) => number
}

export function makeTraffic(seed = 7311): Traffic {
  const group = new THREE.Group()
  const rand = rng(seed)

  // mỗi giao lộ một offset để không đổi pha cùng lúc cả thành phố; chu kỳ chung nên xe chạy dọc
  // một tuyến vẫn gặp dải xanh liên tiếp
  const off = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) off[i] = rand() * PER
  const cl = (i: number) => (i < 0 ? 0 : i > N - 1 ? N - 1 : i)
  const phase = (I: number, J: number, t: number) =>
    (((t + off[cl(I) * N + cl(J)]) % PER) + PER) % PER

  // trục đang được chảy (xe chạy dọc nó, người đi bộ cắt ngang nó). Đi ngược chiều vẫn tính theo
  // trục — lane model của entities cũng gộp hai chiều.
  const greenAxis = (I: number, J: number, t: number) => {
    if (I < 0 || J < 0 || I >= N || J >= N) return -1
    return phase(I, J, t) < GREEN + AMBER ? 0 : 1
  }
  // 2 xanh · 1 hổ phách · 0 đỏ cho xe chạy trên `axis` tại giao lộ (I,J)
  const level = (I: number, J: number, axis: number, t: number) => {
    if (I < 0 || J < 0 || I >= N || J >= N) return 2
    let run = phase(I, J, t) - (axis === 0 ? 0 : GREEN + AMBER)
    if (run < 0) run += PER
    return run >= GREEN + AMBER ? 0 : run >= GREEN ? 1 : 2
  }

  const A = N * N * 4
  const grey = new THREE.MeshStandardMaterial({ color: 0x2c333c, roughness: 0.7, metalness: 0.3 })
  const paintMat = new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.85 })
  // ba bóng đi trong cùng một instance: một setColorAt đổi được cả cụm, material trắng để
  // vertexColor quyết định độ sáng
  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
  // local +z là hướng người lái đang nhìn tới, nên đầu đèn nhô về phía giao lộ còn ba bóng nằm ở
  // mặt -z để quay đúng vào tài xế
  const body = new THREE.InstancedMesh(mergeGeometries([
    boxAt(0.14, 3.0, 0.14, 0, 1.5, 0),
    boxAt(0.12, 0.12, 0.7, 0, 2.85, 0.35),
    boxAt(0.34, 0.95, 0.2, 0, 2.95, 0.72),
    boxAt(0.4, 0.1, 0.24, 0, 3.36, 0.5),
    boxAt(0.4, 0.1, 0.24, 0, 2.95, 0.5),
    boxAt(0.4, 0.1, 0.24, 0, 2.54, 0.5),
  ], false)!, grey, A)
  const lamps = new THREE.InstancedMesh(mergeGeometries([
    paint(boxAt(0.21, 0.21, 0.06, 0, 3.36, 0.59), new THREE.Color(1, 1, 1)),
    paint(boxAt(0.21, 0.21, 0.06, 0, 2.95, 0.59), new THREE.Color(1, 1, 1)),
    paint(boxAt(0.21, 0.21, 0.06, 0, 2.54, 0.59), new THREE.Color(1, 1, 1)),
  ], false)!, lampMat, A)
  const stops = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.2, 0.32).rotateX(-Math.PI / 2), paintMat, A)
  for (const m of [body, lamps, stops]) m.frustumCulled = false
  body.castShadow = true
  group.add(body, lamps, stops)

  const m4 = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  // Duyệt theo đúng thứ tự này ở cả chỗ dựng hình lẫn chỗ đổi màu: index instance = ((I*N+J)*4 + a*2 + side)
  let n = 0
  for (let I = 0; I < N; I++) {
    for (let J = 0; J < N; J++) {
      for (let a = 0; a < 2; a++) {
        for (let s = 0; s < 2; s++) {
          const d = s ? -1 : 1
          // người lái đi trên trục `a` theo chiều `d`; tay phải của họ là +z·d (a=0) hoặc -x·d (a=1)
          const right = (a === 0 ? 1 : -1) * d
          const along = (a === 0 ? line(I) : line(J)) - d * STOP
          const lat = (a === 0 ? line(J) : line(I)) + right * (ROAD / 2 + 0.7)
          const x = a === 0 ? along : lat
          const z = a === 0 ? lat : along
          q.setFromAxisAngle(up, a === 0 ? (d > 0 ? Math.PI / 2 : -Math.PI / 2) : d > 0 ? 0 : Math.PI)
          m4.compose(p.set(x, 0, z), q, one)
          body.setMatrixAt(n, m4)
          lamps.setMatrixAt(n, m4)
          // vạch dừng cắt ngang làn của nó (làn ở offset 3.1 so với tim đường)
          const lx = a === 0 ? line(I) - d * STOP : line(I) + right * 3.1
          const lz = a === 0 ? line(J) + right * 3.1 : line(J) - d * STOP
          q.setFromAxisAngle(up, a === 0 ? Math.PI / 2 : 0)
          m4.compose(p.set(lx, 0.02, lz), q, one)
          stops.setMatrixAt(n++, m4)
        }
      }
    }
  }
  body.count = lamps.count = stops.count = n
  for (const m of [body, lamps, stops]) m.instanceMatrix.needsUpdate = true

  const green = new THREE.Color(0x2aff7a)
  const amber = new THREE.Color(0xffb32a)
  const red = new THREE.Color(0xff2a1e)
  const scratch = new THREE.Color()
  const setLamp = (i: number, c: THREE.Color, k: number) => lamps.setColorAt(i, scratch.copy(c).multiplyScalar(k))

  // đỏ vẫn phát sáng mờ để ban ngày nhìn vẫn ra đèn, tối thì rực lên
  const update = (t: number, night: number) => {
    const k = 0.5 + 0.5 * night
    let i = 0
    for (let I = 0; I < N; I++) {
      for (let J = 0; J < N; J++) {
        for (let a = 0; a < 2; a++) {
          const lv = level(I, J, a, t)
          const c = lv === 2 ? green : lv === 1 ? amber : red
          const b = lv === 0 ? 0.12 : lv === 1 ? 0.35 : 1
          setLamp(i++, c, b * k)
          setLamp(i++, c, b * k)
        }
      }
    }
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true
  }
  update(0, 0)

  return { group, update, greenAxis, level }
}
