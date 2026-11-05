import { rng } from './util'
import { DISTRICTS, type City, type District } from './city'

// C14 nhịp sống khu phố: nhân tử mật độ ped/xe theo (loại khu gần người chơi, giờ trong ngày).
// Đường cong giờ nằm trong DISTRICTS (city.ts) — một nguồn sự thật cho mọi thuộc tính khu.
export function makeDistrictActivity(city: City, seed = 7702) {
  const rand = rng(seed)
  const lively = city.zoneCenters.map(() => 0.85 + rand() * 0.3)

  // nội suy tuyến tính trên các keypoint (hour tăng dần, wrap ở keypoint cuối = 24)
  const curve = (kind: District, h: number) => {
    const kp = DISTRICTS[kind].density
    const last = kp[kp.length - 1]
    if (h >= last[0]) return last[1]
    for (let i = 0; i < kp.length - 1; i++) {
      const [h0, v0] = kp[i]
      const [h1, v1] = kp[i + 1]
      if (h >= h0 && h < h1) return v0 + (v1 - v0) * ((h - h0) / (h1 - h0))
    }
    return kp[0][1]
  }

  // 55m ảnh hưởng: ngoài mọi khu trả 1.0 (giữ nguyên như cũ), vào gần tâm khu thì lệch dần về bv
  const density = (x: number, z: number, h: number) => {
    let best = 0, bv = 1
    for (let i = 0; i < city.zoneCenters.length; i++) {
      const zn = city.zoneCenters[i]
      const w = 1 - Math.min(1, Math.hypot(x - zn.x, z - zn.z) / 55)
      if (w > best) { best = w; bv = curve(zn.kind, h) * lively[i] }
    }
    return best <= 0 ? 1 : 1 + best * (bv - 1)
  }

  return { density }
}

export type DistrictActivity = ReturnType<typeof makeDistrictActivity>
