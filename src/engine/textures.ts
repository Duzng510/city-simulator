import * as THREE from 'three'

const cv = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function toTex(c: HTMLCanvasElement, aniso: number) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = aniso
  return t
}

// fl/bays = nhịp cửa sổ trên mỗi tile 8x8m — đổi cả hai là mặt tiền khác hẳn nhau
const PAL = [
  { wall: '#8d8579', trim: '#6d6559', glass: '#1e2d38', gl: '#54707f', lit: 0.5, fl: 2, bays: 2 },
  { wall: '#5c666e', trim: '#464f56', glass: '#141f28', gl: '#4b6a80', lit: 0.64, fl: 3, bays: 3 },
  { wall: '#9b8069', trim: '#7a6350', glass: '#1c2830', gl: '#6b7f66', lit: 0.42, fl: 1, bays: 1 },
  { wall: '#aca69b', trim: '#8b857a', glass: '#242e36', gl: '#8ea3ad', lit: 0.32, fl: 3, bays: 2 },
  { wall: '#7d4f41', trim: '#5c382e', glass: '#1b2530', gl: '#456577', lit: 0.45, fl: 2, bays: 2 },
  { wall: '#516d63', trim: '#3b524b', glass: '#132128', gl: '#3f6b64', lit: 0.55, fl: 2, bays: 3 },
  { wall: '#4a5163', trim: '#363b49', glass: '#0f1722', gl: '#54749c', lit: 0.7, fl: 3, bays: 3 },
  { wall: '#9a8b5f', trim: '#786b48', glass: '#20262c', gl: '#6f7d6b', lit: 0.38, fl: 2, bays: 1 },
]

// window rhythm per facade variant, so the city can place ground-floor light shafts to match the art
export const WINDOW_GRID = PAL.map((p) => ({ fl: p.fl, bays: p.bays }))

