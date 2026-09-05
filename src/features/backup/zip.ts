export type ZipEntry = {
  path: string;
  data: string | Uint8Array;
};

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function createStoredZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    assertZipPath(entry.path);
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
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const chunk = clean.slice(index, index + 4);
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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
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
