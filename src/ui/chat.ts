import { isKey, settings, typingIn } from '../data/profile';
import type { Transport } from '../net/transport';
import { audio } from '../audio/music';
import { icon } from './crest';

/** Frases rápidas (para el teléfono, sin teclado). */
const QUICK = ['¡Buena!', '¡Qué remate!', 'Uff, casi', 'Jaja', 'Buen partido', '¡Pura vida!'];
const MAX = 120;

/**
 * Chat del online: ENTER abre la caja de texto (mientras escribes, las teclas no mueven la mira ni golpean),
 * ENTER manda y ESC cierra. Los mensajes se ven unos segundos sobre la cancha; el historial queda en el panel.
 */
export class Chat {
  private readonly el = document.createElement('div');
  private readonly log = document.createElement('div');
  private readonly form = document.createElement('form');
  private readonly input = document.createElement('input');
  private readonly quick = document.createElement('div');
  private readonly toggle = document.createElement('button');
  private open = false;

  constructor(root: HTMLElement, private readonly net: Transport, private readonly me: string, private readonly rival: string, private readonly myColor: string, private readonly rivalColor: string) {
    this.el.className = 'chat';
    this.log.className = 'chat-log';
    this.form.className = 'chat-form';
    this.input.maxLength = MAX;
    this.input.placeholder = 'Escribe y presiona ENTER…';
    this.input.autocomplete = 'off';
    this.input.enterKeyHint = 'send';
    const send = document.createElement('button');
    send.type = 'submit';
    send.innerHTML = icon('send', 18);
    send.title = 'Enviar';
    this.form.append(this.input, send);
    this.quick.className = 'chat-quick';
    for (const q of QUICK) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = q;
      b.addEventListener('click', () => this.send(q));
      this.quick.append(b);
    }
    this.toggle.className = 'chat-toggle';
    this.toggle.innerHTML = icon('chat', 20);
    this.toggle.title = 'Chat';
    this.toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setOpen(!this.open);
    });
    this.el.append(this.log, this.form, this.quick);
    root.append(this.el, this.toggle);
    this.el.hidden = !settings().chat;
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send(this.input.value);
      this.input.value = '';
      this.setOpen(false);
    });
    // Que los clics en el chat no golpeen ni salten la repetición.
    for (const ev of ['pointerdown', 'click'] as const) this.el.addEventListener(ev, (e) => e.stopPropagation());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.setOpen(false);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.open && !typingIn(e) && isKey(e, 'chat')) {
        e.preventDefault();
        this.setOpen(true);
      }
    });
    net.onMessage((m) => {
      if (m.t !== 'chat' || typeof m.text !== 'string') return;
      this.add(this.rival, m.text.slice(0, MAX), this.rivalColor);
      audio.hover();
    });
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.el.classList.toggle('open', open);
    if (open) setTimeout(() => this.input.focus(), 0);
    else this.input.blur();
  }

  private send(text: string): void {
    const t = text.trim().slice(0, MAX);
    if (!t) return;
    this.net.send({ t: 'chat', text: t });
    this.add(this.me, t, this.myColor);
    this.setOpen(false);
  }

  private add(who: string, text: string, color: string): void {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const name = document.createElement('b');
    name.textContent = who;
    name.style.color = color;
    const msg = document.createElement('span');
    msg.textContent = text;
    line.append(name, msg);
    this.log.append(line);
    while (this.log.children.length > 30) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
    // Los mensajes se desvanecen solos cuando el chat está cerrado.
    setTimeout(() => line.classList.add('old'), 8000);
  }
}