// one tile = 8m x 8m, split into p.fl floors x p.bays bays
function facadeTile(v: number, aniso: number) {
  const p = PAL[v % PAL.length]
  const S = 256
  const m = cv(S, S).getContext('2d')!
  const e = cv(S, S).getContext('2d')!
  const i = cv(S, S).getContext('2d')!
  m.fillStyle = p.wall
  m.fillRect(0, 0, S, S)
  for (let i = 0; i < 2400; i++) {
    m.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`
    m.fillRect(Math.random() * S, Math.random() * S, 2, 2)
  }
  if (p.fl <= 2) {
    m.strokeStyle = 'rgba(0,0,0,0.08)'
    m.lineWidth = 1
    for (let y = 0; y < S; y += 7) {
      m.beginPath()
      m.moveTo(0, y)
      m.lineTo(S, y)
      m.stroke()
    }
    m.fillStyle = p.trim
    m.fillRect(0, 0, S, 12)
  }
  e.fillStyle = '#000'
  e.fillRect(0, 0, S, S)
  const fh = S / p.fl
  const bw = S / p.bays
  for (let f = 0; f < p.fl; f++)
    for (let b = 0; b < p.bays; b++) {
      const x = b * bw
      const y = f * fh
      m.fillStyle = p.trim
      m.fillRect(x, y, bw, Math.min(24, fh * 0.16))
      m.fillRect(x, y + fh - 6, bw, 6)
      const wx = x + 15
      const wy = y + 30
      const ww = bw - 30
      const wh = fh - 44
      const g = m.createLinearGradient(wx, wy, wx + ww, wy + wh)!
      g.addColorStop(0, p.gl)
      g.addColorStop(0.45, p.glass)
      g.addColorStop(1, '#0d151b')
      m.fillStyle = g
      m.fillRect(wx, wy, ww, wh)
      m.fillStyle = p.trim
      m.fillRect(wx + ww / 2 - 2, wy, 4, wh)
      m.fillStyle = 'rgba(255,255,255,0.12)'
      m.fillRect(wx, wy, ww, 5)
      if (Math.random() < 0.25) {
        m.fillStyle = 'rgba(230,230,220,0.5)'
        m.fillRect(wx + 4, wy + 4, ww - 8, wh * (0.3 + Math.random() * 0.4))
      }
      if (Math.random() < p.lit) {
        const warm = Math.random() < 0.82
        e.fillStyle = warm ? `hsl(37 62% ${44 + Math.random() * 22}%)` : `hsl(200 45% ${58 + Math.random() * 12}%)`
        e.fillRect(wx + 2, wy + 2, ww - 4, wh - 4)
        e.fillStyle = '#000'
        e.fillRect(wx + ww / 2 - 2, wy, 4, wh)
      }
      // interior room behind the glass (parallax layer): dark vertical gradient + a lit
      // ceiling patch + furniture silhouettes, opaque only inside the window cell (alpha = mask)
      const rg = i.createLinearGradient(wx, wy, wx, wy + wh)!
      rg.addColorStop(0, 'rgba(46,38,28,1)')
      rg.addColorStop(0.5, 'rgba(24,22,20,1)')
      rg.addColorStop(1, 'rgba(9,9,11,1)')
      i.fillStyle = rg
      i.fillRect(wx, wy, ww, wh)
      i.fillStyle = 'rgba(150,120,74,0.55)'
      i.fillRect(wx + ww * 0.16, wy + 2, ww * 0.68, wh * 0.1)
      i.fillStyle = 'rgba(0,0,0,0.62)'
      i.fillRect(wx + ww * (0.12 + ((f * 3 + b) % 3) * 0.22), wy + wh * 0.58, ww * 0.2, wh * 0.4)
      i.fillRect(wx + ww * 0.56, wy + wh * 0.7, ww * 0.3, wh * 0.28)
    }
  return { map: toTex(m.canvas, aniso), emissive: toTex(e.canvas, aniso), interior: toTex(i.canvas, aniso) }
}

// bright window band used by the glow layer on tall buildings: tile = 24m x 3m
function stripTile(aniso: number) {
  const W = 512
  const H = 64
  const m = cv(W, H).getContext('2d')!
  m.fillStyle = '#070a0f'
  m.fillRect(0, 0, W, H)
  for (let i = 0; i < 8; i++) {
    const x = i * (W / 8) + 6
    const w = W / 8 - 14
    if (Math.random() < 0.72) {
      const warm = Math.random() < 0.8
      m.fillStyle = warm ? `hsl(${32 + Math.random() * 12} 70% ${52 + Math.random() * 18}%)` : 'hsl(200 40% 68%)'
    } else m.fillStyle = '#141c24'
    m.fillRect(x, 8, w, H - 20)
    m.fillStyle = 'rgba(0,0,0,0.55)'
    m.fillRect(x + w / 2 - 1, 8, 2, H - 20)
  }
  return toTex(m.canvas, aniso)
}

function asphaltTile(aniso: number) {
  const S = 512
  const m = cv(S, S).getContext('2d')!
  m.fillStyle = '#2b2e33'
  m.fillRect(0, 0, S, S)
  for (let i = 0; i < 9000; i++) {
    const d = Math.random()
    m.fillStyle = `rgba(${d > 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.06})`
    m.fillRect(Math.random() * S, Math.random() * S, 2, 2)
  }
  for (let i = 0; i < 26; i++) {
    m.strokeStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.2})`
    m.lineWidth = 1 + Math.random() * 2
    m.beginPath()
    const x = Math.random() * S
    const y = Math.random() * S
    m.moveTo(x, y)
    m.lineTo(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 90)
    m.stroke()
  }
  for (let i = 0; i < 7; i++) {
    m.fillStyle = `rgba(${40 + Math.random() * 25},${42 + Math.random() * 25},${46 + Math.random() * 25},0.6)`
    m.fillRect(Math.random() * S, Math.random() * S, 30 + Math.random() * 90, 20 + Math.random() * 60)
  }
  // soft blotchy variation breaks the 55x55 tile repetition
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const r = 15 + Math.random() * 60
    const light = Math.random() < 0.4
    const a = 0.03 + Math.random() * 0.05
    const g = m.createRadialGradient(x, y, 0, x, y, r)!
    g.addColorStop(0, light ? `rgba(90,90,95,${a})` : `rgba(0,0,0,${a})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    m.fillStyle = g
    m.beginPath()
    m.arc(x, y, r, 0, 7)
    m.fill()
  }
  // scattered gum / chewing marks
  for (let i = 0; i < 60; i++) {
    m.fillStyle = `rgba(50,50,55,${0.12 + Math.random() * 0.15})`
    m.beginPath()
    m.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 2.5, 0, 7)
    m.fill()
  }
  return toTex(m.canvas, aniso)
}

// roughness is linear data — must NOT go through toTex (which tags sRGB)
function asphaltRough(aniso: number) {
  const S = 512
  const m = cv(S, S).getContext('2d')!
  m.fillStyle = '#b8b8b8'
  m.fillRect(0, 0, S, S)
  for (let i = 0; i < 45; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const r = 12 + Math.random() * 70
    const g = m.createRadialGradient(x, y, 0, x, y, r)!
    g.addColorStop(0, 'rgba(15,15,15,0.95)')
    g.addColorStop(1, 'rgba(15,15,15,0)')
    m.fillStyle = g
    m.beginPath()
    m.arc(x, y, r, 0, 7)
    m.fill()
  }
  const t = new THREE.CanvasTexture(m.canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = aniso
  return t
}

function markingsTile(aniso: number) {
  const W = 128
  const H = 128
  const m = cv(W, H).getContext('2d')!
  m.clearRect(0, 0, W, H)
  m.fillStyle = 'rgba(238,232,205,0.92)'
  m.fillRect(0, H * 0.055, W, 4)
  m.fillRect(0, H * 0.905, W, 4)
  m.fillStyle = 'rgba(238,232,205,0.55)'
  m.fillRect(W * 0.12, H * 0.485, W * 0.5, 3)
  m.fillStyle = 'rgba(255,255,255,0.05)'
  m.fillRect(0, H * 0.2, W, H * 0.12)
  m.fillRect(0, H * 0.68, W, H * 0.12)
  return toTex(m.canvas, aniso)
}

function pavingTile(aniso: number) {
  const S = 256
  const m = cv(S, S).getContext('2d')!
  m.fillStyle = '#8f8b84'
  m.fillRect(0, 0, S, S)
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      const v = 138 + Math.floor(Math.random() * 22)
      m.fillStyle = `rgb(${v},${v - 4},${v - 10})`
      m.fillRect(x * (S / 2) + 2, y * (S / 2) + 2, S / 2 - 4, S / 2 - 4)
    }
  for (let i = 0; i < 1800; i++) {
    m.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`
    m.fillRect(Math.random() * S, Math.random() * S, 2, 2)
  }
  // crack lines — thin random walks
  for (let i = 0; i < 8; i++) {
    m.strokeStyle = `rgba(0,0,0,${0.18 + Math.random() * 0.15})`
    m.lineWidth = 0.6 + Math.random() * 0.6
    m.beginPath()
    let x = Math.random() * S
    let y = Math.random() * S
    m.moveTo(x, y)
    const segs = 4 + Math.floor(Math.random() * 4)
    for (let s = 0; s < segs; s++) {
      x += (Math.random() - 0.5) * 35
      y += (Math.random() - 0.5) * 35
      m.lineTo(x, y)
    }
    m.stroke()
  }
  return toTex(m.canvas, aniso)
}

