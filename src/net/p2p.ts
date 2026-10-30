import type { NetMessage, Transport } from './transport';

/**
 * Conexión directa entre los dos jugadores (WebRTC): los mensajes van de computadora a computadora, sin pasar por el
 * servidor. Mucho menos ping y sin el límite de mensajes por segundo del servidor (lo que dejaba el juego "pegado").
 * El servidor de la sala se usa solo para presentarse (ofrecimiento, respuesta y rutas de red). Si la conexión directa
 * no se logra (algunas redes la bloquean), todo sigue por el servidor como antes, sin que el jugador haga nada.
 */

/** Servidores públicos que solo le dicen a cada computadora cuál es su dirección en internet. */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/**
 * Mensajes que se mandan seguido y se reemplazan solos (jugadas con su horizonte, ping, huellas): van por un canal
 * sin reintentos ni orden (llegan apenas pueden; si uno se pierde, el siguiente trae lo mismo). El resto (chat, etc.),
 * por un canal confiable.
 */
const LOSSY = new Set(['in', 'p', 'q', 'np', 'hash']);

export type LinkState = 'connecting' | 'direct' | 'relay';

export interface DirectTransport extends Transport {
  /** Cómo van los mensajes ahora mismo. */
  readonly state: LinkState;
}

export function withDirectLink(base: Transport, initiator: boolean): DirectTransport {
  const handlers: ((msg: NetMessage) => void)[] = [];
  let fast: RTCDataChannel | null = null;
  let reliable: RTCDataChannel | null = null;
  let state: LinkState = 'connecting';
  let pc: RTCPeerConnection | null = null;
  const pendingIce: RTCIceCandidateInit[] = [];
  let remoteSet = false;

  const deliver = (msg: NetMessage) => {
    for (const h of handlers) h(msg);
  };
  const open = () => fast?.readyState === 'open' && reliable?.readyState === 'open';
  const refresh = () => {
    state = open() ? 'direct' : state === 'connecting' ? 'connecting' : 'relay';
  };
  const wire = (ch: RTCDataChannel) => {
    ch.onmessage = (e) => {
      try {
        deliver(JSON.parse(e.data as string) as NetMessage);
      } catch {
        // Mensaje roto: se ignora (los importantes se reenvían).
      }
    };
    ch.onopen = refresh;
    ch.onclose = () => {
      state = 'relay';
    };
  };

  try {
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  } catch {
    state = 'relay';
  }
  if (pc) {
    const peer = pc;
    peer.onicecandidate = (e) => {
      if (e.candidate) base.send({ t: 'rtc', ice: e.candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') state = 'relay';
    };
    if (initiator) {
      fast = peer.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
      reliable = peer.createDataChannel('rel');
      wire(fast);
      wire(reliable);
      void peer.createOffer().then((offer) => peer.setLocalDescription(offer)).then(() => {
        base.send({ t: 'rtc', sdp: peer.localDescription?.toJSON() });
      }).catch(() => { state = 'relay'; });
    } else {
      peer.ondatachannel = (e) => {
        if (e.channel.label === 'fast') fast = e.channel;
        else reliable = e.channel;
        wire(e.channel);
        refresh();
      };
    }
    // Si en 8 s no hay conexión directa, queda el servidor (se sigue intentando en segundo plano).
    setTimeout(() => {
      if (state === 'connecting') state = 'relay';
    }, 8000);
  }

  const addIce = (c: RTCIceCandidateInit) => {
    if (!pc) return;
    if (!remoteSet) pendingIce.push(c);
    else void pc.addIceCandidate(c).catch(() => undefined);
  };

  base.onMessage((m) => {
    if (m.t !== 'rtc') {
      deliver(m);
      return;
    }
    if (!pc) return;
    const peer = pc;
    if (m.ice) addIce(m.ice as RTCIceCandidateInit);
    const sdp = m.sdp as RTCSessionDescriptionInit | undefined;
    if (!sdp) return;
    void peer.setRemoteDescription(sdp).then(async () => {
      remoteSet = true;
      for (const c of pendingIce.splice(0)) await peer.addIceCandidate(c).catch(() => undefined);
      if (sdp.type === 'offer') {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        base.send({ t: 'rtc', sdp: peer.localDescription?.toJSON() });
      }
    }).catch(() => { state = 'relay'; });
  });

  return {
    id: base.id,
    kind: base.kind,
    get state() {
      return state;
    },
    send(msg: NetMessage) {
      if (open()) {
        const ch = LOSSY.has(msg.t) ? fast! : reliable!;
        try {
          ch.send(JSON.stringify({ ...msg, from: base.id }));
          return;
        } catch {
          // El canal se cayó justo: va por el servidor.
        }
      }
      base.send(msg);
    },
    onMessage: (cb) => handlers.push(cb),
    onSelf: (cb) => base.onSelf(cb),
    close() {
      try {
        pc?.close();
      } catch {
        // Ya estaba cerrada.
      }
      base.close();
    },
  };
}
