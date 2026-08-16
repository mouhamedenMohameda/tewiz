/**
 * Minimal POSIX (ustar) tar writer.
 *
 * The dataset export is one JSONL manifest plus a few hundred audio files, and
 * handing that over as a single download is the difference between an export
 * someone uses and one they script around. No archiver dependency exists in
 * this app, and tar is simple enough — fixed 512-byte headers, octal numeric
 * fields, two zero blocks to close — that adding one to produce it would cost
 * more than writing it.
 *
 * tar rather than zip because zip's central directory has to be written after
 * every entry, which means either buffering the whole archive or seeking; tar
 * entries are self-describing and stream straight out. `tar -xf` reads this on
 * macOS, Linux and Windows 10+.
 *
 * Scope: regular files only, names under 100 bytes (sample ids are UUIDs, so
 * `audio/<uuid>.m4a` is 42), sizes under 8 GB. Anything outside that throws
 * rather than emitting a subtly malformed archive.
 */

const BLOCK = 512;
const NAME_MAX = 100;
/** Largest size representable in an 11-digit octal field. */
const SIZE_MAX = 0o77777777777;

/** Octal, zero-padded, NUL-terminated — the ustar convention for numbers. */
function writeOctal(buf: Buffer, value: number, offset: number, length: number): void {
  const digits = value.toString(8).padStart(length - 1, '0');
  buf.write(`${digits}\0`, offset, length, 'ascii');
}

function header(name: string, size: number, mtime: Date): Buffer {
  const nameBytes = Buffer.byteLength(name, 'utf8');
  if (nameBytes > NAME_MAX) {
    throw new Error(`tar: entry name too long (${nameBytes} > ${NAME_MAX}): ${name}`);
  }
  if (size > SIZE_MAX) {
    throw new Error(`tar: entry too large (${size} bytes): ${name}`);
  }

  const buf = Buffer.alloc(BLOCK);
  buf.write(name, 0, NAME_MAX, 'utf8');
  writeOctal(buf, 0o644, 100, 8);              // mode
  writeOctal(buf, 0, 108, 8);                  // uid
  writeOctal(buf, 0, 116, 8);                  // gid
  writeOctal(buf, size, 124, 12);              // size
  writeOctal(buf, Math.floor(mtime.getTime() / 1000), 136, 12);
  buf.write('0', 156, 1, 'ascii');             // typeflag: regular file
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');

  // The checksum is computed with its own field read as eight spaces, then
  // written back as six octal digits, NUL, space. Fill before summing.
  buf.write('        ', 148, 8, 'ascii');
  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');

  return buf;
}

/** Zero padding that rounds an entry's data up to a whole number of blocks. */
function padding(size: number): Buffer {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder);
}

/**
 * Sink for archive bytes — `res.write` from an Express response satisfies it,
 * so a large export never has to exist in memory all at once.
 */
export interface ByteSink {
  write(chunk: Buffer): unknown;
}

/** Append one regular file to the archive. */
export function tarAppend(sink: ByteSink, name: string, data: Buffer, mtime = new Date()): void {
  sink.write(header(name, data.length, mtime));
  sink.write(data);
  const pad = padding(data.length);
  if (pad.length > 0) sink.write(pad);
}

/**
 * Close the archive: two zero blocks. Without them `tar` reports an
 * unexpected end of file, so this must run even on the empty-dataset path.
 */
export function tarFinalize(sink: ByteSink): void {
  sink.write(Buffer.alloc(BLOCK * 2));
}
