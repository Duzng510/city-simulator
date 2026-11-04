import { clamp } from './util'

// two procedural loops — traffic rumble by day, crickets + wind by night — crossfaded by daylight
export function makeAmbient() {
  let ctx: AudioContext | null = null
  let dayG: GainNode | null = null
  let nightG: GainNode | null = null
  let parkG: GainNode | null = null
  let marketG: GainNode | null = null
  let plazaG: GainNode | null = null
  let engOsc: OscillatorNode | null = null
  let engSub: OscillatorNode | null = null
  let engG: GainNode | null = null
  let skidG: GainNode | null = null
  let acG: GainNode | null = null
  let drillG: GainNode | null = null
  let master: GainNode | null = null
  let vol = 0.5
  let guitarG: GainNode | null = null
  let buskerDetune = 1

  function noise(ctx: AudioContext) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = b.getChannelData(0)
    let x = 0
    for (let i = 0; i < d.length; i++) {
      x = (x + 0.02 * (Math.random() * 2 - 1)) / 1.02
      d[i] = x * 3.5
    }
    return b
  }

  function src(ctx: AudioContext, buf: AudioBuffer, rate: number) {
    const s = ctx.createBufferSource()
    s.buffer = buf
    s.loop = true
    s.playbackRate.value = rate
    s.start()
    return s
  }

  function build() {
    if (ctx) return
    ctx = new AudioContext()
    const buf = noise(ctx)
    master = ctx.createGain()
    master.gain.value = vol
    master.connect(ctx.destination)

    // day: low rumble with a slow swell, like distant traffic
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 260
    const swellG = ctx.createGain()
    swellG.gain.value = 0.75
    lp.connect(swellG)
    dayG = ctx.createGain()
    dayG.gain.value = 0
    swellG.connect(dayG)
    dayG.connect(master)
    src(ctx, buf, 1).connect(lp)
    const swell = ctx.createOscillator()
    swell.frequency.value = 0.07
    const swellAmt = ctx.createGain()
    swellAmt.gain.value = 0.25
    swell.connect(swellAmt)
    swellAmt.connect(swellG.gain)
    swell.start()
    const hum = ctx.createOscillator()
    hum.type = 'triangle'
    hum.frequency.value = 62
    const humG = ctx.createGain()
    humG.gain.value = 0.1
    hum.connect(humG)
    humG.connect(dayG)
    hum.start()

    // night: bandpass wind + amplitude-chopped 4kHz tone for crickets
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 780
    bp.Q.value = 0.6
    nightG = ctx.createGain()
    nightG.gain.value = 0
    bp.connect(nightG)
    nightG.connect(master)
    src(ctx, buf, 0.83).connect(bp)

    const chirp = ctx.createOscillator()
    chirp.type = 'sine'
    chirp.frequency.value = 4300
    const chirpG = ctx.createGain()
    chirpG.gain.value = 0.02
    const chop = ctx.createOscillator()
    chop.type = 'square'
    chop.frequency.value = 3.4
    const chopAmt = ctx.createGain()
    chopAmt.gain.value = 0.02
    chop.connect(chopAmt)
    chopAmt.connect(chirpG.gain)
    chirp.connect(chirpG)
    chirpG.connect(nightG)
    chirp.start()
    chop.start()

    // D1 location layers, crossfaded by proximity via setZone()
    // park: soft wind bed + two slow AM'd sine "birds"
    parkG = ctx.createGain()
    parkG.gain.value = 0
    parkG.connect(master)
    const pWind = ctx.createBiquadFilter()
    pWind.type = 'bandpass'
    pWind.frequency.value = 1400
    pWind.Q.value = 0.5
    pWind.connect(parkG)
    src(ctx, buf, 0.6).connect(pWind)
    for (const f of [2400, 3150]) {
      const bird = ctx.createOscillator()
      bird.type = 'sine'
      bird.frequency.value = f
      const birdG = ctx.createGain()
      birdG.gain.value = 0.012
      const gate = ctx.createOscillator()
      gate.type = 'sine'
      gate.frequency.value = f === 2400 ? 1.7 : 2.6
      const gateAmt = ctx.createGain()
      gateAmt.gain.value = 0.012
      gate.connect(gateAmt)
      gateAmt.connect(birdG.gain)
      bird.connect(birdG)
      birdG.connect(parkG)
      bird.start()
      gate.start()
    }

    // market: bandpassed murmur with a slow amplitude flutter, like distant crowd
    marketG = ctx.createGain()
    marketG.gain.value = 0
    marketG.connect(master)
    const mBp = ctx.createBiquadFilter()
    mBp.type = 'bandpass'
    mBp.frequency.value = 620
    mBp.Q.value = 3
    const mGait = ctx.createGain()
    mGait.gain.value = 0.7
    mBp.connect(mGait)
    mGait.connect(marketG)
    src(ctx, buf, 0.5).connect(mBp)
    const mFlutter = ctx.createOscillator()
    mFlutter.frequency.value = 0.6
    const mFlutterAmt = ctx.createGain()
    mFlutterAmt.gain.value = 0.3
    mFlutter.connect(mFlutterAmt)
    mFlutterAmt.connect(mGait.gain)
    mFlutter.start()

    // plaza: fountain — a bright bandpass over a lowpass body
    plazaG = ctx.createGain()
    plazaG.gain.value = 0
    plazaG.connect(master)
    const fBody = ctx.createBiquadFilter()
    fBody.type = 'lowpass'
    fBody.frequency.value = 900
    fBody.connect(plazaG)
    src(ctx, buf, 1.3).connect(fBody)
    const fSplat = ctx.createBiquadFilter()
    fSplat.type = 'bandpass'
    fSplat.frequency.value = 2600
    fSplat.Q.value = 0.7
    fSplat.connect(plazaG)
    src(ctx, buf, 0.9).connect(fSplat)

    // busker: procedural acoustic loop, a Karplus-Strong string plucked on a slow pattern; audible only near the plaza at night
    guitarG = ctx.createGain()
    guitarG.gain.value = 0
    guitarG.connect(master)
    const gnotes = [110, 164.8, 220, 261.6, 220, 164.8, 196, 146.8]
    let gni = 0
    setInterval(() => {
      if ((guitarG?.gain.value ?? 0) > 0.01) pluck(gnotes[gni++ % gnotes.length] * buskerDetune)
    }, 600)

    // D2 car engine: saw + sine sub through a lowpass, pitch/level by speed via setEngine()
    engG = ctx.createGain()
    engG.gain.value = 0
    engG.connect(master)
    const engFilt = ctx.createBiquadFilter()
    engFilt.type = 'lowpass'
    engFilt.frequency.value = 700
    engFilt.connect(engG)
    engOsc = ctx.createOscillator()
    engOsc.type = 'sawtooth'
    engOsc.frequency.value = 45
    engOsc.connect(engFilt)
    engOsc.start()
    engSub = ctx.createOscillator()
    engSub.type = 'sine'
    engSub.frequency.value = 45
    const subG = ctx.createGain()
    subG.gain.value = 0.6
    engSub.connect(subG)
    subG.connect(engFilt)
    engSub.start()

    // tire squeal: looping filtered noise, level follows slip via setSkid()
    skidG = ctx.createGain()
    skidG.gain.value = 0
    skidG.connect(master)
    const skidF = ctx.createBiquadFilter()
    skidF.type = 'bandpass'
    skidF.frequency.value = 1500
    skidF.Q.value = 0.8
    skidF.connect(skidG)
    src(ctx, buf, 1.3).connect(skidF)

    // D5 street texture: AC hum near buildings, distant drill near construction, via setBuild()
    acG = ctx.createGain()
    acG.gain.value = 0
    acG.connect(master)
    for (const f of [120, 241]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.value = f === 120 ? 0.5 : 0.15
      o.connect(g)
      g.connect(acG)
      o.start()
    }
    drillG = ctx.createGain()
    drillG.gain.value = 0
    drillG.connect(master)
    const dBp = ctx.createBiquadFilter()
    dBp.type = 'bandpass'
    dBp.frequency.value = 800
    dBp.Q.value = 4
    dBp.connect(drillG)
    const dChopG = ctx.createGain()
    dChopG.gain.value = 0.5
    src(ctx, buf, 1.1).connect(dChopG)
    dChopG.connect(dBp)
    const dChop = ctx.createOscillator()
    dChop.type = 'square'
    dChop.frequency.value = 9
    const dChopAmt = ctx.createGain()
    dChopAmt.gain.value = 0.5
    dChop.connect(dChopAmt)
    dChopAmt.connect(dChopG.gain)
    dChop.start()
  }

  function set(v: number) {
    vol = clamp(v, 0, 1)
    if (master && ctx) master.gain.setTargetAtTime(vol, ctx.currentTime, 0.1)
  }

  let stepBuf: AudioBuffer | null = null
  function footstep(wet: boolean) {
    if (!ctx || !master) return
    if (!stepBuf) {
      const b = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate)
      const d = b.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.03))
      stepBuf = b
    }
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = stepBuf
    src.playbackRate.value = 0.85 + Math.random() * 0.3
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'
    filt.frequency.value = wet ? 1400 : 600
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(wet ? 0.08 : 0.12, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
    src.connect(filt).connect(gain).connect(master)
    src.start(t)
    src.stop(t + 0.15)
  }

  // rare one-shots so the street feels inhabited, not a loop
  function distantCar() {
    if (!ctx || !master) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const filt = ctx.createBiquadFilter()
    const gain = ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(80 + Math.random() * 40, t)
    osc.frequency.exponentialRampToValueAtTime(140, t + 2.5)
    filt.type = 'lowpass'
    filt.frequency.value = 400
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.03, t + 0.3)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2.5)
    osc.connect(filt).connect(gain).connect(master)
    osc.start(t)
    osc.stop(t + 2.6)
  }

  function dogBark() {
    if (!ctx || !master) return
    const t = ctx.currentTime
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(280, t + i * 0.18)
      osc.frequency.exponentialRampToValueAtTime(180, t + i * 0.18 + 0.12)
      gain.gain.setValueAtTime(0.015, t + i * 0.18)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.14)
      osc.connect(gain).connect(master)
      osc.start(t + i * 0.18)
      osc.stop(t + i * 0.18 + 0.15)
    }
  }

  function horn() {
    if (!ctx || !master) return
    const t = ctx.currentTime
    for (const f of [400, 500]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.04, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
      osc.connect(gain).connect(master)
      osc.start(t)
      osc.stop(t + 0.4)
    }
  }

  // Karplus-Strong: a one-period noise burst recycled through a lowpassed delay line = plucked string
  function pluck(freq: number, at = 0) {
    if (!ctx || !guitarG) return
    const t = ctx.currentTime + at
    const n = Math.max(1, Math.round(ctx.sampleRate / freq))
    const burst = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = burst.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    const s = ctx.createBufferSource()
    s.buffer = burst
    const dl = ctx.createDelay(0.05)
    dl.delayTime.value = 1 / freq
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3600
    const fb = ctx.createGain()
    fb.gain.value = 0.975
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.5, t)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.8)
    s.connect(dl)
    dl.connect(lp).connect(fb).connect(dl)
    dl.connect(env).connect(guitarG)
    s.start(t)
  }

  // soda drop into the tray of a vending machine: metallic clack over a low thunk
  function clunk() {
    if (!ctx || !master) return
    const t = ctx.currentTime
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate)
    const nd = nb.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015))
    const src = ctx.createBufferSource()
    src.buffer = nb
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1200
    const g1 = ctx.createGain()
    g1.gain.setValueAtTime(0.22, t)
    g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
    src.connect(hp).connect(g1).connect(master)
    src.start(t)
    src.stop(t + 0.1)
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(180, t)
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12)
    const g2 = ctx.createGain()
    g2.gain.setValueAtTime(0.18, t)
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
    o.connect(g2).connect(master)
    o.start(t)
    o.stop(t + 0.15)
  }

  // street food cart: a sputtering bandpassed noise burst ~2kHz, like batter hitting a hot pan
  function sizzle() {
    if (!ctx || !master) return
    const t = ctx.currentTime
    const dur = 0.8
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
    const nd = nb.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1)
    const s = ctx.createBufferSource()
    s.buffer = nb
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2000
    bp.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.12, t + 0.05)
    g.gain.setValueAtTime(0.12, t + dur - 0.15)
    g.gain.linearRampToValueAtTime(0.0001, t + dur)
    const chop = ctx.createOscillator()
    chop.type = 'square'
    chop.frequency.value = 13
    const chopAmt = ctx.createGain()
    chopAmt.gain.value = 0.05
    chop.connect(chopAmt)
    chopAmt.connect(g.gain)
    s.connect(bp).connect(g).connect(master)
    s.start(t)
    s.stop(t + dur)
    chop.start(t)
    chop.stop(t + dur)
  }

  // alley cat: a formant-ish mew — sawtooth that pitches up then down under a lowpass
  function meow() {
    if (!ctx || !master) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(640, t)
    o.frequency.linearRampToValueAtTime(920, t + 0.12)
    o.frequency.exponentialRampToValueAtTime(430, t + 0.5)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1800
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.08)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
    o.connect(lp).connect(g).connect(master)
    o.start(t)
    o.stop(t + 0.6)
  }

  // D3 rare night siren: a lowpassed wail fading in and out over ~5s
  function siren() {
    if (!ctx || !master) return
    const t = ctx.currentTime
    const dur = 5
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = 680
    const wob = ctx.createOscillator()
    wob.frequency.value = 1.4
    const wobAmt = ctx.createGain()
    wobAmt.gain.value = 130
    wob.connect(wobAmt)
    wobAmt.connect(osc.frequency)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1100
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.04, t + 1)
    g.gain.setValueAtTime(0.04, t + dur - 1.5)
    g.gain.linearRampToValueAtTime(0.0001, t + dur)
    osc.connect(lp).connect(g).connect(master)
    osc.start(t)
    osc.stop(t + dur)
    wob.start(t)
    wob.stop(t + dur)
  }

  return {
    // browsers only let us start audio from a gesture
    resume() {
      build()
      void ctx?.resume()
    },
    setDay(day: number) {
      if (!ctx || !dayG || !nightG) return
      const t = ctx.currentTime
      dayG.gain.setTargetAtTime(0.5 * day + 0.04, t, 0.5)
      nightG.gain.setTargetAtTime(0.4 * (1 - day), t, 0.5)
    },
    setVolume: set,
    setEngine(on: boolean, frac: number) {
      if (!ctx || !engOsc || !engSub || !engG) return
      const t = ctx.currentTime
      const f = 45 + clamp(frac, 0, 1) * 95
      engOsc.frequency.setTargetAtTime(f, t, 0.08)
      engSub.frequency.setTargetAtTime(f / 2, t, 0.08)
      engG.gain.setTargetAtTime(on ? 0.05 + frac * 0.06 : 0, t, on ? 0.05 : 0.3)
    },
    setSkid(level: number) {
      if (!ctx || !skidG) return
      skidG.gain.setTargetAtTime(clamp(level, 0, 1) * 0.12, ctx.currentTime, 0.05)
    },
    setBuild(ac: number, drill: number) {
      if (!ctx || !acG || !drillG) return
      const t = ctx.currentTime
      acG.gain.setTargetAtTime(0.12 * ac, t, 0.6)
      drillG.gain.setTargetAtTime(0.3 * drill, t, 0.6)
    },
    setZone(park: number, market: number, plaza: number) {
      if (!ctx || !parkG || !marketG || !plazaG) return
      const t = ctx.currentTime
      parkG.gain.setTargetAtTime(0.6 * park, t, 0.6)
      marketG.gain.setTargetAtTime(0.35 * market, t, 0.6)
      plazaG.gain.setTargetAtTime(0.5 * plaza, t, 0.6)
    },
    setBusker(level: number) {
      if (!ctx || !guitarG) return
      guitarG.gain.setTargetAtTime(clamp(level, 0, 1) * 0.5, ctx.currentTime, 0.5)
    },
    tipBusker() {
      buskerDetune *= 1.05
      for (const [i, f] of [220, 277.2, 329.6, 440].entries()) pluck(f * buskerDetune, i * 0.12)
    },
    footstep,
    distantCar,
    dogBark,
    horn,
    siren,
    clunk,
    sizzle,
    meow,
    get volume() {
      return vol
    },
    dispose() {
      void ctx?.close()
      ctx = null
    },
  }
}
