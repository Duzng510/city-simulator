import * as THREE from 'three'
import { rushHour } from './util'
import type { Door } from './city'
import type { Sim } from './types'
import type { World } from './world'
import type { Dressing } from './scene'
import type { CameraRig } from './camera'
import type { Vehicles } from './vehicle'
import type { makeRain } from './weather'
import type { makeAmbient } from './audio'

// Everything the E key can do, plus the street<->shop fade that gates it.
export function makeInteraction(
  camera: THREE.Camera,
  scene: THREE.Scene,
  sim: Sim,
  world: World,
  dressing: Dressing,
  rig: CameraRig,
  veh: Vehicles,
  rain: ReturnType<typeof makeRain>,
  ambient: ReturnType<typeof makeAmbient>,
  onLine?: (t: string) => void,
) {
  const { city, ents, player, steam, drips, shafts, pigeons, canMesh, interior } = world
  const { sky, stars, moon, hemi, sun, moonlight, lamps, headlights } = dressing

  // interior transition (B3): fade through black, swap street <-> shared room.
  const fogRef = scene.fog as THREE.FogExp2
  const fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
  const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMat)
  fadeQuad.position.z = -0.3
  fadeQuad.renderOrder = 999
  fadeQuad.frustumCulled = false
  camera.add(fadeQuad)
  scene.add(camera)
  let currentDoor: Door | null = null
  let streetYaw = 0
  let fadeState = 0
  let fadeT = 0
  let fadeCb: (() => void) | null = null

  let buskerTipped = false

  // NPC interaction (B2): freeze a nearby ped and show a context line — flavour, not quests
  const LINES: Record<'rain' | 'night' | 'rush' | 'generic', string[]> = {
    rain: ['Mưa thế này mà còn đi dạo?', 'Trời mưa, đường trơn lắm đấy.', 'Cậu không mang ô à?'],
    night: ['Khuya rồi, sao còn lang thang?', 'Ban đêm khu này vắng lắm.', 'Đèn đường hỏng nửa dãy rồi.'],
    rush: ['Kẹt xe kinh hoàng, tôi chờ 20 phút rồi.', 'Giờ cao điểm, ai cũng vội.', 'Bến xe đông nghịt.'],
    generic: ['Thành phố này dạo này đổi nhiều quá.', 'Ông chủ quán cà phê đầu ngõ vui tính lắm.', 'Cậu sống ở khu này lâu chưa?', 'Cuối tuần này có chợ trời đấy.'],
  }
  function pickLine() {
    const ctx = rain.amount > 0.3 ? 'rain' : sim.night > 0.5 ? 'night' : rushHour(sim.hour) > 0.5 ? 'rush' : 'generic'
    const pool = LINES[ctx]
    return pool[Math.floor(Math.random() * pool.length)]
  }

  function setInterior(on: boolean) {
    city.group.visible = !on
    ents.group.visible = !on
    steam.points.visible = !on
    drips.points.visible = !on
    shafts.mesh.visible = !on
    player.root.visible = !on
    rain.points.visible = !on
    rain.splashes.visible = !on
    pigeons.mesh.visible = !on
    sky.visible = !on
    stars.visible = !on
    moon.visible = !on
    hemi.visible = !on
    sun.visible = !on
    moonlight.visible = !on
    for (const l of lamps) l.visible = !on
    for (const s of headlights) s.visible = !on
    scene.fog = on ? null : fogRef
    interior.visible = on
  }

  function fadeThrough(cb: () => void) {
    fadeCb = cb
    fadeState = 1
    fadeT = 0
  }

  function enterShop(d: Door) {
    fadeThrough(() => {
      currentDoor = d
      streetYaw = player.yaw
      player.pitch = 0.1
      sim.inside = true
      setInterior(true)
    })
  }

  function exitShop() {
    fadeThrough(() => {
      sim.inside = false
      setInterior(false)
      if (currentDoor?.exit) player.pos.set(currentDoor.exit.x, 0, currentDoor.exit.z)
      player.yaw = streetYaw + Math.PI
      currentDoor = null
    })
  }

  // the fade runs on wall-clock frames, so it keeps resolving while the sim is paused
  function fadeUpdate(dt: number) {
    if (fadeState === 1) {
      fadeT += dt
      const a = Math.min(1, fadeT / 0.25)
      fadeMat.opacity = a
      if (a >= 1) {
        fadeCb?.()
        fadeCb = null
        fadeState = 2
        fadeT = 0
      }
    } else if (fadeState === 2) {
      fadeT += dt
      const a = Math.min(1, fadeT / 0.3)
      fadeMat.opacity = 1 - a
      if (a >= 1) fadeState = 0
    }
  }

  // nearest entry point of one kind, or null
  function nearest<T extends { x: number; z: number }>(spots: readonly T[], r: number): T | null {
    let best: T | null = null
    let bd = r
    for (const s of spots) {
      const d = Math.hypot(player.pos.x - s.x, player.pos.z - s.z)
      if (d < bd) {
        bd = d
        best = s
      }
    }
    return best
  }

  // context hint (E8): the nearest thing E would act on — same order/radii as interact(), no side
  // effects. Player mode, on foot only; React caches text per key so re-renders are cheap.
  function hint(): { key: string; text: string } | null {
    if (sim.idle || sim.mode !== 'player' || sim.inside || sim.sitting || sim.inCar || sim.inBike) return null
    if (rain.amount > 0.3) return { key: 'rain', text: 'Mưa đổi âm thanh và phản chiếu mặt đường.' }
    if (nearest(city.benches, 2.6)) return { key: 'seat', text: 'Gần ghế dài · E để ngồi' }
    if (nearest(city.vending, 2.3)) return { key: 'vending', text: 'Máy bán nước · E để mua' }
    if (nearest(city.carts, 2.4)) return { key: 'cart', text: 'Xe bánh mì · E để mua' }
    if (sim.holdingCan && nearest(city.trash, 2.2)) return { key: 'trash', text: 'Thùng rác · E để vứt lon' }
    const dd = 2.0
    for (const s of city.doorSpots) if (Math.hypot(player.pos.x - s.hx, player.pos.z - s.hz) < dd) return { key: 'shop', text: 'Cửa hàng · E để vào trong' }
    if (veh.bikeParked ? Math.hypot(player.pos.x - veh.bike.x, player.pos.z - veh.bike.z) < 2.8 : city.bikeRacks.some((s) => Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < 2.6)) return { key: 'bike', text: 'Xe đạp · E để lấy' }
    if (Math.hypot(player.pos.x - world.busX, player.pos.z - world.busZ) < 2.6) return { key: 'busker', text: 'Nghệ sĩ đường phố · E để thưởng' }
    if (ents.talkNearest(player.pos.x, player.pos.z, 2.5)) return { key: 'talk', text: 'Người qua đường · E để trò chuyện' }
    return { key: 'drive', text: 'Gần một chiếc xe · nhấn E để lên lái' }
  }

  function interact() {
    if (sim.inside) {
      exitShop()
      return
    }
    if (sim.sitting) {
      rig.sitStop()
      return
    }
    if (!sim.inCar && !sim.inBike) {
      const bench = nearest(city.benches, 2.6)
      if (bench) {
        rig.sitStart(bench.x, bench.z)
        return
      }
      // vending (B4): buy a soda from the nearest machine — small touch, city you can poke
      const vendor = nearest(city.vending, 2.3)
      if (vendor) {
        sim.holdingCan = true
        canMesh.visible = true
        onLine?.('Bạn mua một lon nước.')
        ambient.clunk(vendor.x, vendor.z)
        return
      }
      // food cart (feature 2): buy a bánh mì from the market cart — the payoff beat for the steam
      const cart = nearest(city.carts, 2.4)
      if (cart) {
        onLine?.('Bạn mua một ổ bánh mì.')
        ambient.sizzle(cart.x, cart.z)
        return
      }
      // litter (B5): holding a can makes every bin on the block worth walking over to
      if (sim.holdingCan) {
        const bin = nearest(city.trash, 2.2)
        if (bin) {
          sim.holdingCan = false
          canMesh.visible = false
          onLine?.('Bạn vứt lon vào thùng rác.')
          ambient.clunk(bin.x, bin.z)
          return
        }
      }
      // shop (B3): stand at a shop threshold and press E to duck inside
      let dbest: Door | null = null
      let dd = 2.0
      for (const s of city.doorSpots) {
        const d = Math.hypot(player.pos.x - s.hx, player.pos.z - s.hz)
        if (d < dd) {
          dd = d
          dbest = s
        }
      }
      if (dbest) {
        enterShop(dbest)
        return
      }
      // bike (B6): beside a rack, or beside the bike you left, E puts you in the saddle
      if (veh.bikeParked ? Math.hypot(player.pos.x - veh.bike.x, player.pos.z - veh.bike.z) < 2.8 : city.bikeRacks.some((s) => Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < 2.6)) {
        onLine?.('Bạn lấy xe đạp.')
        veh.toggleBike()
        return
      }
      // busker: drop a coin in the guitar case and he plays another song, a touch sharper
      if (Math.hypot(player.pos.x - world.busX, player.pos.z - world.busZ) < 2.6) {
        onLine?.(buskerTipped ? 'Busker gảy thêm một bài.' : 'Bạn thả 10.000đ vào hộp đàn.')
        ambient.tipBusker()
        buskerTipped = true
        return
      }
    }
    if (sim.inCar) return veh.toggleCar()
    if (sim.inBike) {
      onLine?.('Bạn dựng xe lại.')
      veh.toggleBike()
      return
    }
    if (ents.talkNearest(player.pos.x, player.pos.z, 2.5)) {
      onLine?.(pickLine())
      return
    }
    if (ents.busHorn()) return
    veh.toggleCar()
  }

  function dispose() {
    camera.remove(fadeQuad)
    scene.remove(camera)
    fadeQuad.geometry.dispose()
    fadeMat.dispose()
  }

  return { interact, hint, fadeUpdate, dispose }
}

export type Interaction = ReturnType<typeof makeInteraction>
