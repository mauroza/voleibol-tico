import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mergeParts } from '../../src/render/merge';

describe('mergeParts', () => {
  it('une geometrías transformadas con color por vértice', () => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Matrix4().makeTranslation(10, 0, 0);
    const merged = mergeParts([
      { geometry: box, color: '#ff0000', matrix: new THREE.Matrix4() },
      { geometry: box, color: '#0000ff', matrix: m },
    ]);
    const n = box.attributes.position.count;
    expect(merged.attributes.position.count).toBe(n * 2);
    expect(merged.index!.count).toBe(box.index!.count * 2);
    const colors = merged.attributes.color;
    expect(colors.getX(0)).toBeCloseTo(1);
    expect(colors.getZ(n)).toBeCloseTo(1);
    // La segunda caja quedó desplazada 10 en x
    expect(merged.attributes.position.getX(n)).toBeCloseTo(box.attributes.position.getX(0) + 10);
    // Los índices de la segunda parte apuntan a sus propios vértices
    expect(Math.min(...Array.from(merged.index!.array).slice(box.index!.count))).toBe(n);
  });

  it('las normales siguen la rotación', () => {
    const plane = new THREE.PlaneGeometry(1, 1); // normal +z
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2); // ahora +y
    const merged = mergeParts([{ geometry: plane, color: '#fff', matrix: rot }]);
    expect(merged.attributes.normal.getY(0)).toBeCloseTo(1);
  });
});
