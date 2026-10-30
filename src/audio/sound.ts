import type { ContactKind, PointReason } from '../sim/events';
import type { Simulation } from '../sim/rally';
import { settings } from '../data/profile';
import { audio } from './music';
import { SAMPLES } from './samples';

/**
 * Sonido procedural con WebAudio (sin archivos): golpes, silbato, ambiente del público, ovación,
 * corneta y bombo. Crear dentro de un gesto del usuario (clic en "Jugar") para que el navegador permita el audio.
 */
export class Sound {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly crowdGain: GainNode;
  private readonly noise: AudioBuffer;
  private excitement = 0.2;
  private muted = false;
  /** Golpes grabados ya decodificados (si no están listos, se usa el sintetizado). */
  private readonly samples = new Map<string, AudioBuffer>();
  /** Remate al que ya le sonaron las tenis de la carrera. */
  private squeakedFor: unknown = null;

  constructor(private readonly sim: Simulation) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7 * settings().sfx;
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise();
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    this.crowdGain.connect(this.master);
    this.startCrowd();
    this.listen();
    this.loadSamples();
  }

  private loadSamples(): void {
    for (const [name, b64] of Object.entries(SAMPLES)) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.ctx.decodeAudioData(bytes.buffer).then((buf) => this.samples.set(name, buf)).catch(() => undefined);
    }
  }

  /** Reproduce un golpe grabado; `rate` cambia el tono (y la duración) apenas, para que no suenen todos iguales. */
  private playSample(name: string, gain: number, rate: number): boolean {
    const buf = this.samples.get(name);
    if (!buf) return false;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(this.master);
    s.start(t);
    return true;
  }

  /** Tras una recarga (revancha) no hubo gesto del usuario: el contexto arranca suspendido hasta la primera tecla o clic. */
  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7 * settings().sfx, this.ctx.currentTime, 0.05);
    audio.setMuted(this.muted);
    return this.muted;
  }

  /** Llamar cada cuadro: la emoción del público baja sola y controla el volumen del ambiente. */
  update(dtReal: number): void {
    // Carrera de remate: las tenis rechinan en los últimos pasos antes del salto.
    const up = this.sim.upcoming;
    if (up?.kind === 'attack' && up !== this.squeakedFor && up.time - this.sim.time < 0.75) {
      this.squeakedFor = up;
      // Pasos de la carrera (los grabados): cada vez más seguidos y fuertes, el último es el freno antes del salto.
      const steps = this.sim.timeScale < 0.5 ? 2 : 3;
      let at = 0;
      for (let i = 0; i < steps; i++) {
        const level = i === steps - 1 ? 1 : 0.6 + i * 0.15;
        if (!this.playStep(at, level)) this.squeak(at, level);
        at += 0.22 - i * 0.04 + Math.random() * 0.03;
      }
    }
    this.excitement = Math.max(0.15, this.excitement - dtReal * 0.3);
    this.crowdGain.gain.setTargetAtTime(0.03 + this.excitement * 0.12, this.ctx.currentTime, 0.2);
  }

  private listen(): void {
    this.sim.bus.on((e) => {
      if (e.type === 'contact') this.hit(e.kind, e.quality);
      else if (e.type === 'point') this.point(e.reason);
      else if (e.type === 'setEnd' || e.type === 'matchEnd') this.whistle(e.type === 'matchEnd' ? 3 : 2);
    });
  }

  private point(reason: PointReason): void {
    this.whistle(1);
    const big = reason === 'ace' || reason === 'kill' || reason === 'blockKill' || reason === 'blockOut';
    this.excitement = big ? 1 : 0.6;
    this.cheer(big ? 1 : 0.5);
    if (big) {
      this.horn();
      this.drums(4);
    } else {
      this.drums(2);
    }
  }

  // ---------- síntesis ----------

  private makeNoise(): AudioBuffer {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private noiseSource(loop = false): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  private envelope(gain: GainNode, t: number, peak: number, attack: number, release: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  /**
   * Golpe de pelota con los sonidos grabados: el remate con el golpe seco (más fuerte cuanto mejor el remate), el resto
   * con el de contacto (el saque fuerte; pase y colocación más suaves y un poco más agudos). Si aún no cargaron, el
   * sintetizado.
   */
  private hit(kind: ContactKind, quality: number): void {
    const played = kind === 'attack'
      ? this.playSample('spike', 0.75 + quality * 0.35, 1)
      : kind === 'serve'
        ? this.playSample('contact', 0.9, 1) && this.playSample('spike', 0.35, 1.05)
        : kind === 'block'
          ? this.playSample('spike', 0.7, 0.92)
          : this.playSample('contact', kind === 'set' ? 0.45 : 0.6, kind === 'set' ? 1.12 : 1.04);
    if (played) return;
    const t = this.ctx.currentTime;
    const strong = kind === 'attack' || kind === 'serve';
    const n = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = strong ? 1400 : kind === 'set' ? 2600 : 1900;
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    this.envelope(g, t, strong ? 0.9 * (0.6 + quality * 0.4) : 0.45, 0.003, strong ? 0.12 : 0.07);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.2);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(strong ? 140 : 220, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const og = this.ctx.createGain();
    this.envelope(og, t, strong ? 0.6 : 0.25, 0.002, 0.12);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  /** Pisada grabada (una de cuatro al azar) dentro de `delay` s; false si todavía no cargaron. */
  private playStep(delay: number, level: number): boolean {
    const name = `step${1 + Math.floor(Math.random() * 4)}`;
    const buf = this.samples.get(name);
    if (!buf) return false;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = 0.95 + Math.random() * 0.1;
    const g = this.ctx.createGain();
    g.gain.value = 0.55 * level;
    s.connect(g).connect(this.master);
    s.start(this.ctx.currentTime + delay);
    return true;
  }

  /**
   * Rechinido de tenis en el piso de madera: un chirrido agudo que sube y baja rápido, con algo de fricción.
   * `delay` en segundos reales; `level` 0..1.
   */
  private squeak(delay: number, level: number): void {
    const t = this.ctx.currentTime + delay;
    const len = 0.07 + Math.random() * 0.06;
    const f0 = 1700 + Math.random() * 900;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (1.15 + Math.random() * 0.2), t + len * 0.4);
    o.frequency.linearRampToValueAtTime(f0 * 0.85, t + len);
    // Vibrato rápido: el "tartamudeo" de la suela al frenar.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 55 + Math.random() * 30;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = f0 * 0.05;
    lfo.connect(lfoGain).connect(o.frequency);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f0 * 1.1;
    bp.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11 * level, t + 0.012);
    g.gain.setValueAtTime(0.11 * level, t + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(bp).connect(g).connect(this.master);
    // Fricción: un poco de ruido agudo junto con el chirrido.
    const n = this.noiseSource();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const ng = this.ctx.createGain();
    this.envelope(ng, t, 0.03 * level, 0.005, len);
    n.connect(hp).connect(ng).connect(this.master);
    for (const x of [o, lfo]) {
      x.start(t);
      x.stop(t + len + 0.02);
    }
    n.start(t, Math.random());
    n.stop(t + len + 0.02);
  }

  /** Silbato del árbitro: dos tonos agudos con vibrato. `blasts` pitazos. */
  private whistle(blasts: number): void {
    for (let i = 0; i < blasts; i++) {
      const t = this.ctx.currentTime + i * 0.32;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 28;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 60;
      lfo.connect(lfoGain);
      const g = this.ctx.createGain();
      this.envelope(g, t, 0.18, 0.01, i === blasts - 1 ? 0.35 : 0.22);
      for (const f of [2800, 3150]) {
        const o = this.ctx.createOscillator();
        o.frequency.value = f;
        lfoGain.connect(o.frequency);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.45);
      }
      g.connect(this.master);
      lfo.start(t);
      lfo.stop(t + 0.45);
    }
  }

  /** Ambiente continuo del público: ruido rosado aproximado con filtro paso bajo. */
  private startCrowd(): void {
    const n = this.noiseSource(true);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 450;
    bp.gain.value = 8;
    n.connect(lp).connect(bp).connect(this.crowdGain);
    n.start();
  }

  /** Ovación: subida y bajada de ruido de público. */
  private cheer(strength: number): void {
    const t = this.ctx.currentTime;
    const n = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * strength, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 2);
  }

  /** Corneta de estadio: diente de sierra con subida de tono. */
  private horn(): void {
    const t = this.ctx.currentTime + 0.15;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(290, t);
    o.frequency.linearRampToValueAtTime(400, t + 0.12);
    o.frequency.setValueAtTime(400, t + 0.6);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = this.ctx.createGain();
    this.envelope(g, t, 0.12, 0.05, 0.75);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.9);
  }

  /** Bombo: golpes graves con caída rápida de tono, en ritmo. */
  private drums(beats: number): void {
    for (let i = 0; i < beats; i++) {
      const t = this.ctx.currentTime + 0.1 + i * 0.22;
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
      const g = this.ctx.createGain();
      this.envelope(g, t, i % 2 === 0 ? 0.7 : 0.45, 0.003, 0.25);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.3);
    }
  }
}
