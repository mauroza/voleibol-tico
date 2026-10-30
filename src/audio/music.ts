import { settings } from '../data/profile';

/**
 * Música de fondo generada en vivo (sin archivos): lo-fi tranquilo a 76 bpm. Colchón de acordes suave, un piano
 * eléctrico que arpegia con eco, bajo redondo y una batería apenas presente. Nunca se repite igual y no cansa.
 * También los sonidos de la interfaz (pasar el mouse, clic, volver, sobres).
 */

const BPM = 76;
const BEAT = 60 / BPM;
/** Acordes (MIDI) de la progresión: Fmaj9 · Em7 · Dm9 · Cmaj7 / Am9 · Dm9 · Gsus · Cmaj9. */
const PROGRESSIONS = [
  [[53, 57, 60, 64, 67], [52, 55, 59, 62, 67], [50, 53, 57, 60, 64], [48, 52, 55, 59, 64]],
  [[45, 52, 55, 59, 60], [50, 53, 57, 60, 64], [43, 50, 55, 60, 62], [48, 52, 55, 59, 62]],
];
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

class AudioEngine {
  private ctx: AudioContext | null = null;
  private musicBus!: GainNode;
  private uiBus!: GainNode;
  private filter!: BiquadFilterNode;
  private echo!: DelayNode;
  private noise!: AudioBuffer;
  private playing = false;
  private nextBar = 0;
  private bar = 0;
  private timer = 0;
  /** En el partido la música baja (el público y los golpes mandan). */
  private inMatch = false;
  private lastHover = 0;
  private muted = false;

