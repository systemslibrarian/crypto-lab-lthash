import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HashOracle, hashItemWords, utf8 } from '../lthash/lthash';
import { runOneBit } from '../attack/onebit';
import { verifyCollision } from './verify';

describe('Check F — the independent verifier fails closed', () => {
  const p = { N: 6, d: 4 };

  it('imports nothing from src/attack (invariant 1)', () => {
    // The MODULE SPECIFIERS, not the whole file: the header comment names
    // src/attack deliberately, to say what this module must not reach for. The
    // comments are stripped first so a mention can never satisfy or break this.
    const source = readFileSync(new URL('./verify.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const specifiers = [...code.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers).toEqual(['../lthash/lthash']);
  });

  it('rejects a claimed collision between two equal sets', () => {
    const S = ['a', 'b', 'c'].map(utf8);
    const verdict = verifyCollision(p, S, [...S].reverse());
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/same set/);
    expect(verdict.wordsCompared).toBe(0);
  });

  it('rejects two empty sets', () => {
    expect(verifyCollision(p, [], []).ok).toBe(false);
  });

  it('rejects a "collision" whose digests differ in one word, naming the word', () => {
    // Construct two sets whose digests agree everywhere except one late word by
    // taking a genuine collision and adding one item to one side.
    const result = runOneBit({ N: 6, d: 4 }, new HashOracle({ N: 6, d: 4 }));
    const extra = utf8('extra-item');
    const verdict = verifyCollision(p, [...result.items, extra], []);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/differ at word \d+/);
    expect(verdict.firstDifferingWord).toBeGreaterThanOrEqual(0);
  });

  it('rejects digests that agree in the first word but differ later', () => {
    // Search for an item whose vector has word 0 equal to zero, so the digest of
    // {item} agrees with the empty digest at word 0 and differs after it.
    let found: Uint8Array | null = null;
    for (let i = 0; i < 5000 && !found; i++) {
      const it = utf8(`probe-${i}`);
      const w = hashItemWords(p, it);
      if (w[0] === 0 && w.some((v) => v !== 0)) found = it;
    }
    expect(found).not.toBeNull();
    const verdict = verifyCollision(p, [found as Uint8Array], []);
    expect(verdict.ok).toBe(false);
    expect(verdict.firstDifferingWord).toBeGreaterThan(0);
    expect(verdict.wordsCompared).toBeGreaterThan(1);
  });

  it('rejects a list with a duplicate item: a multiset is not a set', () => {
    const verdict = verifyCollision(p, [utf8('x'), utf8('x')], [utf8('y')]);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/set A lists an item twice/);
    expect(verifyCollision(p, [utf8('y')], [utf8('x'), utf8('x')]).reason).toMatch(/set B lists an item twice/);
  });

  it('accepts a genuine collision and reports all N words compared', () => {
    const result = runOneBit(p, new HashOracle(p));
    const verdict = verifyCollision(p, result.items, []);
    expect(verdict.ok).toBe(true);
    expect(verdict.wordsCompared).toBe(p.N);
    expect(verdict.firstDifferingWord).toBe(-1);
    expect(verdict.rehashed).toBe(result.items.length);
  });

  it('refuses parameters out of range', () => {
    expect(() => verifyCollision({ N: 0, d: 4 }, [], [])).toThrow(/N must be/);
  });
});
