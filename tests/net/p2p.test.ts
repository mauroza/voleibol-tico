import { describe, expect, it } from 'vitest';
import { withDirectLink } from '../../src/net/p2p';
import type { NetMessage, Transport } from '../../src/net/transport';

/** Dos transportes de prueba conectados entre sí (como la sala del servidor). */
function pair(): [Transport, Transport] {
  const handlers: [((m: NetMessage) => void)[], ((m: NetMessage) => void)[]] = [[], []];
  const make = (i: 0 | 1): Transport => ({
    id: `t${i}`,
    kind: 'local',
    send: (m) => queueMicrotask(() => { for (const h of handlers[1 - i]) h({ ...m, from: `t${i}` }); }),
    onMessage: (cb) => handlers[i].push(cb),
    onSelf: () => undefined,
    close: () => undefined,
  });
  return [make(0), make(1)];
}

describe('conexión directa', () => {
  it('si no se puede conectar directo, los mensajes siguen por el servidor', async () => {
    const [a, b] = pair();
    const da = withDirectLink(a, true);
    const db = withDirectLink(b, false);
    const got: NetMessage[] = [];
    db.onMessage((m) => got.push(m));
    da.send({ t: 'in', upTo: 5 });
    da.send({ t: 'chat', text: 'hola' });
    await new Promise((r) => setTimeout(r, 20));
    expect(got.map((m) => m.t)).toEqual(['in', 'chat']);
    // Sin WebRTC (en las pruebas no hay), queda por el servidor.
    expect(['relay', 'connecting']).toContain(da.state);
    // Los mensajes para armar la conexión directa no llegan al juego.
    expect(got.some((m) => m.t === 'rtc')).toBe(false);
  });
});
