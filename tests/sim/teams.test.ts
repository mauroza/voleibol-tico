import { describe, expect, it } from 'vitest';
import { TEAMS, makeTeam } from '../../src/data/teams';
import { attackContactHeight, moveSpeed } from '../../src/sim/players';

describe('teams', () => {
  it('hay 7 equipos de provincia con 12 jugadores cada uno', () => {
    expect(TEAMS).toHaveLength(7);
    expect(new Set(TEAMS.map((t) => t.province)).size).toBe(7);
    for (const t of TEAMS) expect(t.roster).toHaveLength(12);
  });

  it('el lineup inicial es un 5-1 y el líbero reemplaza a los centrales', () => {
    for (const t of TEAMS) {
      const role = (id: string) => t.roster.find((p) => p.id === id)!.role;
      expect(t.lineup.map(role)).toEqual(['S', 'OH', 'MB', 'OP', 'OH', 'MB']);
      expect(role(t.libero)).toBe('L');
      expect(t.liberoReplaces.map(role)).toEqual(['MB', 'MB']);
    }
  });

  it('atributos en rango 1..99', () => {
    for (const t of TEAMS) for (const p of t.roster) for (const v of Object.values(p.attrs)) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(99);
    }
  });

  it('es determinista y variance 0 no agrega ruido', () => {
    const spec = { id: 'X', name: 'X', province: 'X', primary: '#000', secondary: '#fff', style: 'balanced' as const, seed: 5 };
    expect(makeTeam(spec)).toEqual(makeTeam(spec));
    const flat = makeTeam({ ...spec, variance: 0 });
    expect(flat.roster[0].attrs.setting).toBe(82);
  });

  it('capacidades físicas derivadas crecen con los atributos', () => {
    const [slow, fast] = [10, 90].map((v) => ({ ...TEAMS[0].roster[0], attrs: { ...TEAMS[0].roster[0].attrs, speed: v, jump: v } }));
    expect(moveSpeed(fast)).toBeGreaterThan(moveSpeed(slow));
    expect(attackContactHeight(fast)).toBeGreaterThan(attackContactHeight(slow));
  });
});
