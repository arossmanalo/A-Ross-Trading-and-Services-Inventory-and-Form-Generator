export type ZipEntry = {
  path: string;
  data: string | Uint8Array;
};

export type StoredZipArchive = ReadonlyMap<string, Uint8Array>;

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function createStoredZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const paths = new Set<string>();
  let offset = 0;

  for (const entry of entries) {
    assertZipPath(entry.path);
    if (paths.has(entry.path)) throw new Error(`Duplicate ZIP entry: ${entry.path}`);
    paths.add(entry.path);
    const name = utf8(entry.path);
    const data = typeof entry.data === 'string' ? utf8(entry.data) : entry.data;
    const crc = crc32(data);
    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]);
    localParts.push(localHeader, data);
    centralParts.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += localHeader.length + data.length;
  }

  const centralOffset = offset;
  const central = concat(centralParts);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(centralOffset), u16(0),
  ]);
  return concat([...localParts, central, end]);
}

/**
 * Reads the intentionally simple ZIP format emitted by createStoredZip.
 * Compression and encryption are rejected so restore never silently accepts
 * a package that this offline app cannot fully validate.
 */
export function readStoredZip(bytes: Uint8Array): StoredZipArchive {
  const endOffset = findEndOfCentralDirectory(bytes);
  const entryCount = readU16(bytes, endOffset + 10);
  const centralSize = readU32(bytes, endOffset + 12);
  const centralOffset = readU32(bytes, endOffset + 16);
  if (centralOffset + centralSize > endOffset || entryCount > 10000) throw new Error('Backup ZIP directory is invalid.');

  const entries = new Map<string, Uint8Array>();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, cursor) !== 0x02014b50) throw new Error('Backup ZIP central directory is invalid.');
    const flags = readU16(bytes, cursor + 8);
    const method = readU16(bytes, cursor + 10);
    const crc = readU32(bytes, cursor + 16);
    const compressedSize = readU32(bytes, cursor + 20);
    const uncompressedSize = readU32(bytes, cursor + 24);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const localOffset = readU32(bytes, cursor + 42);
    const name = decodeUtf8(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (flags !== 0 || method !== 0 || compressedSize !== uncompressedSize) throw new Error(`Unsupported ZIP entry: ${name || '(unnamed)'}`);
    assertZipPath(name);
    if (entries.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);

    if (readU32(bytes, localOffset) !== 0x04034b50) throw new Error(`ZIP local header is invalid: ${name}`);
    if (readU16(bytes, localOffset + 6) !== flags || readU16(bytes, localOffset + 8) !== method || readU32(bytes, localOffset + 14) !== crc || readU32(bytes, localOffset + 18) !== compressedSize || readU32(bytes, localOffset + 22) !== uncompressedSize) {
      throw new Error(`ZIP local header does not match central directory: ${name}`);
    }
    const localNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const localName = decodeUtf8(bytes.slice(localOffset + 30, localOffset + 30 + localNameLength));
    if (localName !== name) throw new Error(`ZIP entry names do not match: ${name}`);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + uncompressedSize;
    if (dataEnd > bytes.length) throw new Error(`ZIP entry is truncated: ${name}`);
    const data = bytes.slice(dataStart, dataEnd);
    if (crc32(data) !== crc) throw new Error(`ZIP checksum mismatch: ${name}`);
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralOffset + centralSize) throw new Error('Backup ZIP directory length is invalid.');
  return entries;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const value = (a << 16) | (b << 8) | c;
    out += alphabet[(value >>> 18) & 63];
    out += alphabet[(value >>> 12) & 63];
    out += index + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=';
    out += index + 2 < bytes.length ? alphabet[value & 63] : '=';
  }
  return out;
}

export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/\s/g, '');
  if (!clean || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('Invalid base64 data.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const chunk = clean.slice(index, index + 4);
    if (chunk.length !== 4 || (chunk.includes('=') && index + 4 !== clean.length)) throw new Error('Invalid base64 data.');
    const nums = chunk.split('').map(char => char === '=' ? 0 : alphabet.indexOf(char));
    if (nums.some(num => num < 0)) throw new Error('Invalid base64 data.');
    const merged = (nums[0] << 18) | (nums[1] << 12) | (nums[2] << 6) | nums[3];
    bytes.push((merged >>> 16) & 255);
    if (chunk[2] !== '=') bytes.push((merged >>> 8) & 255);
    if (chunk[3] !== '=') bytes.push(merged & 255);
  }
  return new Uint8Array(bytes);
}

function assertZipPath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('..')) throw new Error('Backup entry path is invalid.');
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (readU32(bytes, offset) === 0x06054b50) {
      const commentLength = readU16(bytes, offset + 20);
      if (offset + 22 + commentLength === bytes.length) return offset;
    }
  }
  throw new Error('Backup ZIP end record is missing.');
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new Error('Backup ZIP is truncated.');
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error('Backup ZIP is truncated.');
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
