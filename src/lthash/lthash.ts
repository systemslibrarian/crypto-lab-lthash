/**
 * LtHash_{N,d}: for a set S of byte strings,
 *
 *   LtHash(S) = Σ_{x ∈ S} H(x)   in (Z/2^d)^N,
 *
 * where H expands x to N words of d bits. Adding an element adds its vector;
 * removing one subtracts it. The deployed instance (Facebook's Folly library,
 * Solana's accounts lattice hash) is N = 1024, d = 16, with H the first 1,024
 * little-endian 16-bit words of a 2,048-byte BLAKE2Xb expansion.
 *
 * Every other (N, d) this lab runs is a REDUCED-SIZE INSTANCE: the first N words
 * of the same 2,048-byte expansion, each masked to d bits. It is a projection
 * of the real hash, not a toy with a different hash behind it — and nothing
 * shown about a reduced instance is a result about the deployed one.
 */
import { blake2xbPrefix } from '../hash/blake2xb';

export interface LtHashParams {
  /** Number of words in the digest, 1..1024. */
  readonly N: number;
  /** Bits per word, 1..16; arithmetic is modulo 2^d. */
  readonly d: number;
}

/** The deployed instance, as Folly's LtHash<16, 1024> builds it. */
export const DEPLOYED: LtHashParams = { N: 1024, d: 16 };

/** Byte length of the BLAKE2Xb expansion every instance in this lab reads from. */
export const EXPANSION_BYTES = 2048;

export const MAX_N = 1024;
export const MAX_D = 16;

export function checkParams(p: LtHashParams): void {
  if (!Number.isInteger(p.N) || p.N < 1 || p.N > MAX_N) {
    throw new RangeError(`N must be an integer from 1 to ${MAX_N}, got ${String(p.N)}`);
  }
  if (!Number.isInteger(p.d) || p.d < 1 || p.d > MAX_D) {
    throw new RangeError(`d must be an integer from 1 to ${MAX_D}, got ${String(p.d)}`);
  }
}

/**
 * Word arithmetic is modulo 2^d, so a word is reduced by masking its low d bits.
 * The attack in src/attack/ depends on this modulus being a power of two.
 */
// [extension] point: a prime-modulus instance would replace this mask with a
// reduction mod p (and widen the word type), and the one-bit recursion would
// no longer apply to it.
export function wordMask(d: number): number {
  return (1 << d) - 1;
}

export function reduceWord(x: number, d: number): number {
  return x & wordMask(d);
}

/**
 * The expansion H: the first 2·N bytes of the 2,048-byte BLAKE2Xb output of the
 * item, read as little-endian 16-bit words, each masked to d bits.
 */
// [extension] point: the expansion function. A different XOF (BLAKE3, SHAKE)
// or a different word width would be swapped in here and nowhere else.
export function expandItem(item: Uint8Array, N: number): Uint8Array {
  return blake2xbPrefix(item, EXPANSION_BYTES, 2 * N);
}

/** H(item) as N words modulo 2^d. */
export function hashItemWords(p: LtHashParams, item: Uint8Array): Uint32Array {
  checkParams(p);
  const bytes = expandItem(item, p.N);
  const words = new Uint32Array(p.N);
  for (let i = 0; i < p.N; i++) {
    // little-endian: low byte first
    words[i] = reduceWord(bytes[2 * i] | (bytes[2 * i + 1] << 8), p.d);
  }
  return words;
}

export function zeroDigest(p: LtHashParams): Uint32Array {
  checkParams(p);
  return new Uint32Array(p.N);
}

function sameLength(p: LtHashParams, a: Uint32Array, b: Uint32Array): void {
  if (a.length !== p.N || b.length !== p.N) {
    throw new RangeError(`digest has ${a.length !== p.N ? a.length : b.length} words, this instance needs ${p.N}`);
  }
}

/** Word-wise a + b modulo 2^d. */
export function addWords(p: LtHashParams, a: Uint32Array, b: Uint32Array): Uint32Array {
  sameLength(p, a, b);
  const out = new Uint32Array(p.N);
  for (let i = 0; i < p.N; i++) out[i] = reduceWord(a[i] + b[i], p.d);
  return out;
}

/** Word-wise a − b modulo 2^d. */
export function subWords(p: LtHashParams, a: Uint32Array, b: Uint32Array): Uint32Array {
  sameLength(p, a, b);
  const out = new Uint32Array(p.N);
  for (let i = 0; i < p.N; i++) out[i] = reduceWord(a[i] - b[i], p.d);
  return out;
}

