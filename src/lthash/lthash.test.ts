import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FOLLY_COMMIT, FOLLY_VECTOR_HEX, FOLLY_VECTOR_SHA256, FOLLY_VECTOR_STEPS } from './folly-vector';
import {
  DEPLOYED,
  DuplicateItemError,
  HashOracle,
  LtHash,
  addWords,
  bytesToWords,
  checkParams,
  digestOf,
  firstDifference,
  fromHex,
  hashItemWords,
  subWords,
  toHex,
  utf8,
  wordsEqual,
  wordsToBytes,
  zeroDigest,
} from './lthash';

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

describe('Check A — the deployed instance against the Folly reference vector', () => {
  it('the fixture is the 2,048-byte checksum from LtHashTest.cpp at the recorded commit', () => {
    expect(FOLLY_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(FOLLY_VECTOR_HEX.length).toBe(4096);
    expect(FOLLY_VECTOR_HEX.startsWith('353cae6169e519eb')).toBe(true);
    expect(FOLLY_VECTOR_HEX.endsWith('5be61d86')).toBe(true);
    // Expected value stated in the brief, derived independently of this code.
    expect(sha256(fromHex(FOLLY_VECTOR_HEX))).toBe(FOLLY_VECTOR_SHA256);
    expect(FOLLY_VECTOR_SHA256).toBe('818efcd3cea53047141f7e70379e397f4374a6e6d28804439c69de9d60220d91');
  });

  it('add "a", add "b", add "hello", remove "b" reproduces the reference checksum', () => {
    const h = new LtHash(DEPLOYED, 'set');
    for (const step of FOLLY_VECTOR_STEPS) {
      if (step.op === 'add') h.add(step.item);
      else h.remove(step.item);
    }
    expect(toHex(wordsToBytes(h.digest))).toBe(FOLLY_VECTOR_HEX);
  });

  it('adding only "a" and "hello" gives the same digest (removal undid the addition)', () => {
    const digest = digestOf(DEPLOYED, [utf8('a'), utf8('hello')]);
    expect(toHex(wordsToBytes(digest))).toBe(FOLLY_VECTOR_HEX);
  });

  it('the words are little-endian: the first word of the vector is 0x3c35', () => {
    // Bytes 35 3c → LE word 0x3c35. A big-endian reading would give 0x353c.
    const words = bytesToWords(DEPLOYED, fromHex(FOLLY_VECTOR_HEX));
    expect(words[0]).toBe(0x3c35);
    expect(digestOf(DEPLOYED, [utf8('a'), utf8('hello')])[0]).toBe(0x3c35);
  });

  it('the digest recomputed from scratch equals the incrementally maintained one after random adds and removes', () => {
    const h = new LtHash(DEPLOYED, 'multiset');
    let seed = 12345;
    const next = (): number => (seed = (seed * 1103515245 + 12345) >>> 0);
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
    for (let i = 0; i < 40; i++) {
      const name = names[next() % names.length];
      if (next() % 3 === 0) h.remove(name);
      else h.add(name);
    }
    expect(wordsEqual(h.digest, h.recomputeFromScratch())).toBe(true);
    // And against the pure function over the net multiset.
    const net = h.list();
    let expected = zeroDigest(DEPLOYED);
    for (const e of net) {
      const v = hashItemWords(DEPLOYED, e.item);
      for (let k = 0; k < Math.abs(e.count); k++) {
        expected = e.count > 0 ? addWords(DEPLOYED, expected, v) : subWords(DEPLOYED, expected, v);
      }
    }
    expect(wordsEqual(h.digest, expected)).toBe(true);
  });
});

describe('Check D — algebra of the construction (reduced-size instance)', () => {
  const p = { N: 8, d: 6 };
  const items = (prefix: string, n: number): Uint8Array[] => Array.from({ length: n }, (_, i) => utf8(`${prefix}-${i}`));

  it('digest(A ∪ B) = digest(A) + digest(B) for disjoint A and B', () => {
    const A = items('a', 7);
    const B = items('b', 5);
    const lhs = digestOf(p, [...A, ...B]);
    const rhs = addWords(p, digestOf(p, A), digestOf(p, B));
    expect(wordsEqual(lhs, rhs)).toBe(true);
  });

  it('add then remove returns to the original digest', () => {
    const h = new LtHash(p, 'set');
    for (const name of ['x', 'y', 'z']) h.add(name);
    const before = h.digest;
    h.add('w');
    expect(wordsEqual(h.digest, before)).toBe(false);
    h.remove('w');
    expect(wordsEqual(h.digest, before)).toBe(true);
  });

  it('is invariant under permutation of the items', () => {
    const A = items('perm', 9);
    const reversed = [...A].reverse();
    const rotated = [...A.slice(4), ...A.slice(0, 4)];
    expect(wordsEqual(digestOf(p, A), digestOf(p, reversed))).toBe(true);
    expect(wordsEqual(digestOf(p, A), digestOf(p, rotated))).toBe(true);
  });

  it('every word stays below 2^d after addition and subtraction', () => {
    const A = items('mask', 50);
    const digest = digestOf(p, A);
    expect([...digest].every((w) => w < 1 << p.d)).toBe(true);
    const h = new LtHash(p, 'multiset');
    for (let i = 0; i < 30; i++) h.remove(`never-${i}`);
    expect([...h.digest].every((w) => w >= 0 && w < 1 << p.d)).toBe(true);
  });

  it('the reduced instance is a projection of the deployed expansion', () => {
    const full = hashItemWords(DEPLOYED, utf8('hello'));
    const small = hashItemWords({ N: 8, d: 6 }, utf8('hello'));
    for (let i = 0; i < 8; i++) expect(small[i]).toBe(full[i] & 0x3f);
  });

  it('the empty set has the all-zero digest', () => {
    expect(wordsEqual(digestOf(p, []), zeroDigest(p))).toBe(true);
    expect(wordsEqual(new LtHash(DEPLOYED).digest, zeroDigest(DEPLOYED))).toBe(true);
  });
});

describe('Check F — fail-closed paths of the construction', () => {
  it('refuses N out of range, naming N', () => {
    expect(() => checkParams({ N: 0, d: 4 })).toThrow(/N must be/);
    expect(() => checkParams({ N: 1025, d: 4 })).toThrow(/N must be/);
    expect(() => checkParams({ N: 2.5, d: 4 })).toThrow(/N must be/);
  });

  it('refuses d out of range, naming d', () => {
    expect(() => checkParams({ N: 4, d: 0 })).toThrow(/d must be/);
    expect(() => checkParams({ N: 4, d: 17 })).toThrow(/d must be/);
  });

  it('refuses a digest of the wrong length, naming both lengths', () => {
    expect(() => bytesToWords(DEPLOYED, new Uint8Array(2047))).toThrow(/2048 bytes.*got 2047/);
    expect(() => bytesToWords({ N: 4, d: 4 }, new Uint8Array(9))).toThrow(/8 bytes.*got 9/);
    expect(() => addWords({ N: 4, d: 4 }, new Uint32Array(4), new Uint32Array(5))).toThrow(/5 words/);
  });

  it('refuses a pasted digest whose words do not fit in d bits', () => {
    const bytes = new Uint8Array(8);
    bytes[2] = 0xff; // word 1 = 0x00ff > 2^4 − 1
    expect(() => bytesToWords({ N: 4, d: 4 }, bytes)).toThrow(/word 1/);
  });

  it('refuses a duplicate item in set mode and allows it in multiset mode', () => {
    const set = new LtHash({ N: 4, d: 4 }, 'set');
    set.add('dup');
    expect(() => set.add('dup')).toThrow(DuplicateItemError);
    const multi = new LtHash({ N: 4, d: 4 }, 'multiset');
    multi.add('dup');
    expect(() => multi.add('dup')).not.toThrow();
    expect(multi.list().find((e) => e.name === 'dup')?.count).toBe(2);
  });

  it('refuses an absent set member before hashing or changing the digest', () => {
    const set = new LtHash({ N: 4, d: 4 }, 'set');
    expect(() => set.remove('ghost')).toThrow(/not in the set/);
    expect(set.queries).toBe(0);
    set.add('ghost');
    set.remove('ghost');
    const empty = set.digest;
    expect(() => set.remove('ghost')).toThrow(/not in the set/);
    expect(set.queries).toBe(2);
    expect(set.digest).toEqual(empty);
    set.add('ghost');
    expect(set.members()).toHaveLength(1);
  });

  it('signed-count arithmetic allows subtraction from zero', () => {
    const h = new LtHash({ N: 4, d: 4 }, 'multiset');
    const before = h.digest;
    h.remove('ghost');
    expect(wordsEqual(h.digest, before)).toBe(false);
    expect(h.list().find((e) => e.name === 'ghost')?.count).toBe(-1);
    expect(wordsEqual(h.digest, h.recomputeFromScratch())).toBe(true);
  });

  it('d = 1 and N = 1 are valid instances', () => {
    expect(() => checkParams({ N: 1, d: 1 })).not.toThrow();
    const h = new LtHash({ N: 1, d: 1 });
    h.add('one');
    expect(h.digest.length).toBe(1);
    expect(h.digest[0]).toBeLessThan(2);
  });

  it('firstDifference reports the first differing word, or −1', () => {
    expect(firstDifference(new Uint32Array([1, 2, 3]), new Uint32Array([1, 2, 3]))).toBe(-1);
    expect(firstDifference(new Uint32Array([1, 2, 3]), new Uint32Array([1, 9, 3]))).toBe(1);
  });

  it('fromHex rejects odd-length or non-hex input', () => {
    expect(() => fromHex('abc')).toThrow(RangeError);
    expect(() => fromHex('zz')).toThrow(RangeError);
  });
});

describe('Invariant 3 — the query counter counts calls, and a repeated item is not hidden from it', () => {
  it('two queries of the same item are two queries and one distinct item', () => {
    const oracle = new HashOracle({ N: 4, d: 4 });
    oracle.hash(utf8('same'));
    oracle.hash(utf8('same'));
    oracle.hash(utf8('other'));
    expect(oracle.queries).toBe(3);
    expect(oracle.distinct.size).toBe(2);
  });

  it('an incremental state counts both adds and removes as queries', () => {
    const h = new LtHash({ N: 4, d: 4 }, 'set');
    h.add('a');
    h.remove('a');
    h.add('a');
    expect(h.queries).toBe(3);
  });
});
