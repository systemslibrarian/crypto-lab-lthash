/**
 * BLAKE2Xb: the BLAKE2X extendable-output construction over BLAKE2b, in the
 * parameterisation Folly's `folly/crypto/Blake2xb.cpp` uses (which is what the
 * LtHash reference checksum was produced with):
 *
 *   root  H0 = BLAKE2b(message; digest 64, fanout 1, depth 1, xofLength = L)
 *   block i  = BLAKE2b(H0; digest min(64, L − 64·i), fanout 0, depth 0,
 *                      leafLength 64, nodeOffset i, xofLength = L,
 *                      nodeDepth 0, innerLength 64)
 *   output   = block 0 ‖ block 1 ‖ … (L bytes in all)
 *
 * The node offset is what makes every output block different: with it fixed at
 * zero every block would be a copy of the first, which is mutation (4) in this
 * lab's ledger, and the Folly vector — 32 blocks long — catches it.
 */
import { blake2b, MAX_DIGEST_BYTES } from './blake2b';

/** Folly's limit: the XOF length field is 32 bits, with 0xffffffff reserved for "unknown". */
export const MAX_XOF_BYTES = 0xfffffffe;

function rootHash(message: Uint8Array, xofLength: number): Uint8Array {
  if (!Number.isInteger(xofLength) || xofLength < 1 || xofLength > MAX_XOF_BYTES) {
    throw new RangeError(`BLAKE2Xb output length must be 1..${MAX_XOF_BYTES} bytes, got ${xofLength}`);
  }
  return blake2b(message, { digestLength: MAX_DIGEST_BYTES, fanout: 1, depth: 1, xofLength });
}

function outputBlock(h0: Uint8Array, xofLength: number, index: number): Uint8Array {
  const remaining = xofLength - index * MAX_DIGEST_BYTES;
  return blake2b(h0, {
    digestLength: Math.min(MAX_DIGEST_BYTES, remaining),
    fanout: 0,
    depth: 0,
    leafLength: MAX_DIGEST_BYTES,
    nodeOffset: index,
    xofLength,
    nodeDepth: 0,
    innerLength: MAX_DIGEST_BYTES,
  });
}

/**
 * The first `prefixBytes` bytes of the `xofLength`-byte BLAKE2Xb output of
 * `message`, computing only the output blocks those bytes fall in. This is how
 * a reduced-size LtHash instance is derived from the deployed expansion: it
 * reads the first N words of the SAME 2,048-byte expansion rather than a
 * different hash, so a reduced instance is a projection of the real one.
 */
export function blake2xbPrefix(message: Uint8Array, xofLength: number, prefixBytes: number): Uint8Array {
  if (!Number.isInteger(prefixBytes) || prefixBytes < 1 || prefixBytes > xofLength) {
    throw new RangeError(`prefix must be 1..${xofLength} bytes, got ${prefixBytes}`);
  }
  const h0 = rootHash(message, xofLength);
  const blocks = Math.ceil(prefixBytes / MAX_DIGEST_BYTES);
  const out = new Uint8Array(blocks * MAX_DIGEST_BYTES);
  for (let i = 0; i < blocks; i++) out.set(outputBlock(h0, xofLength, i), i * MAX_DIGEST_BYTES);
  return out.slice(0, prefixBytes);
}

/** The full `xofLength`-byte BLAKE2Xb output of `message`. */
export function blake2xb(message: Uint8Array, xofLength: number): Uint8Array {
  return blake2xbPrefix(message, xofLength, xofLength);
}
