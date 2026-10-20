import { makeTeam } from '../src/data/teams';
import { runMatch } from '../src/sim/headless';
import { TARGETS, attachMetrics, emptyMetrics, summarize } from '../src/sim/metrics';

const n = Number(process.argv[2] ?? 400);
const equal = makeTeam({ id: 'EQ', name: 'Iguales', province: '-', primary: '#888888', secondary: '#ffffff', style: 'balanced', seed: 1, variance: 0 });
const metrics = emptyMetrics();
const started = Date.now();

for (let i = 0; i < n; i++) {
  runMatch(
    { seed: Number(process.env.SEED0 ?? 1000) + i, setsToWin: 1, teamA: equal, teamB: equal, firstServer: i % 2 === 0 ? 'A' : 'B' },
    (sim) => attachMetrics(sim.bus, metrics),
  );
}

const s = summarize(metrics);
console.log(`${n} partidos (1 set, equipos iguales) en ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
let failures = 0;
for (const [key, value] of Object.entries(s) as [keyof typeof s, number][]) {
  const range = (TARGETS as Record<string, readonly [number, number]>)[key];
  const ok = !range || (value >= range[0] && value <= range[1]);
  if (!ok) failures += 1;
  const label = range ? `[${range[0]}, ${range[1]}] ${ok ? 'OK' : 'FUERA'}` : '';
  console.log(`${key.padEnd(16)} ${value.toFixed(3).padStart(7)}  ${label}`);
}
process.exit(failures === 0 ? 0 : 1);
