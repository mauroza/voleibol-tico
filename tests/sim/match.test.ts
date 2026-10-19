import { describe, expect, it } from 'vitest';
import { awardPoint, courtPlayers, createMatch, type MatchState, type TeamSetup } from '../../src/sim/match';

const setup = (t: string): TeamSetup => ({
  lineup: [1, 2, 3, 4, 5, 6].map((n) => `${t}${n}`),
  libero: `${t}L`,
  liberoReplaces: [`${t}3`, `${t}6`],
});
const fresh = (setsToWin: 1 | 2 = 2): MatchState => createMatch({ setsToWin }, setup('a'), setup('b'));
const give = (m: MatchState, team: 'A' | 'B', n: number) => { for (let i = 0; i < n; i++) awardPoint(m, team); };

describe('match', () => {
  it('el equipo que saca y gana no rota', () => {
    const m = fresh();
    const out = awardPoint(m, 'A');
    expect(out.rotated).toBeNull();
    expect(m.lineups.A[0]).toBe('a1');
  });

  it('side-out: el receptor gana, saca y rota', () => {
    const m = fresh();
    const out = awardPoint(m, 'B');
    expect(out.rotated).toBe('B');
    expect(m.serving).toBe('B');
    expect(m.lineups.B).toEqual(['b2', 'b3', 'b4', 'b5', 'b6', 'b1']);
  });

  it('25-24 no cierra el set, 26-24 sí', () => {
    const m = fresh();
    give(m, 'B', 24);
    give(m, 'A', 24);
    expect(awardPoint(m, 'A').setWinner).toBeNull();
    awardPoint(m, 'B');
    awardPoint(m, 'A');
    const out = awardPoint(m, 'A');
    expect(out.setWinner).toBe('A');
    expect(out.points).toEqual({ A: 27, B: 25 });
    expect(m.points).toEqual({ A: 0, B: 0 });
    expect(m.sets.A).toBe(1);
    expect(m.serving).toBe('B');
  });

  it('el tercer set de un partido a 2 sets ganados va a 15', () => {
    const m = fresh(2);
    give(m, 'A', 25);
    give(m, 'B', 25);
    expect(m.setNumber).toBe(3);
    give(m, 'A', 14);
    const out = awardPoint(m, 'A');
    expect(out.matchWinner).toBe('A');
    expect(m.winner).toBe('A');
  });

  it('a 1 set el partido termina al primer set', () => {
    const m = fresh(1);
    give(m, 'B', 25);
    expect(m.winner).toBe('B');
  });

  it('el líbero reemplaza al central solo en zaga y nunca saca', () => {
    const m = fresh();
    expect(courtPlayers(m, 'A')).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'aL']);
    expect(courtPlayers(m, 'B')).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'bL']);
    m.lineups.A = ['a6', 'a1', 'a2', 'a3', 'a4', 'a5'];
    m.serving = 'A';
    expect(courtPlayers(m, 'A')[0]).toBe('a6');
    m.serving = 'B';
    expect(courtPlayers(m, 'A')[0]).toBe('aL');
  });
});
