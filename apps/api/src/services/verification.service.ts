import { createHmac } from 'node:crypto';
import sharp from 'sharp';
import type { Config } from '../config/index.js';
import { ensure } from '../lib/errors.js';
export const kinds = [
  'government_id',
  'business_registration',
  'proof_of_address',
  'drivers_licence',
  'vehicle_registration',
  'other',
] as const;
export const subjects = ['seller', 'driver'] as const;

/** Validates an upload as a real PDF or image; images are re-encoded to strip metadata. */
export async function normalizeDocument(file: Express.Multer.File) {
  if (file.mimetype === 'application/pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-')
    return { bytes: file.buffer, mime: 'application/pdf', ext: 'pdf' };
  const metadata = await sharp(file.buffer, { limitInputPixels: 30000000 })
    .metadata()
    .catch(() => null);
  ensure(
    metadata && ['jpeg', 'png', 'webp'].includes(metadata.format || ''),
    400,
    'INVALID_DOCUMENT',
    'Attach a JPEG, PNG, WebP or PDF file.',
  );
  const bytes = await sharp(file.buffer)
    .rotate()
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  return { bytes, mime: 'image/webp', ext: 'webp' };
}

export function signedLink(c: Config, id: string) {
  const expires = Date.now() + 60000;
  const sig = createHmac('sha256', c.otpSecret).update(`doc:${id}:${expires}`).digest('hex');
  return `${c.publicApiUrl.replace(/\/$/, '')}/files/seller-documents/${id}?expires=${expires}&sig=${sig}`;
}

/** Short-lived signed download links for locally stored documents (admins only obtain them). */
