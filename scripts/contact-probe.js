// Sonda de desarrollo (pegar en la consola con el juego abierto en modo dev): mide, en cada contacto,
// la distancia de la mano más cercana a la pelota. Uso: await window.__probeContacts(600)
window.__probeContacts = async (contacts = 400) => {
  const { sim, view } = window.__game;
  const THREE_V = view.ball.position.constructor;
  const hand = new THREE_V();
  const stats = {};
  let pending = null;
  const off = sim.bus.on((e) => {
    if (e.type === 'contact' && e.kind !== 'serve') pending = { key: e.playerKey, kind: e.kind, ball: { ...sim.ballPos } };
  });
  let n = 0;
  while (n < contacts && sim.phase !== 'matchOver') {
    const d = sim.decision;
    if (d && d.chosen === null) sim.choose(0);
    if (d && d.kind === 'serve') sim.press();
    sim.step(1 / 240);
    if (!pending) continue;
    for (const a of view.animators) a.update();
    const a = view.animators.find((x) => x.key === pending.key);
    a.rig.root.updateMatrixWorld(true);
    let best = Infinity;
    for (const s of ['L', 'R']) {
      a.rig.joints[`elbow${s}`].localToWorld(hand.set(0, -0.31, 0));
      best = Math.min(best, Math.hypot(hand.x - pending.ball.x, hand.y - pending.ball.y, hand.z - pending.ball.z));
    }
    (stats[pending.kind] ??= []).push(best);
    pending = null;
    n += 1;
  }
  off();
  const out = {};
  for (const [k, v] of Object.entries(stats)) {
    v.sort((x, y) => x - y);
    out[k] = { n: v.length, median: +v[Math.floor(v.length / 2)].toFixed(2), p90: +v[Math.floor(v.length * 0.9)].toFixed(2), within25cm: +(v.filter((x) => x < 0.25).length / v.length).toFixed(2) };
  }
  return out;
};
