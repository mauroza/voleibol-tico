import { describe, expect, it } from 'vitest';
import { cardById, cardPlayer, openPack, VNL_CARDS } from '../../src/data/cards';
import { clubTeam, SQUAD_ROLES } from '../../src/data/club';
import { defaultProfile } from '../../src/data/profile';
import { createRng } from '../../src/sim/rng';
import { Simulation } from '../../src/sim/rally';
import { TEAMS } from '../../src/data/teams';

describe('sobres y club', () => {
  it('cada sobre trae un jugador y salen todas las rarezas', () => {
    const rng = createRng(9);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const cards = openPack(rng);
      expect(cards).toHaveLength(1);
      seen.add(cards[0].rarity);
    }
    expect([...seen].sort()).toEqual(['elite', 'internacional', 'leyenda', 'promesa']);
  });

  it('las figuras pedidas están en la colección', () => {
    for (const id of ['yujinishida', 'darlansouza', 'aleksandarnikolov', 'antoinebrizard']) expect(cardById(id)).not.toBeNull();
    expect(new Set(VNL_CARDS.map((c) => c.id)).size).toBe(VNL_CARDS.length);
  });

  it('el club arma un equipo válido con las cartas puestas en la plantilla y juega un partido', () => {
    const p = defaultProfile();
    p.club.name = 'Deportivo Volcán';
    p.cards = { yujinishida: 2, simonegiannelli: 1 };
    p.squad[3] = 'card:yujinishida';
    p.squad[0] = 'card:simonegiannelli';
    const team = clubTeam(p);
    expect(team.roster.map((x) => x.role)).toEqual([...SQUAD_ROLES]);
    expect(team.roster[3].name).toBe('Yuji Nishida');
    expect(new Set(team.roster.map((x) => x.number)).size).toBe(12);
    // La repetida sube la media.
    expect(cardPlayer(cardById('yujinishida')!, 'x', 2).attrs.attackPower).toBeGreaterThanOrEqual(cardPlayer(cardById('yujinishida')!, 'x', 1).attrs.attackPower);
    const sim = new Simulation({ seed: 4, setsToWin: 1, teamA: team, teamB: TEAMS[2] });
    for (let i = 0; i < 120 * 60 * 20 && sim.phase !== 'matchOver'; i++) sim.step(1 / 120);
    expect(sim.phase).toBe('matchOver');
  }, 60_000);
});
