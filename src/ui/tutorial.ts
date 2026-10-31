import { audio } from '../audio/music';
import { keyName, loadProfile, type Action } from '../data/profile';
import { icon } from './crest';
import { IS_TOUCH } from './touch';

/**
 * Tutorial de entrada: una lámina por mecánica (controles, saque, recepción, colocación, remate, bloqueo, defensa y la
 * banca), cada una con su dibujo animado de la cancha vista desde arriba y los controles de este aparato (teclado y
 * mouse, o pantalla táctil). Sale solo la primera vez; después queda en el menú. Al final se puede jugar un partido de
 * práctica contra la IA fácil.
 */

interface Step {
  tag: string;
  title: string;
  /** Párrafos (HTML ya escapado: solo texto nuestro y teclas). */
  text: string[];
  /** Dibujo animado (SVG). */
  art: string;
}

/** Cancha vista desde arriba (tu campo abajo, el rival arriba), 200×140; `inner` va encima. */
const court = (inner: string): string => `<svg viewBox="0 0 200 140" class="tut-svg" aria-hidden="true">
  <rect x="20" y="6" width="160" height="128" rx="3" class="tut-floor"/>
  <rect x="20" y="6" width="160" height="128" rx="3" class="tut-lines"/>
  <path d="M20 48.7H180M20 91.3H180" class="tut-lines thin"/>
  <rect x="14" y="68.5" width="172" height="3" class="tut-net"/>
  <text x="100" y="20" class="tut-side">RIVAL</text>
  <text x="100" y="128" class="tut-side">TU CANCHA</text>
  ${inner}
</svg>`;

const player = (x: number, y: number, cls = 'mine', label = '') =>
  `<g class="tut-p ${cls}" transform="translate(${x} ${y})"><g class="tut-body"><circle r="6"/>${label ? `<text y="3">${label}</text>` : ''}</g></g>`;

/** Barra de timing o de fuerza (debajo del dibujo). */
const meter = (zones: { from: number; to: number; cls: string; label?: string }[], extra = '') => `<div class="tut-meter">
  ${zones.map((z) => `<span class="${z.cls}" style="left:${z.from}%;width:${z.to - z.from}%">${z.label ?? ''}</span>`).join('')}
  <i class="tut-needle ${extra}"></i></div>`;

