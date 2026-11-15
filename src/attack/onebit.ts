/**
 * The one-bit recursion (Göös et al.; attributed to Regev by Chen, Liu and
 * Zhandry, EUROCRYPT 2022, Appendix A; applied to LtHash by Ding, Gong, Jiang
 * and Tang, ePrint 2026/2083, Section 2.2):
 *
 *   Work modulo 2^s. Any N + 1 vectors have a non-empty subset whose sum is
 *   even in every word — a non-zero kernel vector over the two-element field.
 *   Halve that sum: one vector modulo 2^(s−1) that remembers which base items it
 *   is made of. Build N + 1 such vectors from disjoint groups and repeat. After
 *   d levels a single vector modulo 2^0 = 1 remains, and the base items behind
 *   it sum to zero modulo 2^d. Exactly (N + 1)^d base items are hashed, one
 *   query each, and every coefficient is 0 or 1.
 *
 * This file runs it bottom-up so the page can step it: level 0 hashes all the
 * base items; each "cancel the next bit" processes every group at the current
 * level. The vector in position 0 is followed through every level — its group is
 * traced in full — so the learner watches one modulus shrink while one list of
 * base items grows.
 *
 * Nothing here reports a collision. `result()` hands back items; the verdict is
 * the independent re-hash in src/check/verify.ts.
 */
import { fromColumns, kernelVector, type EliminationStep } from './gf2';
import { type HashOracle, type LtHashParams, checkParams, reduceWord, utf8 } from '../lthash/lthash';

/** The most base items this lab will hash in one run; (N + 1)^d above it is refused. */
export const QUERY_CAP = 600_000;

/** (N + 1)^d exactly, as a BigInt, for any N and d (the deployed instance included). */
export function oneBitQueryCount(p: LtHashParams): bigint {
  checkParams(p);
  return (BigInt(p.N) + 1n) ** BigInt(p.d);
}

/** log2 of a positive BigInt, to about 1e-12 relative accuracy, for the "≈ 2^k" display. */
export function log2Big(x: bigint): number {
  if (x <= 0n) throw new RangeError('log2 of a non-positive number');
  const bits = x.toString(2).length;
  // Keep 53 significant bits so the Number conversion is exact.
  const shift = Math.max(0, bits - 53);
  return shift + Math.log2(Number(x >> BigInt(shift)));
}

export class AttackSizeError extends RangeError {
  constructor(p: LtHashParams, count: bigint) {
    super(
      `(N + 1)^d = ${(p.N + 1).toLocaleString('en-US')}^${p.d} = ${count.toLocaleString('en-US')} hash queries exceeds this page's cap of ${QUERY_CAP.toLocaleString('en-US')}; choose a smaller N or d`,
    );
    this.name = 'AttackSizeError';
  }
}

/** Fail closed on sizes the browser cannot run; the deployed instance is one of them. */
export function assertAttackSize(p: LtHashParams): number {
  const count = oneBitQueryCount(p);
  if (count > BigInt(QUERY_CAP)) throw new AttackSizeError(p, count);
  return Number(count);
}

/** Base item i of a run: the bytes of the string "item-i". Deterministic, distinct, re-derivable. */
export function baseItemName(i: number): string {
  return `item-${i}`;
}
export function baseItem(i: number): Uint8Array {
  return utf8(baseItemName(i));
}

export interface GroupTrace {
  /** Index of the group within its level (0 is the traced chain). */
  group: number;
  /** Parity matrix, N rows × (N + 1) columns, of the group's vectors. */
  parity: Uint8Array[];
  /** The kernel vector: which of the N + 1 vectors are in the subset. */
  kernel: Uint8Array;
  subset: number[];
  /** The group's vectors, in order, as words modulo 2^s. */
  vectors: Uint32Array[];
  /** Σ over the subset, as plain integers (every entry even). */
  sum: Uint32Array;
  /** The halved sum, reduced modulo 2^(s−1). */
  halved: Uint32Array;
  steps: EliminationStep[];
  /** Base items behind the halved vector. */
  itemCount: number;
}

export interface LevelTrace {
  /** Level index: 1 for the first bit cancelled. */
  level: number;
  /** Modulus bits before the step (s) and after (s − 1). */
  modulusBitsBefore: number;
  modulusBitsAfter: number;
  groups: number;
  first: GroupTrace;
}

export interface OneBitResult {
  params: LtHashParams;
  /** Base item indices in the final set, ascending. */
  indices: number[];
  items: Uint8Array[];
  names: string[];
  /** Hash queries the oracle counted during this run. */
  queries: number;
  /** (N + 1)^d: the count the recursion is supposed to use. */
  expectedQueries: number;
  traces: LevelTrace[];
}

/**
 * Bottom-up state for one run. Level k holds (N + 1)^(d − k) vectors modulo
 * 2^(d − k) in one flat Uint32Array, and the base items behind each vector as a
 * flat index list with offsets — a plain object per vector would be too heavy
 * at 531,441 vectors.
 */
export class OneBitRecursion {
  readonly params: LtHashParams;
  readonly oracle: HashOracle;
  /** (N + 1)^d as a Number (asserted under the cap). */
  readonly total: number;
  readonly traces: LevelTrace[] = [];
  private readonly queriesAtStart: number;
  private level = 0;
  private hashedCount = 0;
  private count: number;
  private words: Uint32Array;
  private itemStart: Uint32Array;
  private items: Uint32Array;

