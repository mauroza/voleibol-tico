import type { ContactKind, PointReason } from '../sim/events';
import type { Simulation } from '../sim/rally';
import { settings } from '../data/profile';
import { audio } from './music';

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

  /** Golpe de pelota: "pop" de ruido filtrado más un golpe grave; más fuerte en saques y remates. */
  private hit(kind: ContactKind, quality: number): void {
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