function steps(): Step[] {
  const keys = loadProfile().settings.keys;
  const k = (a: Action) => `<kbd>${keyName(keys[a])}</kbd>`;
  const hit = IS_TOUCH ? 'el <b>botón grande de la derecha</b>' : `${k('hit')} o el clic`;
  const aim = IS_TOUCH ? 'arrastra el dedo en la <b>mitad izquierda</b> de la pantalla' : `mueve el mouse (o ${k('up')} ${k('left')} ${k('down')} ${k('right')})`;
  return [
    {
      tag: 'Bienvenida',
      title: 'Tú decides cada jugada',
      text: [
        'Juegas con los seis de tu equipo. Cuando la pelota viene a uno de tus jugadores, <b>el tiempo se pone lento</b> y te toca a ti: apuntas y golpeas en el momento justo.',
        'Cuanto mejor el momento del golpe, mejor sale la jugada. Este tutorial te muestra todo en un minuto.',
      ],
      art: court(`${player(60, 105)}${player(100, 112)}${player(140, 105)}${player(60, 80)}${player(100, 78, 'mine me', 'TÚ')}${player(140, 80)}
        ${player(60, 32, 'rival')}${player(100, 28, 'rival')}${player(140, 32, 'rival')}${player(60, 58, 'rival')}${player(100, 60, 'rival')}${player(140, 58, 'rival')}
        <circle class="tut-ball bounce" cx="100" cy="66" r="4"/><circle class="tut-ring" cx="100" cy="78" r="11"/>`),
    },
    {
      tag: 'Controles',
      title: IS_TOUCH ? 'Dedo izquierdo apunta, derecho golpea' : 'Apunta con el mouse, golpea con espacio',
      text: IS_TOUCH
        ? [
            'La <b>mitad izquierda</b> de la pantalla es para apuntar: arrastra el dedo y la mira se mueve (despacio, para que sea preciso).',
            'La <b>mitad derecha</b> es un botón grande transparente: tócala para golpear, saltar o sacar.',
            'La sensibilidad se cambia en Ajustes o en la pausa.',
          ]
        : [
            `Para apuntar, ${aim}. Para golpear, saltar o sacar: ${k('hit')} o clic.`,
            `${k('pause')} pausa (ahí también cambias la sensibilidad) · ${k('timeout')} tiempo y cambios · ${k('challenge')} challenge · ${k('chat')} chat en online.`,
            'Todas las teclas se cambian en Ajustes → Controles.',
          ],
      art: IS_TOUCH
        ? `<svg viewBox="0 0 200 120" class="tut-svg" aria-hidden="true"><rect x="10" y="8" width="180" height="104" rx="12" class="tut-phone"/>
            <rect x="16" y="14" width="82" height="92" rx="6" class="tut-zone aim"/><rect x="102" y="14" width="82" height="92" rx="6" class="tut-zone hit"/>
            <text x="57" y="100" class="tut-zone-t">APUNTAR</text><text x="143" y="100" class="tut-zone-t">GOLPEAR</text>
            <circle class="tut-finger drag" cx="50" cy="56" r="7"/><circle class="tut-finger tap" cx="143" cy="56" r="7"/></svg>`
        : `<svg viewBox="0 0 200 120" class="tut-svg" aria-hidden="true"><rect x="30" y="20" width="44" height="70" rx="22" class="tut-mouse"/><path d="M52 20V46M30 46H74" class="tut-lines thin"/>
            <path class="tut-arrow drag" d="M52 104 l-8 -6 m8 6 l8 -6"/><rect x="100" y="56" width="80" height="20" rx="5" class="tut-key press"/><text x="140" y="70" class="tut-zone-t">ESPACIO</text>
            <text x="52" y="116" class="tut-zone-t">APUNTAR</text><text x="140" y="96" class="tut-zone-t">GOLPEAR</text></svg>`,
    },
    {
      tag: 'Saque',
      title: 'La barra es la fuerza',
      text: [
        `Apunta a dónde quieres sacar en la cancha rival y presiona ${hit}. La barra sube sola: donde la pares es la fuerza.`,
        '<span class="c-green">Verde</span>: seguro y suave. <span class="c-yellow">Amarillo</span>: flotado. <span class="c-red">Rojo</span>: potente pero arriesgado. La puntita <span class="c-purple">morada</span> es un <b>ace</b>: va justo donde apuntaste. Después de <b>2 aces seguidos</b> el morado cambia de lugar y se achica: el tercero cuesta mucho más.',
        'Si el saque no pasa la red, es punto del rival.',
      ],
      art: `${court(`${player(100, 140 - 4, 'mine me', 'TÚ')}<path class="tut-traj" d="M100 132 Q100 60 132 30"/><g class="tut-aim" transform="translate(132 30)"><circle r="7"/><path d="M-11 0H-4M4 0H11M0 -11V-4M0 4V11"/></g>`)}
        ${meter([{ from: 0, to: 45, cls: 'green' }, { from: 45, to: 72, cls: 'yellow' }, { from: 72, to: 94, cls: 'red' }, { from: 94, to: 100, cls: 'purple' }], 'sweep')}`,
    },
    {
      tag: 'Recepción',
      title: 'Golpea cuando pase por la zona verde',
      text: [
        `Cuando te sacan, ${aim} para elegir a dónde mandar la pelota (lo ideal: al colocador, cerca de la red) y presiona ${hit} cuando la marca pase por la <span class="c-green">zona verde</span>. La zona cambia de lugar cada vez.`,
        '<b>Perfecta = doble positiva</b>: tu colocador puede jugar bolas rápidas. Si recibes mal, solo te quedan las altas.',
      ],
      art: `${court(`<path class="tut-traj" d="M100 14 Q120 60 70 104"/>${player(70, 106, 'mine me', 'TÚ')}<path class="tut-traj pass" d="M70 104 Q90 70 118 82"/>${player(120, 84, 'mine', 'C')}<circle class="tut-ring" cx="118" cy="82" r="9"/>`)}
        ${meter([{ from: 0, to: 30, cls: 'red' }, { from: 30, to: 52, cls: 'yellow' }, { from: 52, to: 64, cls: 'green', label: 'PERFECTA' }, { from: 64, to: 82, cls: 'yellow' }, { from: 82, to: 100, cls: 'red' }], 'sweep')}`,
    },
    {
      tag: 'Colocación',
      title: 'Elige al atacante y el tempo',
      text: [
        `Cada aro es un atacante: punta (zona 4), central (3), opuesto (2) y, detrás de la línea de 3 m, los zagueros. ${IS_TOUCH ? 'Arrastra' : 'Mueve'} la mira al aro que quieras.`,
        'Pegada a la red, el remate baja más; <b>despegada, abre el ángulo</b>.',
        'La barra es el tempo: <span class="c-green">alta (3)</span>, <span class="c-yellow">media (2)</span>, <span class="c-red">rápida (1)</span>. Con una rápida el rival llega con menos bloqueadores.',
      ],
      art: `${court(`${player(120, 80, 'mine me', 'C')}<circle class="tut-hoop" cx="40" cy="78" r="8"/><circle class="tut-hoop on" cx="100" cy="76" r="8"/><circle class="tut-hoop" cx="160" cy="78" r="8"/><circle class="tut-hoop" cx="100" cy="102" r="8"/>
        <text x="40" y="94" class="tut-mini">4</text><text x="100" y="92" class="tut-mini">3</text><text x="160" y="94" class="tut-mini">2</text><text x="100" y="118" class="tut-mini">PIPE</text>
        <path class="tut-traj pass" d="M120 80 Q110 60 100 76"/>`)}
        ${meter([{ from: 0, to: 40, cls: 'green', label: 'ALTA 3' }, { from: 40, to: 72, cls: 'yellow', label: 'MEDIA 2' }, { from: 72, to: 100, cls: 'red', label: 'RÁPIDA 1' }], 'sweep')}`,
    },
    {
      tag: 'Remate',
      title: 'Apunta fuera de la sombra del bloqueo',
      text: [
        `La <span class="c-red">sombra roja</span> en la cancha rival es lo que tapa el bloqueo: si apuntas ahí, te bloquean. ${IS_TOUCH ? 'Arrastra' : 'Mueve'} la mira a un hueco (la línea o la diagonal) y presiona ${hit}.`,
        'La barra es la fuerza. Cerca de la red, en verde, sale una <b>finta</b> suave que pasa por encima del bloqueo.',
      ],
      art: court(`${player(48, 78, 'mine me', 'TÚ')}<path class="tut-shade" d="M38 66 L62 66 L84 6 L30 6 Z"/>${player(44, 62, 'rival')}${player(56, 62, 'rival')}
        <path class="tut-traj hit" d="M48 74 L140 24"/><g class="tut-aim" transform="translate(140 24)"><circle r="7"/><path d="M-11 0H-4M4 0H11M0 -11V-4M0 4V11"/></g>`),
    },
    {
      tag: 'Bloqueo',
      title: 'Salta justo antes del remate',
      text: [
        `Cuando el rival va a rematar, presiona ${hit} para saltar <b>un poquito antes</b> de que le pegue: arriba justo cuando la pelota cruza la red. Si saltas tarde o muy temprano, pasa.`,
        '<b>Cobertura</b>: cuando rematas y te bloquean, tus compañeros se agachan alrededor del rematador. Si la pelota rebota en el bloqueo y cae cerca, la levantan y la jugada sigue.',
        'Entre puntos, el botón <b>Estrategia</b> te deja planear el bloqueo: <b>cerrar la línea</b> o <b>cerrar la diagonal</b>.',
      ],
      art: `${court(`${player(140, 52, 'rival', 'R')}${player(60, 30, 'rival')}${player(100, 38, 'rival')}<path class="tut-traj hit" d="M140 52 L140 64"/>
        <path class="tut-block" d="M126 70H154"/>${player(132, 77, 'mine me jump', 'TÚ')}${player(148, 77, 'mine jump')}<circle class="tut-ball bounce" cx="140" cy="62" r="3.5"/>`)}
        ${meter([{ from: 0, to: 55, cls: 'red', label: 'TEMPRANO' }, { from: 55, to: 72, cls: 'green', label: 'SALTA' }, { from: 72, to: 100, cls: 'red', label: 'TARDE' }], 'sweep')}`,
    },
    {
      tag: 'Defensa',
      title: 'Adivina a dónde va el remate',
      text: [
        `Si no bloqueas, mueve la <span class="c-blue">marca de defensa</span> a donde crees que va a caer el remate: tus defensores se paran ahí. Cuando la pelota llega, golpea en la zona verde como en la recepción.`,
        'Una buena defensa vuelve a darte un contraataque.',
      ],
      art: court(`${player(150, 58, 'rival', 'R')}<path class="tut-traj hit" d="M150 58 L70 112"/><circle class="tut-defend" cx="70" cy="112" r="12"/>${player(76, 108, 'mine me', 'TÚ')}${player(40, 100)}${player(120, 104)}`),
    },
    {
      tag: 'Banca',
      title: 'Challenge, tiempos y cambios',
      text: [
        `<b>Challenge</b>: si el árbitro canta mal una pelota cerca de la línea, aparece el aviso${IS_TOUCH ? '' : ` (${k('challenge')})`}. La cámara baja a la marca blanca del pique y se ve si fue dentro o fuera.`,
        `<b>Tiempo</b>${IS_TOUCH ? '' : ` (${k('timeout')})`}: entre puntos. Ahí haces cambios: la barra de cada jugador es su estamina; los cansados rinden menos.`,
        '<b>Sobres</b>: cada victoria te da uno con una figura de la VNL para tu plantilla en Mi club.',
      ],
      art: court(`<circle class="tut-mark" cx="179" cy="40" r="5"/><path class="tut-zoom" d="M179 40m-16 0a16 16 0 1 0 32 0a16 16 0 1 0 -32 0"/><text x="150" y="62" class="tut-mini">¿DENTRO?</text>`),
    },
  ];
}

