import { Simulation, type SimOptions } from './rally';
import { TUNING } from './tuning';

/** Corre un partido completo sin gráficos. `onCreate` permite suscribirse al bus antes del primer saque. */
export function runMatch(opts: SimOptions, onCreate?: (sim: Simulation) => void, maxSimSeconds = 6 * 3600): Simulation {
  const sim = new Simulation(opts);
  onCreate?.(sim);
  while (sim.phase !== 'matchOver') {
    sim.step(TUNING.dt);
    if (sim.time > maxSimSeconds) throw new Error(`Partido trabado (seed ${opts.seed})`);
  }
  return sim;
}