function grassTile(aniso: number) {
  const S = 256
  const m = cv(S, S).getContext('2d')!
  m.fillStyle = '#3f6134'
  m.fillRect(0, 0, S, S)
  for (let i = 0; i < 5000; i++) {
    const v = Math.random()
    m.fillStyle = v > 0.5 ? `rgba(120,170,90,${Math.random() * 0.4})` : `rgba(20,45,20,${Math.random() * 0.4})`
    m.fillRect(Math.random() * S, Math.random() * S, 3, 2)
  }
  return toTex(m.canvas, aniso)
}

function poolTex() {
  const S = 128
  const m = cv(S, S).getContext('2d')!
  const g = m.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)!
  g.addColorStop(0, 'rgba(255,224,175,0.85)')
  g.addColorStop(0.45, 'rgba(255,190,120,0.20)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  m.fillStyle = g
  m.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(m.canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function glowSprite() {
  const S = 64
  const m = cv(S, S).getContext('2d')!
  const g = m.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)!
  g.addColorStop(0, 'rgba(255,232,180,1)')
  g.addColorStop(0.35, 'rgba(255,214,150,0.45)')
  g.addColorStop(1, 'rgba(255,200,140,0)')
  m.fillStyle = g
  m.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(m.canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function rainStreak() {
  const W = 32
  const H = 128
  const m = cv(W, H).getContext('2d')!
  const v = m.createLinearGradient(0, 0, 0, H)!
  v.addColorStop(0, 'rgba(255,255,255,0)')
  v.addColorStop(0.12, 'rgba(255,255,255,0.7)')
  v.addColorStop(0.6, 'rgba(255,255,255,1)')
  v.addColorStop(1, 'rgba(255,255,255,0)')
  m.fillStyle = v
  m.fillRect(0, 0, W, H)
  m.globalCompositeOperation = 'destination-in'
  const h = m.createLinearGradient(0, 0, W, 0)!
  h.addColorStop(0.36, 'rgba(0,0,0,0)')
  h.addColorStop(0.5, 'rgba(0,0,0,1)')
  h.addColorStop(0.64, 'rgba(0,0,0,0)')
  m.fillStyle = h
  m.fillRect(0, 0, W, H)
  const t = new THREE.CanvasTexture(m.canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function dropletsTex() {
  const S = 128
  const m = cv(S, S).getContext('2d')!
  for (let i = 0; i < 110; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const r = 0.8 + Math.random() * 2.4
    const g = m.createRadialGradient(x, y, 0, x, y, r)!
    g.addColorStop(0, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.30)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    m.fillStyle = g
    m.beginPath()
    m.arc(x, y, r, 0, Math.PI * 2)
    m.fill()
  }
  const t = new THREE.CanvasTexture(m.canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(4, 4)
  return t
}

// one board = one abstract ad: colour field, a shape, headline bars. v picks the palette.
function billboardTex(v: number) {
  const P = [['#0d1b2a', '#e0603a', '#f4e9d8'], ['#102318', '#3fbf8f', '#eaf3ec'], ['#241031', '#9d5cf0', '#f2e9ff'], ['#2a170d', '#f0a33c', '#fff3e0']][v % 4]
  const W = 256
  const H = 128
  const m = cv(W, H).getContext('2d')!
  m.fillStyle = P[0]
  m.fillRect(0, 0, W, H)
  m.fillStyle = P[1]
  m.fillRect(v % 2 ? 150 : 0, 0, 106, H)
  m.fillStyle = P[2]
  m.beginPath()
  m.arc(v % 2 ? 62 : 194, 50, 30, 0, Math.PI * 2)
  m.fill()
  for (let k = 0; k < 3; k++) m.fillRect(20, 90 + k * 12, [150, 112, 74][k], 6)
  const t = new THREE.CanvasTexture(m.canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// A5 lost-dog flyer: cream paper, headline, hand-dog glyph, contact bars
function lostDogTex() {
  const W = 128
  const H = 168
  const m = cv(W, H).getContext('2d')!
  m.fillStyle = '#f5efdd'
  m.fillRect(0, 0, W, H)
  m.fillStyle = '#20232a'
  m.fillRect(10, 12, 108, 4)
  m.font = 'bold 15px sans-serif'
  m.textAlign = 'center'
  m.fillText('LOST DOG', W / 2, 42)
  m.font = '9px sans-serif'
  m.fillText('REWARD', W / 2, 55)
  m.strokeStyle = '#20232a'
  m.lineWidth = 3
  m.beginPath(); m.arc(W / 2, 92, 17, 0, Math.PI * 2); m.stroke()
  m.beginPath(); m.moveTo(W / 2 - 14, 82); m.lineTo(W / 2 - 20, 68); m.lineTo(W / 2 - 6, 76); m.fill()
  m.beginPath(); m.moveTo(W / 2 + 14, 82); m.lineTo(W / 2 + 20, 68); m.lineTo(W / 2 + 6, 76); m.fill()
  m.beginPath(); m.arc(W / 2 - 6, 88, 1.6, 0, Math.PI * 2); m.fill()
  m.beginPath(); m.arc(W / 2 + 6, 88, 1.6, 0, Math.PI * 2); m.fill()
  m.beginPath(); m.arc(W / 2, 97, 2.4, 0, Math.PI * 2); m.fill()
  for (let k = 0; k < 2; k++) m.fillRect(18, 128 + k * 12, W - 36 - k * 20, 6)
  const t = new THREE.CanvasTexture(m.canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// spray tag on a transparent ground so the wall reads through the gaps
function graffitiTex(v: number) {
  const W = 160
  const H = 96
  const m = cv(W, H).getContext('2d')!
  const c = ['#e0489c', '#3fd0e0', '#b4f03c', '#f07a2b', '#7c5cf0'][v % 5]
  m.strokeStyle = c
  m.lineWidth = 9
  m.lineCap = 'round'
  m.beginPath()
  for (let k = 0; k <= 6; k++) m[k ? 'lineTo' : 'moveTo'](16 + (k * (W - 32)) / 6, H / 2 + Math.sin(k * 1.7 + v * 2.3) * 26)
  m.stroke()
  m.fillStyle = c
  m.globalAlpha = 0.5
  m.beginPath()
  m.arc(W - 24, 18, 11, 0, Math.PI * 2)
  m.fill()
  m.fillRect(18, H - 18, 46, 7)
  const t = new THREE.CanvasTexture(m.canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// soft puffy cloud field for the sky overlay: overlapping radial gradients on a transparent sheet
function cloudTex(aniso: number) {
  const S = 1024
  const m = cv(S, S).getContext('2d')!
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const r = 40 + Math.random() * 130
    const g = m.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.5)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    m.fillStyle = g
    m.beginPath()
    m.arc(x, y, r, 0, Math.PI * 2)
    m.fill()
  }
  return toTex(m.canvas, aniso)
}

export function makeTextures(aniso: number) {
  return {
    facade: PAL.map((_, v) => facadeTile(v, aniso)),
    bb: [0, 1, 2, 3].map(billboardTex),
    graffiti: [0, 1, 2, 3, 4].map(graffitiTex),
    lostDog: lostDogTex(),
    strip: stripTile(aniso),
    asphalt: asphaltTile(aniso),
    asphaltRough: asphaltRough(aniso),
    markings: markingsTile(aniso),
    paving: pavingTile(aniso),
    grass: grassTile(aniso),
    glow: glowSprite(),
    rain: rainStreak(),
    pool: poolTex(),
    clouds: cloudTex(aniso),
    droplets: dropletsTex(),
  }
}

export type Textures = ReturnType<typeof makeTextures>