  /** Crea el audio en el primer gesto del usuario (el navegador no deja antes). */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 2400;
      this.echo = ctx.createDelay(1);
      this.echo.delayTime.value = BEAT * 0.75;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.32;
      const wet = ctx.createGain();
      wet.gain.value = 0.28;
      this.echo.connect(feedback).connect(this.echo);
      this.echo.connect(wet).connect(this.filter);
      this.filter.connect(this.musicBus).connect(ctx.destination);
      this.uiBus = ctx.createGain();
      this.uiBus.connect(ctx.destination);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      return ctx;
    } catch {
      return null;
    }
  }

  /** Llamar en cada gesto: arranca el audio si estaba bloqueado. */
  unlock(): void {
    const ctx = this.ensure();
    if (ctx?.state === 'suspended') void ctx.resume();
    if (this.playing) this.applyVolumes();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = settings();
    const music = this.muted ? 0 : s.music * (this.inMatch ? 0.45 : 1) * 0.5;
    this.musicBus.gain.setTargetAtTime(this.playing ? music : 0, this.ctx.currentTime, 0.6);
    this.uiBus.gain.setTargetAtTime(s.ui * 0.5, this.ctx.currentTime, 0.05);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  setMatch(on: boolean): void {
    this.inMatch = on;
    this.applyVolumes();
  }

  play(): void {
    const ctx = this.ensure();
    if (!ctx || this.playing) return;
    this.playing = true;
    this.nextBar = ctx.currentTime + 0.2;
    this.applyVolumes();
    const tick = () => {
      if (!this.playing || !this.ctx) return;
      // Programa con 1.5 s de anticipación: suena parejo aunque el juego tenga un cuadro pesado.
      while (this.nextBar < this.ctx.currentTime + 1.5) {
        this.scheduleBar(this.nextBar);
        this.nextBar += BEAT * 4;
        this.bar += 1;
      }
      this.timer = window.setTimeout(tick, 250);
    };
    tick();
  }

  stop(): void {
    this.playing = false;
    clearTimeout(this.timer);
    this.applyVolumes();
  }

  private scheduleBar(t: number): void {
    const ctx = this.ctx!;
    const prog = PROGRESSIONS[Math.floor(this.bar / 8) % PROGRESSIONS.length];
    const chord = prog[this.bar % 4];
    // Colchón: notas del acorde, triángulos desafinados apenas, entrada y salida lentas.
    for (const m of chord.slice(1)) {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = hz(m);
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.018, t + 1.2);
        g.gain.setValueAtTime(0.018, t + BEAT * 4 - 0.6);
        g.gain.linearRampToValueAtTime(0.0001, t + BEAT * 4 + 0.4);
        o.connect(g).connect(this.filter);
        o.start(t);
        o.stop(t + BEAT * 4 + 0.5);
      }
    }
    // Bajo: la raíz en los tiempos 1 y 3 (a veces una nota de paso).
    for (const [beat, note] of [[0, chord[0] - 12], [2, chord[0] - 12 + (Math.random() < 0.3 ? 7 : 0)]] as const) {
      this.pluck(t + beat * BEAT, hz(note), 0.07, BEAT * 1.6, 'sine', false);
    }
    // Piano eléctrico: arpegio en corcheas con huecos, al eco.
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      if (Math.random() < 0.38) continue;
      const m = chord[1 + Math.floor(Math.random() * (chord.length - 1))] + (Math.random() < 0.35 ? 12 : 0);
      const swing = i % 2 ? BEAT * 0.08 : 0;
      this.pluck(t + (i * BEAT) / 2 + swing, hz(m), 0.035 + Math.random() * 0.02, 1.1, 'sine', true);
    }
    // Batería suave: bombo en 1 y 3, aro en 2 y 4, platillo cerrado muy bajito.
    for (let b = 0; b < 4; b++) {
      const at = t + b * BEAT;
      if (b % 2 === 0) this.kick(at);
      else this.snap(at);
      for (const h of [0, 0.5]) this.hat(at + h * BEAT + (h ? BEAT * 0.06 : 0));
    }
  }

  private pluck(t: number, f: number, peak: number, len: number, type: OscillatorType, echo: boolean): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    // Un armónico suave le da el timbre de piano eléctrico.
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.filter);
    if (echo) g.connect(this.echo);
    for (const x of [o, o2]) {
      x.start(t);
      x.stop(t + len + 0.05);
    }
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.35);
  }

  private snap(t: number): void {
    this.noiseHit(t, 1800, 0.035, 0.12, 'bandpass');
  }

  private hat(t: number): void {
    this.noiseHit(t, 7000, 0.008, 0.05, 'highpass');
  }

  private noiseHit(t: number, freq: number, peak: number, len: number, type: BiquadFilterType, bus: GainNode = this.musicBus): void {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(f).connect(g).connect(bus);
    n.start(t, Math.random() * 0.5);
    n.stop(t + len + 0.02);
  }

  private blip(freq: number, len: number, peak: number, type: OscillatorType = 'sine', slide = 1): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(this.uiBus);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  /** Pasar sobre un botón: un tic muy corto (sin repetir más de 20 veces por segundo). */
  hover(): void {
    const now = performance.now();
    if (now - this.lastHover < 50) return;
    this.lastHover = now;
    this.blip(1500, 0.04, 0.05, 'sine');
  }

  click(): void {
    this.blip(660, 0.09, 0.18, 'triangle', 1.5);
  }

  back(): void {
    this.blip(520, 0.1, 0.14, 'triangle', 0.6);
  }

  /** Abrir el sobre: un barrido que sube. */
  rip(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.noiseHit(ctx.currentTime, 2500, 0.25, 0.35, 'bandpass', this.uiBus);
    this.blip(300, 0.5, 0.12, 'sawtooth', 3);
  }

  /** Cortina de la repetición: un barrido de aire que sube y baja. */
  whoosh(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(3800, t + 0.32);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    n.connect(f).connect(g).connect(this.uiBus);
    n.start(t);
    n.stop(t + 0.8);
  }

  /** Revelar una carta: más brillante cuanto más rara. */
  reveal(level: number): void {
    const notes = [[72], [72, 76], [72, 76, 79], [72, 76, 79, 84]][Math.max(0, Math.min(3, level))];
    notes.forEach((m, i) => setTimeout(() => this.blip(hz(m), 0.5, 0.14, 'triangle'), i * 90));
  }
}

export const audio = new AudioEngine();
