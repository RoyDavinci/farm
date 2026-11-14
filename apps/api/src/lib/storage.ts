import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Config } from '../config/index.js';
import { ensure } from './errors.js';
export function storage(c: Config) {
  const s3 = new S3Client({ region: c.s3Region });
  function details(key: string, records: boolean) {
    ensure(
      !key.includes('..') && /^[a-zA-Z0-9_./-]+$/.test(key),
      400,
      'INVALID_STORAGE_KEY',
      'Invalid storage key.',
    );
    const bucket = records ? c.recordsBucket : c.s3Bucket;
    return {
      bucket,
      objectKey: `${c.s3Prefix}/${key}`,
      local: resolve(c.uploadDir, records ? 'private' : 'public', key),
    };
  }
  return {
    provider(records = false) {
      return records ? c.recordsStorageProvider : c.storageProvider;
    },
    async put(key: string, body: Buffer, mime: string, records = false) {
      const d = details(key, records);
      if (this.provider(records) === 's3') {
        ensure(d.bucket, 503, 'STORAGE_NOT_CONFIGURED', 'S3 bucket is not configured.');
        await s3.send(
          new PutObjectCommand({
            Bucket: d.bucket,
            Key: d.objectKey,
            Body: body,
            ContentType: mime,
            ServerSideEncryption: 'AES256',
          }),
        );
      } else {
        await mkdir(dirname(d.local), { recursive: true, mode: records ? 0o700 : 0o755 });
        await writeFile(d.local, body, { mode: records ? 0o600 : 0o644 });
      }
    },
    async read(key: string, provider: string, records = false) {
      const d = details(key, records);
      if (provider === 's3') {
        ensure(d.bucket, 503, 'STORAGE_NOT_CONFIGURED', 'S3 bucket is not configured.');
        return {
          url: await getSignedUrl(
            s3,
            new GetObjectCommand({
              Bucket: d.bucket,
              Key: d.objectKey,
              ResponseContentDisposition: records ? 'attachment' : undefined,
            }),
            { expiresIn: records ? 60 : 300 },
          ),
        };
      }
      return { buffer: await readFile(d.local) };
    },
    async remove(key: string, records = false) {
      const d = details(key, records);
      if (this.provider(records) === 's3')
        await s3.send(new DeleteObjectCommand({ Bucket: d.bucket, Key: d.objectKey }));
      else await unlink(d.local);
    },
  };
}
