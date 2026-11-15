import { describe, expect, it } from 'vitest';
import { fromColumns, kernelVector, multiply, NoKernelVectorError, parity, rank, rref, solve } from './gf2';

let seed = 0x1234567;
const rnd = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0);
const randomMatrix = (n: number, m: number): Uint8Array[] =>
  Array.from({ length: n }, () => Uint8Array.from({ length: m }, () => rnd() & 1));

describe('GF(2) elimination', () => {
  it('finds a non-zero kernel vector for every random N × (N + 1) matrix', () => {
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + (rnd() % 12);
      const A = randomMatrix(n, n + 1);
      const { vector } = kernelVector(A);
      expect(vector.some((v) => v === 1)).toBe(true);
      expect([...multiply(A, vector)].every((v) => v === 0)).toBe(true);
    }
  });

  it('the kernel vector is in the kernel even when the pivot is not in the first row', () => {
    // Column 0 has its only 1 in row 2: the elimination must swap rows to proceed.
    const A = [
      Uint8Array.from([0, 1, 1, 0]),
      Uint8Array.from([0, 0, 1, 1]),
      Uint8Array.from([1, 1, 0, 1]),
    ];
    const { vector, rref: R } = kernelVector(A, true);
    expect(R.steps.some((s) => s.kind === 'swap')).toBe(true);
    expect([...multiply(A, vector)]).toEqual([0, 0, 0]);
  });

  it('refuses a full-column-rank matrix by name', () => {
    const I = [Uint8Array.from([1, 0]), Uint8Array.from([0, 1])];
    expect(() => kernelVector(I)).toThrow(NoKernelVectorError);
  });

  it('solve returns a verified solution or null exactly when the system is inconsistent', () => {
    let consistent = 0;
    let inconsistent = 0;
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + (rnd() % 10);
      const m = 1 + (rnd() % 10);
      const A = randomMatrix(n, m);
      const b = Uint8Array.from({ length: n }, () => rnd() & 1);
      const x = solve(A, b);
      // Brute-force the truth for small m.
      let truth = false;
      for (let mask = 0; mask < 1 << m && !truth; mask++) {
        const cand = Uint8Array.from({ length: m }, (_, j) => (mask >> j) & 1);
        truth = [...multiply(A, cand)].every((v, i) => v === b[i]);
      }
      expect(x !== null, `trial ${trial}`).toBe(truth);
      if (x) {
        consistent++;
        expect([...multiply(A, x)]).toEqual([...b]);
      } else inconsistent++;
    }
    expect(consistent).toBeGreaterThan(0);
    expect(inconsistent).toBeGreaterThan(0);
  });

  it('rank and rref agree with hand-worked cases', () => {
    expect(rank([Uint8Array.from([1, 1]), Uint8Array.from([1, 1])])).toBe(1);
    expect(rank([Uint8Array.from([1, 0]), Uint8Array.from([0, 1])])).toBe(2);
    expect(rank([Uint8Array.from([0, 0])])).toBe(0);
    const R = rref([Uint8Array.from([1, 1, 0]), Uint8Array.from([1, 0, 1])]);
    expect(R.pivotCols).toEqual([0, 1]);
    expect([...R.rows[0]]).toEqual([1, 0, 1]);
    expect([...R.rows[1]]).toEqual([0, 1, 1]);
  });

  it('fromColumns and parity build the matrix the recursion eliminates', () => {
    const v1 = new Uint32Array([3, 4]);
    const v2 = new Uint32Array([2, 7]);
    const rows = fromColumns([parity(v1), parity(v2)], 2);
    expect([...rows[0]]).toEqual([1, 0]);
    expect([...rows[1]]).toEqual([0, 1]);
  });
});
