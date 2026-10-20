/** Mensaje de red: `t` es el tipo; `from` lo pone el transporte (id de quien lo manda). */
export interface NetMessage {
  t: string;
  from?: string;
  [key: string]: unknown;
}

/** Canal de una sala: manda a todos los demás y avisa lo que llega. */
export interface Transport {
  readonly id: string;
  readonly kind: 'online' | 'local';
  send(msg: NetMessage): void;
  onMessage(cb: (msg: NetMessage) => void): void;
  /** Mensajes propios de vuelta del servidor (para medir el ping de esta computadora al servidor). */
  onSelf(cb: (msg: NetMessage) => void): void;
  close(): void;
}

const randomId = () => Math.random().toString(36).slice(2, 10);

/** Prueba sin internet: dos pestañas del mismo navegador se hablan por BroadcastChannel. */
export function localTransport(code: string): Promise<Transport> {
  const id = randomId();
  const channel = new BroadcastChannel(`voleibol-tico-${code}`);
  const handlers: ((msg: NetMessage) => void)[] = [];
  const selfHandlers: ((msg: NetMessage) => void)[] = [];
  channel.onmessage = (e: MessageEvent<NetMessage>) => {
    if (e.data.from !== id) for (const h of handlers) h(e.data);
  };
  return Promise.resolve({
    id,
    kind: 'local',
    send: (msg) => {
      channel.postMessage({ ...msg, from: id });
      if (msg.t === 'sp') setTimeout(() => { for (const h of selfHandlers) h(msg); }, 0);
    },
    onMessage: (cb) => handlers.push(cb),
    onSelf: (cb) => selfHandlers.push(cb),
    close: () => channel.close(),
  });
}

/** Online: canal de difusión de Supabase Realtime (sin base de datos: los mensajes solo pasan). */
export async function supabaseTransport(code: string, url: string, key: string): Promise<Transport> {
  const { createClient } = await import('@supabase/supabase-js');
  const id = randomId();
  const client = createClient(url, key, { realtime: { params: { eventsPerSecond: 60 } } });
  // `self: true`: el servidor también nos devuelve lo nuestro; solo lo usamos para medir nuestro ping al servidor.
  const channel = client.channel(`voleibol-tico:${code}`, { config: { broadcast: { self: true, ack: false } } });
  const handlers: ((msg: NetMessage) => void)[] = [];
  const selfHandlers: ((msg: NetMessage) => void)[] = [];
  channel.on('broadcast', { event: 'm' }, ({ payload }) => {
    const msg = payload as NetMessage;
    if (msg.from !== id) for (const h of handlers) h(msg);
    else if (msg.t === 'sp') for (const h of selfHandlers) h(msg);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No se pudo conectar a la sala')), 10_000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error('No se pudo conectar a la sala'));
      }
    });
  });
  return {
    id,
    kind: 'online',
    send: (msg) => void channel.send({ type: 'broadcast', event: 'm', payload: { ...msg, from: id } }),
    onMessage: (cb) => handlers.push(cb),
    onSelf: (cb) => selfHandlers.push(cb),
    close: () => void client.removeChannel(channel),
  };
}

/** Online si el juego tiene configurado Supabase; si no, prueba local entre pestañas. */
export function openTransport(code: string): Promise<Transport> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
  // En claude.ai (build "artifact") no hay red: ni siquiera se incluye el cliente de Supabase.
  if (import.meta.env.MODE !== 'artifact' && url && key) return supabaseTransport(code, url, key);
  return localTransport(code);
}

/** Código de sala fácil de dictar: 4 letras sin confusiones (sin I, O) y 2 números. */
export function roomCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return `${s}${Math.floor(10 + Math.random() * 90)}`;
}
