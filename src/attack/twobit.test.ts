import { describe, expect, it } from 'vitest';
import { verifyCollision } from '../check/verify';
import { HashOracle } from '../lthash/lthash';
import { oneBitQueryCount } from './onebit';
import { expectedTwoBitQueries, gamma, layerCost, runTwoBit, TwoBitLayer, BaseSource } from './twobit';

describe('Two-bit lifting (ePrint 2026/2083, Algorithms 1 and 2)', () => {
  const sizes: Array<[number, number]> = [
    [4, 4],
    [6, 6],
    [8, 6],
    [5, 5],
    [4, 3],
    [6, 2],
    [3, 1],
  ];

  for (const [N, d] of sizes) {
    it(`(N, d) = (${N}, ${d}): the result is self-certifying through the independent verifier`, () => {
      const p = { N, d };
      const oracle = new HashOracle(p);
      const result = runTwoBit(p, oracle);
      expect(result.ok, result.reason).toBe(true);
      expect(result.plusItems.length + result.minusItems.length).toBeGreaterThan(0);
      const verdict = verifyCollision(p, result.plusItems, result.minusItems);
      expect(verdict.ok, verdict.reason).toBe(true);
      expect(result.queries).toBe(oracle.queries);
      // Coefficients are ternary: no base item on both sides.
      const both = result.plusIndices.filter((i) => result.minusIndices.includes(i));
      expect(both).toEqual([]);
    });
  }

  it('uses fewer hash queries than the one-bit recursion at the same size for d ≥ 4', () => {
    for (const [N, d] of [[4, 4], [6, 6], [8, 6], [5, 5], [6, 4]] as Array<[number, number]>) {
      const p = { N, d };
      const result = runTwoBit(p, new HashOracle(p));
      expect(result.ok).toBe(true);
      expect(BigInt(result.queries) < oneBitQueryCount(p), `(${N}, ${d}): ${result.queries} vs ${oneBitQueryCount(p)}`).toBe(true);
      expect(result.oneBitQueries).toBe(oneBitQueryCount(p));
    }
  });

  it('reports a run that reaches its query cap as a failure, not a success', () => {
    const p = { N: 6, d: 6 };
    const result = runTwoBit(p, new HashOracle(p), { cap: 20 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/query cap of 20/);
    expect(result.plusItems).toEqual([]);
    expect(result.queries).toBeLessThanOrEqual(20);
  });

  it('a layer refuses an input with fewer than two modulus bits', () => {
    const p = { N: 3, d: 1 };
    const base = new BaseSource(p, new HashOracle(p), { value: 0 }, 100);
    expect(() => new TwoBitLayer(base, 3, 4)).toThrow(/at least 2 modulus bits/);
  });

  it('every output of a layer is zero modulo 2^(s−2) in the words it dropped, and its support is signed', () => {
    const p = { N: 4, d: 6 };
    const oracle = new HashOracle(p);
    const base = new BaseSource(p, oracle, { value: 0 }, 10_000);
    const layer = new TwoBitLayer(base, 4, 5);
    for (let k = 0; k < 5; k++) {
      const w = layer.next();
      expect(w.words.length).toBe(4);
      expect([...w.words].every((v) => v < 16)).toBe(true);
      expect([...w.rep.values()].every((s) => s === 1 || s === -1)).toBe(true);
      expect(w.rep.size).toBeGreaterThan(0);
    }
    expect(layer.stats.outputs).toBe(5);
    expect(layer.stats.inputsConsumed).toBe(base.requests);
  });
});

describe("The paper's expected-query formulas, recomputed (Section 4 and 6.1)", () => {
  it('γ(a, b) matches hand values: γ(0, b) = 1, γ(a, 0) = 2^−a, γ(1, 1) = 3/4', () => {
    expect(gamma(0, 5)).toBe(1);
    expect(gamma(3, 0)).toBeCloseTo(1 / 8, 12);
    // A uniform 1×1 matrix and target: h ∈ colspan(G) unless G = 0 and h = 1.
    expect(gamma(1, 1)).toBeCloseTo(0.75, 12);
    // γ(a, b) is a probability.
    for (const [a, b] of [[4, 4], [10, 3], [3, 10], [1024, 549]]) {
      const g = gamma(a, b);
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  it('reproduces the paper: p_{1024,550} ≈ 0.98982 and F(x) ≈ 1069.70x + 511.57', () => {
    const c = layerCost(1024, 550);
    expect(c.p).toBeCloseTo(0.98982, 4);
    expect(c.mu).toBeCloseTo(1069.7, 1);
    expect(c.c).toBeCloseTo(511.57, 1);
  });

  it('reproduces the paper: log2 E[Q] ≈ 81.07 for LtHash16 with eight layers at t = 550', () => {
    const e = expectedTwoBitQueries(1024, 16, 550);
    expect(e.layers).toBe(8);
    expect(e.terminalOutputs).toBe(1);
    expect(e.log2Expected).toBeCloseTo(81.07, 1);
    // Corollary 3's capped budget ⌈4·E[Q]⌉ ≈ 2^83.07 (Table 4).
    expect(e.log2Budget).toBeCloseTo(83.07, 1);
  });

  it('reproduces Table 4 for LtHash20 and LtHash32 budgets', () => {
    expect(expectedTwoBitQueries(1008, 20, 542).log2Budget).toBeCloseTo(102.97, 1);
    expect(expectedTwoBitQueries(1024, 32, 550).log2Budget).toBeCloseTo(163.57, 1);
  });

  it('Theorem 2 bound: p_{N,N+1} > 1/4 at the sizes this page runs', () => {
    for (const N of [2, 4, 6, 8, 12, 16]) expect(layerCost(N, N + 1).p).toBeGreaterThan(0.25);
  });
});
