import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { blake2b, blake2b512, parameterBlock } from './blake2b';
import kats from './hashlib-kats.json';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Node's OpenSSL-backed BLAKE2b-512: the independent second route for check B. */
const nodeBlake2b512 = (data: Uint8Array): string => createHash('blake2b512').update(data).digest('hex');

describe('BLAKE2b (RFC 7693)', () => {
  it('matches the RFC 7693 Appendix A vector for "abc"', () => {
    // RFC 7693, Appendix A, "BLAKE2b-512 of the ASCII string 'abc'", written here from the RFC.
    expect(hex(blake2b512(utf8('abc')))).toBe(
      'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1' +
        '7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
    );
  });

  it('agrees with an independent BLAKE2b-512 (node:crypto) on the empty message', () => {
    expect(hex(blake2b512(new Uint8Array(0)))).toBe(nodeBlake2b512(new Uint8Array(0)));
  });

  it('agrees with node:crypto on messages longer than one 128-byte block', () => {
    // Check B: a single short vector is not sufficient; these cross the block boundary.
    for (const len of [127, 128, 129, 255, 256, 257, 300, 1000, 4096, 10_000]) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = (i * 131 + 7) & 0xff;
      expect(hex(blake2b512(data)), `length ${len}`).toBe(nodeBlake2b512(data));
    }
  });

  it('agrees with node:crypto across a sweep of random lengths', () => {
    let seed = 0x9e3779b9;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    for (let round = 0; round < 40; round++) {
      const len = next() % 700;
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = next() & 0xff;
      expect(hex(blake2b512(data)), `random length ${len}`).toBe(nodeBlake2b512(data));
    }
  });

  it('reproduces Python hashlib vectors for short digests and tree parameters', () => {
    // Generated 2026-11-15 by hashlib.blake2b (a third implementation), see hashlib-kats.json.
    for (const k of kats) {
      const p = k.params as Record<string, number>;
      const out = blake2b(Buffer.from(k.data, 'hex'), {
        digestLength: p.digest_size,
        fanout: p.fanout,
        depth: p.depth,
        leafLength: p.leaf_size,
        nodeOffset: p.node_offset,
        nodeDepth: p.node_depth,
        innerLength: p.inner_size,
      });
      expect(hex(out), k.label).toBe(k.digest);
    }
  });

  it('lays the parameter block out as Folly does: digest, key, fanout, depth, leaf, offset, xof, node depth, inner', () => {
    const p = parameterBlock({
      digestLength: 64,
      fanout: 0,
      depth: 0,
      leafLength: 64,
      nodeOffset: 5,
      xofLength: 2048,
      nodeDepth: 0,
      innerLength: 64,
    });
    expect(p.length).toBe(64);
    expect([...p.slice(0, 4)]).toEqual([64, 0, 0, 0]);
    expect([...p.slice(4, 8)]).toEqual([64, 0, 0, 0]); // leafLength LE
    expect([...p.slice(8, 12)]).toEqual([5, 0, 0, 0]); // nodeOffset LE
    expect([...p.slice(12, 16)]).toEqual([0x00, 0x08, 0, 0]); // xofLength 2048 LE
    expect(p[16]).toBe(0);
    expect(p[17]).toBe(64);
    expect(p.slice(18).every((b) => b === 0)).toBe(true);
  });

  it('refuses a digest length outside 1..64', () => {
    expect(() => blake2b(utf8('x'), { digestLength: 0 })).toThrow(/1\.\.64/);
    expect(() => blake2b(utf8('x'), { digestLength: 65 })).toThrow(/1\.\.64/);
  });
});
