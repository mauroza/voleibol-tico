/** Líneas de velocidad anime: rayas radiales desde los bordes hacia el centro, sobre un canvas transparente. */
export class SpeedLines {
  private readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d')!;
  private burst = 0;

  constructor(root: HTMLElement) {
    this.canvas.className = 'speedlines';
    root.append(this.canvas);
  }

  /** Golpe de líneas intenso que se apaga solo (remates, tapas). */
  flash(strength = 1): void {
    this.burst = Math.max(this.burst, strength);
  }

  /** `base`: intensidad sostenida (p. ej. durante la cámara lenta). */
  update(dtReal: number, base: number): void {
    this.burst = Math.max(0, this.burst - dtReal * 2.2);
    const intensity = Math.max(base, this.burst);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.g.clearRect(0, 0, w, h);
    if (intensity < 0.02) return;
    const cx = w / 2;
    const cy = h / 2;
    const outer = Math.hypot(cx, cy);
    this.g.fillStyle = `rgba(255, 255, 255, ${0.55 * intensity})`;
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const inner = outer * (0.55 + Math.random() * 0.3 - intensity * 0.12);
      const spread = 0.004 + Math.random() * 0.01;
      this.g.beginPath();
      this.g.moveTo(cx + Math.cos(a - spread) * outer, cy + Math.sin(a - spread) * outer);
      this.g.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      this.g.lineTo(cx + Math.cos(a + spread) * outer, cy + Math.sin(a + spread) * outer);
      this.g.fill();
    }
  }
}
