/**
 * BLAKE2b (RFC 7693), hand-rolled with an exposed parameter block.
 *
 * Why not WebCrypto or a library: the browser's SubtleCrypto has no BLAKE2, and
 * the stock BLAKE2b APIs hide the parameter block, while BLAKE2Xb — the
 * extendable-output mode LtHash uses to turn one item into 2,048 bytes — is
 * nothing BUT parameter-block fields: the XOF length in bytes 12–15 of the root
 * hash, and per output block a node offset, a leaf length, an inner length and
 * a digest length. So the compression function and the parameter block are
 * written out here, and the tests pin them to the RFC 7693 Appendix A vector,
 * to Node's own BLAKE2b-512 on long messages, and (through blake2xb.ts) to the
 * Folly reference checksum.
 *
 * 64-bit words are carried as (lo, hi) pairs of unsigned 32-bit integers, the
 * only fast representation JavaScript offers: index 2i holds the low half of
 * word i and 2i + 1 the high half.
 */

const IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667, // 0x6a09e667f3bcc908
  0x84caa73b, 0xbb67ae85, // 0xbb67ae8584caa73b
  0xfe94f82b, 0x3c6ef372, // 0x3c6ef372fe94f82b
  0x5f1d36f1, 0xa54ff53a, // 0xa54ff53a5f1d36f1
  0xade682d1, 0x510e527f, // 0x510e527fade682d1
  0x2b3e6c1f, 0x9b05688c, // 0x9b05688c2b3e6c1f
  0xfb41bd6b, 0x1f83d9ab, // 0x1f83d9abfb41bd6b
  0x137e2179, 0x5be0cd19, // 0x5be0cd19137e2179
]);

const SIGMA: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

export const BLOCK_BYTES = 128;
export const MAX_DIGEST_BYTES = 64;

/** The BLAKE2b parameter block fields this lab needs (RFC 7693 §2.5, BLAKE2X). */
export interface Blake2bParams {
  /** Output length in bytes, 1..64. */
  digestLength: number;
  /** Tree fanout; 1 for sequential hashing, 0 for a BLAKE2X output block. */
  fanout?: number;
  /** Tree depth; 1 for sequential hashing, 0 for a BLAKE2X output block. */
  depth?: number;
  /** Leaf maximal byte length (bytes 4–7). */
  leafLength?: number;
  /** Node offset (bytes 8–11): the output block index in BLAKE2X. */
  nodeOffset?: number;
  /** XOF digest length (bytes 12–15): the total BLAKE2X output length. */
  xofLength?: number;
  /** Node depth (byte 16). */
  nodeDepth?: number;
  /** Inner hash byte length (byte 17); 64 for a BLAKE2Xb output block. */
  innerLength?: number;
}

/** Serialize the 64-byte parameter block in the layout Folly's Blake2xbParam uses. */
export function parameterBlock(p: Blake2bParams): Uint8Array {
  if (!Number.isInteger(p.digestLength) || p.digestLength < 1 || p.digestLength > MAX_DIGEST_BYTES) {
    throw new RangeError(`BLAKE2b digest length must be 1..64 bytes, got ${p.digestLength}`);
  }
  const block = new Uint8Array(64);
  const view = new DataView(block.buffer);
  block[0] = p.digestLength;
  block[1] = 0; // key length: keyed mode is a non-goal of this lab
  block[2] = p.fanout ?? 1;
  block[3] = p.depth ?? 1;
  view.setUint32(4, p.leafLength ?? 0, true);
  view.setUint32(8, p.nodeOffset ?? 0, true);
  view.setUint32(12, p.xofLength ?? 0, true);
  block[16] = p.nodeDepth ?? 0;
  block[17] = p.innerLength ?? 0;
  // bytes 18–31 reserved, 32–47 salt, 48–63 personalization: all zero here
  return block;
}

/** One 64-bit addition of up to three (lo, hi) operands, written into v at word index a. */
function add3(v: Uint32Array, a: number, b: number, xlo: number, xhi: number): void {
  const lo = v[2 * a] + v[2 * b] + xlo;
  const hi = v[2 * a + 1] + v[2 * b + 1] + xhi + Math.floor(lo / 4294967296);
  v[2 * a] = lo >>> 0;
  v[2 * a + 1] = hi >>> 0;
}

