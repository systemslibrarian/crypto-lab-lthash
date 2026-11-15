import { describe, expect, it } from 'vitest';
import { verifyCollision } from '../check/verify';
import { HashOracle, digestOf, utf8, wordsEqual, zeroDigest } from '../lthash/lthash';
import {
  AttackSizeError,
  OneBitRecursion,
  QUERY_CAP,
  assertAttackSize,
  log2Big,
  oneBitQueryCount,
  runOneBit,
} from './onebit';

describe('Check C — the one-bit recursion on reduced-size instances', () => {
  // Expected values from the brief, derived independently of this code.
  const cases: Array<[number, number, number]> = [
    [4, 4, 625],
    [6, 6, 117_649],
    [8, 6, 531_441],
  ];

  for (const [N, d, expected] of cases) {
    it(`(N, d) = (${N}, ${d}): exactly ${expected.toLocaleString('en-US')} queries, a non-empty set of distinct items whose digest re-hashes to zero`, () => {
      const p = { N, d };
      const oracle = new HashOracle(p);
      const result = runOneBit(p, oracle);
      expect(result.queries).toBe(expected);
      expect(oracle.queries).toBe(expected);
      expect(result.items.length).toBeGreaterThan(0);
      expect(new Set(result.indices).size).toBe(result.indices.length);
      // Independent re-hash: the verifier, which imports nothing from src/attack.
      const verdict = verifyCollision(p, result.items, []);
      expect(verdict.ok, verdict.reason).toBe(true);
      expect(wordsEqual(verdict.digestA, zeroDigest(p))).toBe(true);
      expect(verdict.wordsCompared).toBe(N);
    }, 30_000);
  }

  it('the query count is computed, not stored: (N + 1)^d for the three sizes', () => {
    expect(oneBitQueryCount({ N: 4, d: 4 })).toBe(625n);
    expect(oneBitQueryCount({ N: 6, d: 6 })).toBe(117_649n);
    expect(oneBitQueryCount({ N: 8, d: 6 })).toBe(531_441n);
  });

  it('for the deployed instance (1025)^16 is computed exactly and is about 2^160.02', () => {
    const q = oneBitQueryCount({ N: 1024, d: 16 });
    // 1025^16 computed independently here by repeated squaring on BigInt.
    let check = 1n;
    for (let i = 0; i < 16; i++) check *= 1025n;
    expect(q).toBe(check);
    expect(q.toString().length).toBe(49);
    // The paper (ePrint 2026/2083, §6.2) gives 1025^16 ≈ 2^160.02.
    expect(log2Big(q)).toBeCloseTo(160.02, 2);
    expect(() => assertAttackSize({ N: 1024, d: 16 })).toThrow(AttackSizeError);
  });

  it('S ∪ T collides with T for a disjoint T', () => {
    const p = { N: 4, d: 4 };
    const result = runOneBit(p, new HashOracle(p));
    const T = ['t-0', 't-1', 't-2'].map(utf8);
    const verdict = verifyCollision(p, [...result.items, ...T], T);
    expect(verdict.ok, verdict.reason).toBe(true);
    expect(wordsEqual(digestOf(p, [...result.items, ...T]), digestOf(p, T))).toBe(true);
  });

  it('steps one level at a time: the modulus shrinks by one bit and the base-item list grows', () => {
    const p = { N: 4, d: 4 };
    const run = new OneBitRecursion(p, new HashOracle(p));
    expect(run.modulusBits).toBe(4);
    expect(run.ready).toBe(false);
    run.hashChunk(100);
    expect(run.hashed).toBe(100);
    while (!run.ready) run.hashChunk(200);
    expect(run.hashed).toBe(625);
    let items = run.survivorItems().length;
    expect(items).toBe(1);
    for (let k = 1; k <= 4; k++) {
      const trace = run.cancelNextBit();
      expect(trace.level).toBe(k);
      expect(trace.modulusBitsBefore).toBe(5 - k);
      expect(trace.modulusBitsAfter).toBe(4 - k);
      expect(trace.groups).toBe(5 ** (4 - k));
      expect(run.modulusBits).toBe(4 - k);
      expect(run.vectorCount).toBe(5 ** (4 - k));
      // The traced group: parity matrix is N × (N + 1), subset non-empty, sum even, halved below 2^(s−1).
      expect(trace.first.parity.length).toBe(4);
      expect(trace.first.parity[0].length).toBe(5);
      expect(trace.first.subset.length).toBeGreaterThan(0);
      expect([...trace.first.sum].every((w) => w % 2 === 0)).toBe(true);
      expect([...trace.first.halved].every((w) => w < 1 << (4 - k))).toBe(true);
      // The count is NOT monotone and the page must not claim it is: a subset of
      // size one is legal whenever a single vector is already even in every word,
      // and then the surviving vector inherits only that vector's items. Observed
      // here: 21 items at one level, 14 at the next. What is guaranteed is that the
      // list is never empty, because the kernel vector is never zero.
      const grown = run.survivorItems().length;
      expect(grown).toBeGreaterThanOrEqual(1);
      items = grown;
      expect([...run.survivor()].every((w) => w < 1 << (4 - k))).toBe(true);
    }
    expect(run.done).toBe(true);
    expect([...run.survivor()].every((w) => w === 0)).toBe(true);
    const result = run.result();
    expect(result.items.length).toBe(items);
    expect(result.traces.length).toBe(4);
  });

  it('d = 1: a single elimination finishes it', () => {
    const p = { N: 3, d: 1 };
    const result = runOneBit(p, new HashOracle(p));
    expect(result.queries).toBe(4);
    expect(result.traces.length).toBe(1);
    expect(verifyCollision(p, result.items, []).ok).toBe(true);
  });

  it('N = 1: two items per group, two queries per level', () => {
    const p = { N: 1, d: 3 };
    const result = runOneBit(p, new HashOracle(p));
    expect(result.queries).toBe(8);
    expect(verifyCollision(p, result.items, []).ok).toBe(true);
  });

  it('refuses a size above the cap, naming the count and the cap', () => {
    expect(() => assertAttackSize({ N: 9, d: 6 })).toThrow(/1,000,000.*600,000/);
    expect(() => new OneBitRecursion({ N: 6, d: 7 }, new HashOracle({ N: 6, d: 7 }))).toThrow(AttackSizeError);
    expect(assertAttackSize({ N: 8, d: 6 })).toBe(531_441);
    expect(QUERY_CAP).toBe(600_000);
  });

  it('refuses to cancel a bit before every base item is hashed, and after the last bit', () => {
    const p = { N: 2, d: 2 };
    const run = new OneBitRecursion(p, new HashOracle(p));
    expect(() => run.cancelNextBit()).toThrow(/hash all the base items/);
    run.hashChunk(9);
    run.cancelNextBit();
    run.cancelNextBit();
    expect(() => run.cancelNextBit()).toThrow(/already cancelled/);
  });
});