  constructor(params: LtHashParams, oracle: HashOracle) {
    checkParams(params);
    this.params = params;
    this.oracle = oracle;
    this.total = assertAttackSize(params);
    this.queriesAtStart = oracle.queries;
    this.count = this.total;
    this.words = new Uint32Array(this.total * params.N);
    this.itemStart = new Uint32Array(this.total + 1);
    this.items = new Uint32Array(this.total);
    for (let i = 0; i <= this.total; i++) this.itemStart[i] = i;
    for (let i = 0; i < this.total; i++) this.items[i] = i;
  }

  /** Bits cancelled so far. */
  get bitsCancelled(): number {
    return this.level;
  }
  /** The modulus the current vectors live in, as a bit count: 2^modulusBits. */
  get modulusBits(): number {
    return this.params.d - this.level;
  }
  get hashed(): number {
    return this.hashedCount;
  }
  get ready(): boolean {
    return this.hashedCount === this.total;
  }
  get done(): boolean {
    return this.ready && this.level === this.params.d;
  }
  /** How many vectors the current level holds. */
  get vectorCount(): number {
    return this.count;
  }
  get queries(): number {
    return this.oracle.queries - this.queriesAtStart;
  }

  /** Hash up to `limit` more base items; returns how many have been hashed in all. */
  hashChunk(limit: number): number {
    const N = this.params.N;
    const end = Math.min(this.total, this.hashedCount + Math.max(1, limit));
    for (let i = this.hashedCount; i < end; i++) {
      const h = this.oracle.hash(baseItem(i));
      this.words.set(h, i * N);
    }
    this.hashedCount = end;
    return end;
  }

  /** The vector in position 0 at the current level, modulo 2^modulusBits. */
  survivor(): Uint32Array {
    return this.words.slice(0, this.params.N);
  }
  /** Base item indices behind the vector in position 0. */
  survivorItems(): number[] {
    return Array.from(this.items.subarray(this.itemStart[0], this.itemStart[1]));
  }

  /** Cancel one more bit across every group at this level. */
  cancelNextBit(): LevelTrace {
    if (!this.ready) throw new Error('hash all the base items before cancelling a bit');
    if (this.level >= this.params.d) throw new Error('every bit is already cancelled');
    const { N } = this.params;
    const s = this.modulusBits;
    const groupSize = N + 1;
    const groups = this.count / groupSize;
    if (!Number.isInteger(groups)) throw new Error(`level has ${this.count} vectors, not a multiple of N + 1 = ${groupSize}`);
    const nextWords = new Uint32Array(groups * N);
    const nextStart = new Uint32Array(groups + 1);
    const nextItems = new Uint32Array(this.itemStart[this.count]);
    let itemsOut = 0;
    let first: GroupTrace | undefined;

    for (let g = 0; g < groups; g++) {
      const base = g * groupSize;
      const columns: Uint8Array[] = [];
      const vectors: Uint32Array[] = [];
      for (let j = 0; j < groupSize; j++) {
        const v = this.words.subarray((base + j) * N, (base + j + 1) * N);
        vectors.push(v);
        const par = new Uint8Array(N);
        for (let i = 0; i < N; i++) par[i] = v[i] & 1;
        columns.push(par);
      }
      const matrix = fromColumns(columns, N);
      const { vector: kernel, rref } = kernelVector(matrix, g === 0);
      const subset: number[] = [];
      for (let j = 0; j < groupSize; j++) if (kernel[j]) subset.push(j);
      if (subset.length === 0) throw new Error('kernel vector is zero');

      const sum = new Uint32Array(N);
      for (const j of subset) for (let i = 0; i < N; i++) sum[i] += vectors[j][i];
      const halved = new Uint32Array(N);
      for (let i = 0; i < N; i++) {
        if (sum[i] % 2 !== 0) throw new Error(`word ${i} of the subset sum is odd: the kernel step failed`);
        halved[i] = reduceWord(sum[i] / 2, s - 1);
      }
      nextWords.set(halved, g * N);

      nextStart[g] = itemsOut;
      for (const j of subset) {
        const from = this.itemStart[base + j];
        const to = this.itemStart[base + j + 1];
        nextItems.set(this.items.subarray(from, to), itemsOut);
        itemsOut += to - from;
      }
      if (g === 0) {
        first = {
          group: 0,
          parity: matrix,
          kernel,
          subset,
          vectors: vectors.map((v) => v.slice()),
          sum,
          halved,
          steps: rref.steps,
          itemCount: itemsOut,
        };
      }
    }
    nextStart[groups] = itemsOut;

    this.words = nextWords;
    this.itemStart = nextStart;
    this.items = nextItems.slice(0, itemsOut);
    this.count = groups;
    this.level += 1;
    const trace: LevelTrace = {
      level: this.level,
      modulusBitsBefore: s,
      modulusBitsAfter: s - 1,
      groups,
      first: first as GroupTrace,
    };
    this.traces.push(trace);
    return trace;
  }

  /** The base items behind the single surviving vector, once every bit is cancelled. */
  result(): OneBitResult {
    if (!this.done) throw new Error('the recursion has not finished');
    const indices = Array.from(this.items.subarray(this.itemStart[0], this.itemStart[1])).sort((a, b) => a - b);
    const seen = new Set<number>();
    for (const i of indices) {
      if (seen.has(i)) throw new Error(`base item ${i} appears twice: the result is not a set`);
      seen.add(i);
    }
    return {
      params: this.params,
      indices,
      items: indices.map(baseItem),
      names: indices.map(baseItemName),
      queries: this.queries,
      expectedQueries: this.total,
      traces: this.traces,
    };
  }
}

/** Run the whole recursion synchronously (tests and the small fixture). */
export function runOneBit(params: LtHashParams, oracle: HashOracle): OneBitResult {
  const run = new OneBitRecursion(params, oracle);
  while (!run.ready) run.hashChunk(4096);
  while (!run.done) run.cancelNextBit();
  return run.result();
}
