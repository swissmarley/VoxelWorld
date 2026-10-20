// Procedural audio — no sample files. Engine drone with fake gears, tire squeal, wind,
// crunches, prop smashes, a wreck boom, horn, door thunks. Starts on the first gesture.
import { clamp, damp } from '../util/math.js';

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.enabled = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    this.engineLevel = 0;
    this.rpm = 0;
  }

  /** Create the graph on a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx || !this.enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch (e) { this.enabled = false; return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    // noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // engine: saw + sub square → lowpass → gain
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 500; this.engFilter.Q.value = 1.2;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth'; this.osc1.frequency.value = 60;
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square'; this.osc2.frequency.value = 30;
    const g2 = ctx.createGain(); g2.gain.value = 0.45;
    this.osc1.connect(this.engFilter); this.osc2.connect(g2); g2.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.osc1.start(); this.osc2.start();

    // skid: noise → bandpass → gain
    this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
    const sk = ctx.createBiquadFilter(); sk.type = 'bandpass'; sk.frequency.value = 1900; sk.Q.value = 2.5;
    const skSrc = ctx.createBufferSource(); skSrc.buffer = buf; skSrc.loop = true; skSrc.connect(sk); sk.connect(this.skidGain); this.skidGain.connect(this.master); skSrc.start();
    // wind: noise → lowpass → gain
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 400;
    const wSrc = ctx.createBufferSource(); wSrc.buffer = buf; wSrc.loop = true; wSrc.connect(wf); wf.connect(this.windGain); this.windGain.connect(this.master); wSrc.start();
    // horn
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
    for (const f of [440, 554]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.12; o.connect(g); g.connect(this.hornGain); o.start(); }
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1800;
    this.hornGain.connect(hf); hf.connect(this.master);
    // fire crackle for wrecks
    this.fireGain = ctx.createGain(); this.fireGain.gain.value = 0;
    const ff = ctx.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 700; ff.Q.value = 0.7;
    const fSrc = ctx.createBufferSource(); fSrc.buffer = buf; fSrc.loop = true; fSrc.connect(ff); ff.connect(this.fireGain); this.fireGain.connect(this.master); fSrc.start();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  _noise(duration, filterType, freq, q, gain, attack = 0.005) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + duration + 0.05);
  }
  _tone(freq, endFreq, duration, gain, type = 'sine') {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + duration + 0.05);
  }

  crash(strength) {            // strength 0..1
    if (!this.ctx) return;
    const s = clamp(strength, 0.05, 1);
    this._noise(0.18 + s * 0.3, 'lowpass', 900 + s * 1800, 0.8, 0.5 * s + 0.08, 0.004);
    this._tone(90 + s * 40, 35, 0.25 + s * 0.3, 0.5 * s + 0.1);
    if (s > 0.3) this._noise(0.4, 'highpass', 3000, 0.5, 0.2 * s, 0.01); // glass
  }
  smash(mass) {
    if (!this.ctx) return;
    const s = clamp(mass / 180, 0.2, 1);
    this._noise(0.12 + s * 0.1, 'bandpass', 1400, 1.0, 0.25 + s * 0.2);
    this._tone(700 + (1 - s) * 500, 200, 0.12, 0.12, 'triangle');
  }
  wreck() {
    if (!this.ctx) return;
    this._noise(1.4, 'lowpass', 220, 0.5, 0.9, 0.01);
    this._noise(0.5, 'lowpass', 1200, 0.8, 0.5, 0.005);
    this._tone(50, 25, 1.2, 0.9);
  }
  enterCar() { if (!this.ctx) return; this._tone(160, 90, 0.08, 0.3, 'triangle'); this._noise(0.3, 'lowpass', 500, 0.5, 0.25, 0.02); }
  exitCar() { if (!this.ctx) return; this._tone(140, 70, 0.1, 0.35, 'triangle'); }
  click() { if (!this.ctx) return; this._tone(900, 600, 0.05, 0.15, 'square'); }
  knock() { if (!this.ctx) return; this._noise(0.15, 'lowpass', 600, 0.6, 0.3); this._tone(120, 60, 0.15, 0.3); }

  /** Continuous layers. state: {inCar, speed, top, throttle, slip, horn, fireNear} */
  update(dt, st) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // engine
    let target = 0, freq = 60, cutoff = 400;
    if (st.inCar && st.engineOn) {
      const norm = clamp(st.speed / Math.max(1, st.top), 0, 1);
      const gears = 4;
      let g = Math.min(gears - 1, Math.floor(norm * gears));
      let frac = norm * gears - g;
      if (norm >= 1) frac = 1;
      this.rpm = damp(this.rpm, 0.2 + frac * 0.8 + st.throttle * 0.15, 8, dt);
      freq = 55 + this.rpm * 110 + g * 6;
      target = 0.1 + this.rpm * 0.18 + st.throttle * 0.1;
      cutoff = 350 + this.rpm * 900;
    } else this.rpm = damp(this.rpm, 0, 4, dt);
    this.engineLevel = damp(this.engineLevel, target, 6, dt);
    this.engGain.gain.setTargetAtTime(this.engineLevel, t, 0.03);
    this.osc1.frequency.setTargetAtTime(freq, t, 0.03);
    this.osc2.frequency.setTargetAtTime(freq / 2, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(cutoff, t, 0.05);
    // skid
    const skid = st.inCar ? clamp((st.slip - 2.5) / 6, 0, 1) * (st.speed > 2 ? 1 : 0) : 0;
    this.skidGain.gain.setTargetAtTime(skid * 0.35, t, 0.04);
    // wind
    const wind = st.inCar ? clamp((st.speed - 12) / 40, 0, 1) : 0;
    this.windGain.gain.setTargetAtTime(wind * wind * 0.35, t, 0.1);
    // horn
    this.hornGain.gain.setTargetAtTime(st.horn ? 0.6 : 0, t, 0.02);
    // fire crackle
    this.fireGain.gain.setTargetAtTime(clamp(st.fireNear, 0, 1) * 0.18, t, 0.2);
  }
}