export function wordsEqual(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The index of the first word where two digests differ, or −1 if none. */
export function firstDifference(a: Uint32Array, b: Uint32Array): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Digest of a list of items computed from scratch: Σ H(x). Order is irrelevant. */
export function digestOf(p: LtHashParams, items: readonly Uint8Array[]): Uint32Array {
  let acc = zeroDigest(p);
  for (const item of items) acc = addWords(p, acc, hashItemWords(p, item));
  return acc;
}

/** Serialize a digest as little-endian 16-bit words (2,048 bytes for the deployed instance). */
export function wordsToBytes(words: Uint32Array): Uint8Array {
  const out = new Uint8Array(words.length * 2);
  for (let i = 0; i < words.length; i++) {
    out[2 * i] = words[i] & 0xff;
    out[2 * i + 1] = (words[i] >>> 8) & 0xff;
  }
  return out;
}

/** Parse a digest from little-endian 16-bit words; fails closed on a wrong length. */
export function bytesToWords(p: LtHashParams, bytes: Uint8Array): Uint32Array {
  checkParams(p);
  if (bytes.length !== 2 * p.N) {
    throw new RangeError(`digest must be ${2 * p.N} bytes for N = ${p.N}, got ${bytes.length}`);
  }
  const words = new Uint32Array(p.N);
  for (let i = 0; i < p.N; i++) {
    const w = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    if (w !== reduceWord(w, p.d)) {
      throw new RangeError(`word ${i} is ${w}, which does not fit in ${p.d} bits`);
    }
    words[i] = w;
  }
  return words;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^(?:[0-9a-f]{2})*$/.test(clean)) {
    throw new RangeError('not a hex string of whole bytes');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export class DuplicateItemError extends Error {
  constructor(name: string) {
    super(`"${name}" is already in the set — in set mode an item can be added once; switch to multiset mode to add it again`);
    this.name = 'DuplicateItemError';
  }
}

export type Mode = 'set' | 'multiset';

export interface Entry {
  readonly name: string;
  readonly item: Uint8Array;
  /** Net count: adds minus removes. Negative means removed more often than added. */
  count: number;
}

/**
 * An incrementally maintained LtHash: adds add H(x), removes subtract it, and
 * `recomputeFromScratch()` is the independent check that the running digest
 * equals Σ count·H(x) over everything ever touched.
 *
 * Removing an item that was never added is ALLOWED, because the construction
 * cannot refuse it: subtraction is defined for every vector, the digest simply
 * moves, and no error is possible. The entry's count goes negative so the page
 * can say so.
 */
export class LtHash {
  readonly params: LtHashParams;
  readonly mode: Mode;
  /** Every hash this state asks for goes through the same counted interface the attack uses. */
  readonly oracle: HashOracle;
  private readonly entries = new Map<string, Entry>();
  private running: Uint32Array;

  constructor(params: LtHashParams, mode: Mode = 'set') {
    checkParams(params);
    this.params = params;
    this.mode = mode;
    this.oracle = new HashOracle(params);
    this.running = zeroDigest(params);
  }

  /** Calls to the expansion made on behalf of this state (adds and removes). */
  get queries(): number {
    return this.oracle.queries;
  }

  get digest(): Uint32Array {
    return this.running.slice();
  }

  list(): Entry[] {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }

  /** The items currently in the set (count exactly 1), in insertion order. */
  members(): Uint8Array[] {
    return [...this.entries.values()].filter((e) => e.count === 1).map((e) => e.item);
  }

  add(name: string): Uint32Array {
    const existing = this.entries.get(name);
    if (this.mode === 'set' && existing && existing.count >= 1) throw new DuplicateItemError(name);
    const item = existing?.item ?? utf8(name);
    const h = this.oracle.hash(item);
    this.running = addWords(this.params, this.running, h);
    if (existing) existing.count += 1;
    else this.entries.set(name, { name, item, count: 1 });
    return h;
  }

  remove(name: string): Uint32Array {
    const existing = this.entries.get(name);
    const item = existing?.item ?? utf8(name);
    const h = this.oracle.hash(item);
    this.running = subWords(this.params, this.running, h);
    if (existing) existing.count -= 1;
    else this.entries.set(name, { name, item, count: -1 });
    return h;
  }

  /** Σ count·H(x) over every entry, computed fresh — the check the running digest is compared against. */
  recomputeFromScratch(): Uint32Array {
    let acc = zeroDigest(this.params);
    for (const e of this.entries.values()) {
      const h = hashItemWords(this.params, e.item);
      const times = Math.abs(e.count);
      for (let k = 0; k < times; k++) acc = e.count > 0 ? addWords(this.params, acc, h) : subWords(this.params, acc, h);
    }
    return acc;
  }
}

/**
 * The hash interface the attack queries, with the counter the page reports.
 *
 * The counter counts CALLS. It does not sit behind a cache: an item queried
 * twice is two queries, because the question the count answers is "how many
 * times did the attack call the hash", and a cache in front of the counter
 * would answer a different question. `distinct` is the other number — how many
 * different items were asked about — so the page can show both.
 */
export class HashOracle {
  readonly params: LtHashParams;
  queries = 0;
  readonly distinct = new Set<string>();

  constructor(params: LtHashParams) {
    checkParams(params);
    this.params = params;
  }

  hash(item: Uint8Array): Uint32Array {
    const key = toHex(item);
    this.queries += 1;
    this.distinct.add(key);
    return hashItemWords(this.params, item);
  }
}
