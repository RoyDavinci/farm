// Database backup. Usage: npm run backup
//   pg_dump custom-format archive of DATABASE_URL, restorable with pg_restore.
//   Needs the PostgreSQL client tools (pg_dump) matching the server's major version.
// Optional: BACKUP_DIR (default ./backups), BACKUP_KEEP_DAYS (default 14),
//           BACKUP_S3_BUCKET (+ AWS credentials/role) to copy each backup off the machine.
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, unlink, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from 'dotenv';

config({ path: resolve('apps/api/.env') });
const dir = resolve(process.env.BACKUP_DIR || 'backups');
const keepDays = Number(process.env.BACKUP_KEEP_DAYS || 14);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await mkdir(dir, { recursive: true, mode: 0o700 });

function run(cmd, args, env) {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('error', fail);
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited with ${code}`))));
  });
}

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL (apps/api/.env) to back up.');
const file = join(dir, `zuru-${stamp}.dump`);
// The URL is passed through the environment so it never appears in the process list.
await run('pg_dump', ['--format=custom', '--no-owner', '--file', file], {
  PGDATABASE: process.env.DATABASE_URL,
});
console.log(`Backup written: ${file}`);

if (process.env.BACKUP_S3_BUCKET) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BACKUP_S3_BUCKET,
      Key: `backups/${file.split('/').at(-1)}`,
      Body: await readFile(file),
      ServerSideEncryption: 'AES256',
    }),
  );
  console.log(`Copied to s3://${process.env.BACKUP_S3_BUCKET}/backups/`);
}

const cutoff = Date.now() - keepDays * 86400000;
for (const name of await readdir(dir)) {
  if (!name.startsWith('zuru-')) continue;
  const path = join(dir, name);
  if ((await stat(path)).mtimeMs < cutoff) {
    await unlink(path);
    console.log(`Removed old backup ${name}`);
  }
}