/** Pantalla del tutorial. `onDone` al terminar o saltarlo; `onPractice` para jugar el partido de práctica. */
export function tutorialView(onDone: () => void, onPractice: () => void): HTMLElement {
  const list = steps();
  let i = 0;
  const el = document.createElement('section');
  el.className = 'am-tutorial';
  const render = () => {
    const s = list[i];
    const last = i === list.length - 1;
    el.innerHTML = `
      <div class="tut-top"><span class="tut-tag">${s.tag}</span><span class="tut-count">${i + 1} / ${list.length}</span></div>
      <div class="am-panel tut-card">
        <div class="tut-art">${s.art}</div>
        <div class="tut-text"><h2>${s.title}</h2>${s.text.map((t) => `<p>${t}</p>`).join('')}</div>
      </div>
      <div class="tut-dots">${list.map((_, j) => `<button type="button" class="${j === i ? 'on' : ''}" aria-label="Paso ${j + 1}" data-step="${j}"></button>`).join('')}</div>
      <div class="tut-nav"></div>`;
    const nav = el.querySelector('.tut-nav')!;
    const btn = (cls: string, html: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.innerHTML = html;
      b.addEventListener('pointerenter', () => audio.hover());
      b.addEventListener('click', () => {
        audio.unlock();
        audio.click();
        fn();
      });
      nav.append(b);
      return b;
    };
    if (i > 0) btn('am-ghost', `${icon('back', 18)} Atrás`, () => { i--; render(); });
    else btn('am-ghost', 'Saltar tutorial', onDone);
    if (last) {
      btn('am-ghost', 'Ir al menú', onDone);
      btn('am-cta', `Partido de práctica ${icon('play', 18)}`, onPractice);
    } else btn('am-cta', `Siguiente ${icon('play', 18)}`, () => { i++; render(); });
    el.querySelectorAll<HTMLButtonElement>('.tut-dots button').forEach((b) => b.addEventListener('click', () => {
      i = Number(b.dataset.step);
      audio.hover();
      render();
    }));
  };
  const onKey = (e: KeyboardEvent) => {
    if (!el.isConnected) return window.removeEventListener('keydown', onKey);
    if (e.key === 'ArrowRight' && i < list.length - 1) { i++; render(); }
    if (e.key === 'ArrowLeft' && i > 0) { i--; render(); }
  };
  window.addEventListener('keydown', onKey);
  render();
  return el;
}
