import type { AttachmentType } from '../domain/index.js';

/** sha-256 as lowercase hex (Web Crypto: works in Node 20+, Vercel and browsers). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  sig.every((x, i) => b[offset + i] === x);

/** Detect the real file type from its magic bytes (never trust the declared type). */
export function sniffType(b: Uint8Array): AttachmentType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}
