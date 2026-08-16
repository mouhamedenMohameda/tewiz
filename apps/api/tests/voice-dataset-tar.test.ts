import { describe, expect, it } from 'vitest';
import { tarAppend, tarFinalize, type ByteSink } from '../src/modules/voice-dataset/tar.js';

/**
 * The dataset export writes its own ustar archive (no archiver dependency
 * exists in this app). Hand-rolled binary formats fail silently — a wrong
 * checksum or a missed pad block produces a file that looks fine until someone
 * runs `tar -xf` on a 300-sample export weeks later — so the header fields and
 * the block alignment are asserted directly here.
 */

const BLOCK = 512;

function collect(): { sink: ByteSink; bytes: () => Buffer } {
  const chunks: Buffer[] = [];
  return {
    sink: { write: (c: Buffer) => chunks.push(c) },
    bytes: () => Buffer.concat(chunks),
  };
}

/** Read a NUL/space-terminated ASCII field, the way tar readers do. */
function field(buf: Buffer, offset: number, length: number): string {
  return buf.subarray(offset, offset + length).toString('ascii').replace(/[\0 ]+$/, '');
}

/** Recompute the header checksum with the checksum field read as spaces. */
function computeChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  }
  return sum;
}

describe('voice-dataset tar writer', () => {
  it('writes a ustar header the checksum validates', () => {
    const { sink, bytes } = collect();
    tarAppend(sink, 'manifest.jsonl', Buffer.from('{"id":"a"}\n', 'utf8'));

    const header = bytes().subarray(0, BLOCK);
    expect(field(header, 0, 100)).toBe('manifest.jsonl');
    expect(field(header, 257, 6)).toBe('ustar');
    expect(header.subarray(156, 157).toString('ascii')).toBe('0'); // regular file
    expect(parseInt(field(header, 124, 12), 8)).toBe(11); // size, octal

    const stored = parseInt(field(header, 148, 8), 8);
    expect(stored).toBe(computeChecksum(header));
  });

  it('pads each entry to a whole number of 512-byte blocks', () => {
    // 1000 bytes spans two blocks with 24 bytes of padding — the case a
    // naive implementation gets wrong.
    const { sink, bytes } = collect();
    tarAppend(sink, 'audio/a.m4a', Buffer.alloc(1000, 0x42));

    const out = bytes();
    expect(out.length).toBe(BLOCK * 3); // header + 2 data blocks
    // Padding must be zeroes, not leftover payload.
    expect(out.subarray(BLOCK + 1000)).toEqual(Buffer.alloc(BLOCK * 2 - 1000));
  });

  it('adds no padding when the payload is exactly one block', () => {
    const { sink, bytes } = collect();
    tarAppend(sink, 'audio/a.m4a', Buffer.alloc(BLOCK, 0x41));
    expect(bytes().length).toBe(BLOCK * 2);
  });

  it('handles an empty entry', () => {
    const { sink, bytes } = collect();
    tarAppend(sink, 'audio/empty.m4a', Buffer.alloc(0));
    expect(bytes().length).toBe(BLOCK);
  });

  it('closes the archive with two zero blocks', () => {
    // Without them `tar` reports an unexpected end of file, so this must hold
    // even when the dataset is empty.
    const { sink, bytes } = collect();
    tarFinalize(sink);
    expect(bytes()).toEqual(Buffer.alloc(BLOCK * 2));
  });

  it('rejects a name too long for the ustar name field', () => {
    const { sink } = collect();
    expect(() => tarAppend(sink, `audio/${'x'.repeat(200)}.m4a`, Buffer.alloc(0)))
      .toThrow(/name too long/);
  });

  it('lays entries out back to back so a reader can walk them', () => {
    const { sink, bytes } = collect();
    tarAppend(sink, 'manifest.jsonl', Buffer.from('ab', 'utf8'));
    tarAppend(sink, 'audio/b.m4a', Buffer.alloc(600, 0x43));
    tarFinalize(sink);

    const out = bytes();
    // entry 1: header + 1 block; entry 2: header + 2 blocks; trailer: 2 blocks
    expect(out.length).toBe(BLOCK * (1 + 1 + 1 + 2 + 2));

    const second = out.subarray(BLOCK * 2, BLOCK * 3);
    expect(field(second, 0, 100)).toBe('audio/b.m4a');
    expect(parseInt(field(second, 124, 12), 8)).toBe(600);
    expect(parseInt(field(second, 148, 8), 8)).toBe(computeChecksum(second));
  });
});
