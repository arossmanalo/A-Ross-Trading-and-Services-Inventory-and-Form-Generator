import { describe, expect, it } from 'vitest';

import { base64ToBytes, bytesToBase64, createStoredZip, readStoredZip } from '@/features/backup/zip';

describe('stored zip writer', () => {
  it('creates a zip with local headers, central directory, and base64 round trip', () => {
    const zip = createStoredZip([
      { path: 'manifest.json', data: '{"ok":true}' },
      { path: 'data/settings.json', data: '[]' },
    ]);
    const bytes = Array.from(zip);
    expect(bytes.slice(0, 4)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(bytes.filter((byte, index) => byte === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x01 && bytes[index + 3] === 0x02)).toHaveLength(2);
    expect(base64ToBytes(bytesToBase64(zip))).toEqual(zip);
  });

  it('rejects unsafe entry paths and invalid base64', () => {
    expect(() => createStoredZip([{ path: '../bad.json', data: '{}' }])).toThrow(/entry path/);
    expect(() => createStoredZip([{ path: '/bad.json', data: '{}' }])).toThrow(/entry path/);
    expect(() => createStoredZip([{ path: 'same.json', data: '{}' }, { path: 'same.json', data: '{}' }])).toThrow(/Duplicate/);
    expect(() => base64ToBytes('!!!!')).toThrow(/base64/);
  });

  it('rejects encrypted and compressed entries', () => {
    const compressed = createStoredZip([{ path: 'data.json', data: '{}' }]);
    const centralOffset = findSignature(compressed, [0x50, 0x4b, 0x01, 0x02]);
    compressed[centralOffset + 10] = 8;
    expect(() => readStoredZip(compressed)).toThrow(/Unsupported ZIP entry/);

    const encrypted = createStoredZip([{ path: 'data.json', data: '{}' }]);
    const encryptedCentralOffset = findSignature(encrypted, [0x50, 0x4b, 0x01, 0x02]);
    encrypted[encryptedCentralOffset + 8] = 1;
    expect(() => readStoredZip(encrypted)).toThrow(/Unsupported ZIP entry/);
  });

  it('reads the stored archive and verifies entry checksums', () => {
    const zip = createStoredZip([
      { path: 'manifest.json', data: '{"ok":true}' },
      { path: 'assets/signed.pdf', data: new Uint8Array([0, 1, 2, 255]) },
    ]);
    const entries = readStoredZip(zip);
    expect(new TextDecoder().decode(entries.get('manifest.json'))).toBe('{"ok":true}');
    expect(Array.from(entries.get('assets/signed.pdf') ?? [])).toEqual([0, 1, 2, 255]);
  });

  it('rejects a tampered archive', () => {
    const zip = createStoredZip([{ path: 'manifest.json', data: '{}' }]);
    zip[14] ^= 1;
    expect(() => readStoredZip(zip)).toThrow(/checksum|directory|truncated/i);
  });
});

function findSignature(bytes: Uint8Array, signature: number[]): number {
  for (let index = 0; index <= bytes.length - signature.length; index += 1) {
    if (signature.every((value, offset) => bytes[index + offset] === value)) return index;
  }
  throw new Error('Signature not found in test ZIP.');
}
