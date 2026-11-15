import { describe, expect, it } from 'vitest';
import { blake2b } from './blake2b';
import { blake2xb, blake2xbPrefix } from './blake2xb';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

describe('BLAKE2Xb (Folly parameterisation)', () => {
  it('a prefix is a prefix of the full output', () => {
    const full = blake2xb(utf8('hello'), 2048);
    expect(full.length).toBe(2048);
    for (const n of [1, 2, 63, 64, 65, 128, 200, 2047, 2048]) {
      expect(hex(blake2xbPrefix(utf8('hello'), 2048, n)), `prefix ${n}`).toBe(hex(full.slice(0, n)));
    }
  });

  it('every output block differs from every other (the node offset is live)', () => {
    const full = blake2xb(utf8('a'), 2048);
    const blocks = new Set<string>();
    for (let i = 0; i < 32; i++) blocks.add(hex(full.slice(64 * i, 64 * i + 64)));
    expect(blocks.size).toBe(32);
  });

  it('the output length is part of the root hash, so different lengths do not share a prefix', () => {
    expect(hex(blake2xbPrefix(utf8('a'), 2048, 64))).not.toBe(hex(blake2xbPrefix(utf8('a'), 1024, 64)));
  });

  it('a non-multiple-of-64 length ends with a shorter final block', () => {
    const out = blake2xb(utf8('abc'), 100);
    expect(out.length).toBe(100);
    expect(hex(out.slice(0, 64))).toBe(hex(blake2xb(utf8('abc'), 100).slice(0, 64)));
  });

  it('block 0 equals BLAKE2b of the root hash with the documented parameter block', () => {
    const xof = 2048;
    const h0 = blake2b(utf8('hello'), { digestLength: 64, fanout: 1, depth: 1, xofLength: xof });
    const block0 = blake2b(h0, {
      digestLength: 64,
      fanout: 0,
      depth: 0,
      leafLength: 64,
      nodeOffset: 0,
      xofLength: xof,
      nodeDepth: 0,
      innerLength: 64,
    });
    expect(hex(blake2xbPrefix(utf8('hello'), xof, 64))).toBe(hex(block0));
  });

  it('refuses nonsense lengths', () => {
    expect(() => blake2xb(utf8('a'), 0)).toThrow(RangeError);
    expect(() => blake2xbPrefix(utf8('a'), 64, 65)).toThrow(RangeError);
    expect(() => blake2xbPrefix(utf8('a'), 64, 0)).toThrow(RangeError);
  });
});
