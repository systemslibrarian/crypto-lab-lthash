/**
 * The independent verifier. It imports NOTHING from src/attack/: it is handed
 * two lists of items and nothing else, re-hashes every item from scratch, sums
 * the vectors itself, and compares every word of the two digests. A collision
 * is only ever reported from here (invariant 1).
 */
import {
  type LtHashParams,
  addWords,
  checkParams,
  firstDifference,
  hashItemWords,
  toHex,
  zeroDigest,
} from '../lthash/lthash';

export interface CollisionVerdict {
  /** True only when both lists are sets, the sets differ, and every word agrees. */
  ok: boolean;
  reason: string;
  sizeA: number;
  sizeB: number;
  digestA: Uint32Array;
  digestB: Uint32Array;
  /** Index of the first differing word, or −1 when the digests agree. */
  firstDifferingWord: number;
  /** How many words were compared; a collision verdict compares all N. */
  wordsCompared: number;
  /** Hash evaluations this verification performed. */
  rehashed: number;
}

function duplicateIn(items: readonly Uint8Array[]): string | null {
  const seen = new Set<string>();
  for (const it of items) {
    const key = toHex(it);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

function sameSet(a: readonly Uint8Array[], b: readonly Uint8Array[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(toHex));
  return b.every((it) => keys.has(toHex(it)));
}

/** Σ H(x) over the list, computed here and nowhere else. */
function rehash(p: LtHashParams, items: readonly Uint8Array[]): Uint32Array {
  let acc = zeroDigest(p);
  for (const it of items) acc = addWords(p, acc, hashItemWords(p, it));
  return acc;
}

export function verifyCollision(p: LtHashParams, A: readonly Uint8Array[], B: readonly Uint8Array[]): CollisionVerdict {
  checkParams(p);
  const digestA = rehash(p, A);
  const digestB = rehash(p, B);
  const base = {
    sizeA: A.length,
    sizeB: B.length,
    digestA,
    digestB,
    rehashed: A.length + B.length,
  };
  const dupA = duplicateIn(A);
  if (dupA !== null) {
    return { ...base, ok: false, reason: `set A lists an item twice (0x${dupA}), so it is not a set`, firstDifferingWord: -1, wordsCompared: 0 };
  }
  const dupB = duplicateIn(B);
  if (dupB !== null) {
    return { ...base, ok: false, reason: `set B lists an item twice (0x${dupB}), so it is not a set`, firstDifferingWord: -1, wordsCompared: 0 };
  }
  if (sameSet(A, B)) {
    return { ...base, ok: false, reason: 'the two sets are the same set; equal digests of equal sets are not a collision', firstDifferingWord: -1, wordsCompared: 0 };
  }
  // Compare every word. Mutation (7) of the ledger shortens this to the first word.
  let differing = -1;
  let compared = 0;
  for (let i = 0; i < p.N; i++) {
    compared += 1;
    if (digestA[i] !== digestB[i]) {
      differing = i;
      break;
    }
  }
  if (differing >= 0) {
    return {
      ...base,
      ok: false,
      reason: `the digests differ at word ${differing} (${digestA[differing]} vs ${digestB[differing]}), so this is not a collision`,
      firstDifferingWord: differing,
      wordsCompared: compared,
    };
  }
  if (firstDifference(digestA, digestB) !== -1) {
    throw new Error('internal check failed: the comparison loop and firstDifference disagree');
  }
  return {
    ...base,
    ok: true,
    reason: `all ${p.N} words of the two digests agree and the sets differ (|A| = ${A.length}, |B| = ${B.length})`,
    firstDifferingWord: -1,
    wordsCompared: compared,
  };
}
