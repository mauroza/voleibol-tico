import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MODEL_HAIRS, buildModelCharacter, modelHairFor, parseModel, useModel } from '../../src/render/model';
import { JOINTS } from '../../src/render/pose';

const file = readFileSync(new URL('../../src/assets/jugador.bin', import.meta.url));
const data = parseModel(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const { meta } = data;

describe('modelo del jugador', () => {
  it('trae el esqueleto del juego, cuerpo, cara y los cuatro peinados', () => {
    for (const j of [...JOINTS, 'hips']) expect(meta.bones).toContain(j);
    for (const r of ['cuerpo', 'cara', ...MODEL_HAIRS.map((h) => `pelo_${h}`)]) expect(meta.ranges[r][1]).toBeGreaterThan(0);
    expect(data.index.length).toBe(meta.indexCount);
  });

  it('índices, huesos y pesos válidos', () => {
    expect(Math.max(...data.index)).toBeLessThan(meta.vertexCount);
    for (let i = 0; i < meta.vertexCount; i++) {
      const w = data.skinWeight.subarray(i * 4, i * 4 + 4);
      expect(w[0] + w[1] + w[2] + w[3]).toBe(255);
      for (let k = 0; k < 4; k++) expect(data.skinIndex[i * 4 + k]).toBeLessThan(meta.bones.length);
      expect(data.slot[i]).toBeLessThan(meta.slots.length);
    }
  });

  it('liviano: menos de 12 mil triángulos por jugador', () => {
    const tris = (meta.ranges.cuerpo[1] + meta.ranges.cara[1] + Math.max(...MODEL_HAIRS.map((h) => meta.ranges[`pelo_${h}`][1]))) / 3;
    expect(tris).toBeLessThan(12_000);
  });

  it('en reposo la mano queda cerca de la muñeca del modelo, con los brazos un poco más pegados al cuerpo', () => {
    useModel(data);
    const look = { shirt: '#c00', shorts: '#003', skin: '#e2b48c', hair: '#222', number: 7, name: 'ARAYA', armSleeve: { L: false, R: false }, legSleeve: { L: false, R: false }, sleeve: '#fff' };
    const rig = buildModelCharacter(look, { shirt: '#c00', shorts: '#003', skin: '#e2b48c', hair: '#222', trim: '#fff' }, () => {});
    rig.root.updateMatrixWorld(true);
    const hand = rig.joints.elbowR.localToWorld(new THREE.Vector3(0, -rig.dims.forearm, 0));
    const wrist = new THREE.Vector3(...meta.joints.wristR);
    expect(hand.distanceTo(wrist)).toBeLessThan(0.08);
    expect(Math.abs(hand.x)).toBeLessThan(Math.abs(wrist.x));
    // Los pies tocan el piso con la cadera a la altura de reposo (como calcula el animador).
    expect(rig.dims.foot + rig.dims.thigh + rig.dims.shin).toBeCloseTo(rig.hips.position.y, 2);
  });

  it('cada jugador tiene siempre el mismo peinado; sin pelo, rapado', () => {
    expect(modelHairFor({ hair: null, name: 'X', number: 1 })).toBe('rapado');
    const a = modelHairFor({ hair: '#111', name: 'ARAYA', number: 7 });
    expect(modelHairFor({ hair: '#111', name: 'ARAYA', number: 7 })).toBe(a);
  });
});