/** The BLAKE2b mixing function G (RFC 7693 §3.1), on word indices into v. */
function G(v: Uint32Array, a: number, b: number, c: number, d: number, xlo: number, xhi: number, ylo: number, yhi: number): void {
  add3(v, a, b, xlo, xhi);
  // d = rotr64(d ^ a, 32): swap the halves
  let dlo = (v[2 * d] ^ v[2 * a]) >>> 0;
  let dhi = (v[2 * d + 1] ^ v[2 * a + 1]) >>> 0;
  v[2 * d] = dhi;
  v[2 * d + 1] = dlo;
  add3(v, c, d, 0, 0);
  // b = rotr64(b ^ c, 24)
  let blo = (v[2 * b] ^ v[2 * c]) >>> 0;
  let bhi = (v[2 * b + 1] ^ v[2 * c + 1]) >>> 0;
  v[2 * b] = ((blo >>> 24) | (bhi << 8)) >>> 0;
  v[2 * b + 1] = ((bhi >>> 24) | (blo << 8)) >>> 0;
  add3(v, a, b, ylo, yhi);
  // d = rotr64(d ^ a, 16)
  dlo = (v[2 * d] ^ v[2 * a]) >>> 0;
  dhi = (v[2 * d + 1] ^ v[2 * a + 1]) >>> 0;
  v[2 * d] = ((dlo >>> 16) | (dhi << 16)) >>> 0;
  v[2 * d + 1] = ((dhi >>> 16) | (dlo << 16)) >>> 0;
  add3(v, c, d, 0, 0);
  // b = rotr64(b ^ c, 63) == rotl64(b ^ c, 1)
  blo = (v[2 * b] ^ v[2 * c]) >>> 0;
  bhi = (v[2 * b + 1] ^ v[2 * c + 1]) >>> 0;
  v[2 * b] = ((blo << 1) | (bhi >>> 31)) >>> 0;
  v[2 * b + 1] = ((bhi << 1) | (blo >>> 31)) >>> 0;
}

/**
 * The compression function F (RFC 7693 §3.2).
 * `h` is the 8-word state as 16 u32 halves; `m` the 16-word block as 32 u32
 * halves; `t` the byte counter (this lab never hashes 2^32 bytes, so its high
 * 64 bits are zero); `last` sets the finalization flag f0.
 */
export function compress(h: Uint32Array, m: Uint32Array, tLo: number, tHi: number, last: boolean): void {
  const v = new Uint32Array(32);
  v.set(h, 0);
  v.set(IV, 16);
  v[24] = (v[24] ^ tLo) >>> 0;
  v[25] = (v[25] ^ tHi) >>> 0;
  if (last) {
    v[28] = (v[28] ^ 0xffffffff) >>> 0;
    v[29] = (v[29] ^ 0xffffffff) >>> 0;
  }
  for (let r = 0; r < 12; r++) {
    const s = SIGMA[r % 10];
    G(v, 0, 4, 8, 12, m[2 * s[0]], m[2 * s[0] + 1], m[2 * s[1]], m[2 * s[1] + 1]);
    G(v, 1, 5, 9, 13, m[2 * s[2]], m[2 * s[2] + 1], m[2 * s[3]], m[2 * s[3] + 1]);
    G(v, 2, 6, 10, 14, m[2 * s[4]], m[2 * s[4] + 1], m[2 * s[5]], m[2 * s[5] + 1]);
    G(v, 3, 7, 11, 15, m[2 * s[6]], m[2 * s[6] + 1], m[2 * s[7]], m[2 * s[7] + 1]);
    G(v, 0, 5, 10, 15, m[2 * s[8]], m[2 * s[8] + 1], m[2 * s[9]], m[2 * s[9] + 1]);
    G(v, 1, 6, 11, 12, m[2 * s[10]], m[2 * s[10] + 1], m[2 * s[11]], m[2 * s[11] + 1]);
    G(v, 2, 7, 8, 13, m[2 * s[12]], m[2 * s[12] + 1], m[2 * s[13]], m[2 * s[13] + 1]);
    G(v, 3, 4, 9, 14, m[2 * s[14]], m[2 * s[14] + 1], m[2 * s[15]], m[2 * s[15] + 1]);
  }
  for (let i = 0; i < 16; i++) h[i] = (h[i] ^ v[i] ^ v[i + 16]) >>> 0;
}

/** Initialize the state from a parameter block: h[i] = IV[i] XOR P[i]. */
export function initialState(params: Blake2bParams): Uint32Array {
  const p = parameterBlock(params);
  const view = new DataView(p.buffer);
  const h = new Uint32Array(16);
  for (let i = 0; i < 16; i++) h[i] = (IV[i] ^ view.getUint32(4 * i, true)) >>> 0;
  return h;
}

/** Hash `data` with the given parameter block. Unkeyed: keyed mode is out of scope. */
export function blake2b(data: Uint8Array, params: Blake2bParams): Uint8Array {
  if (data.length >= 4294967296) throw new RangeError('message too long for this implementation');
  const h = initialState(params);
  const m = new Uint32Array(32);
  const block = new Uint8Array(BLOCK_BYTES);
  const view = new DataView(block.buffer);
  const blocks = data.length === 0 ? 1 : Math.ceil(data.length / BLOCK_BYTES);
  for (let i = 0; i < blocks; i++) {
    const start = i * BLOCK_BYTES;
    const chunk = data.subarray(start, Math.min(start + BLOCK_BYTES, data.length));
    block.fill(0);
    block.set(chunk, 0);
    for (let w = 0; w < 32; w++) m[w] = view.getUint32(4 * w, true);
    const counted = start + chunk.length; // bytes hashed so far, including this block
    compress(h, m, counted >>> 0, Math.floor(counted / 4294967296) >>> 0, i === blocks - 1);
  }
  const out = new Uint8Array(64);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) ov.setUint32(4 * i, h[i], true);
  return out.slice(0, params.digestLength);
}

/** Plain BLAKE2b-512 of `data`: digest 64, fanout 1, depth 1, every other field zero. */
export function blake2b512(data: Uint8Array): Uint8Array {
  return blake2b(data, { digestLength: 64 });
}
