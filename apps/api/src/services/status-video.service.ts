import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ensure, AppError } from '../lib/errors.js';
import { storage } from '../lib/storage.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
const exec = promisify(execFile);
export function createStatusVideoService({ db, config }: AppDeps) {
  const store = storage(config);
  async function uploadVideo(user: any, input: RequestInput) {
    const [seller] = await db.query(
      "SELECT user_id FROM sellers WHERE user_id=$1 AND status='APPROVED'",
      [user.id],
    );
    ensure(seller, 403, 'SELLER_NOT_APPROVED', 'Approved sellers only.');
    ensure(
      input.file,
      400,
      'VIDEO_REQUIRED',
      'Choose an MP4, MOV or WebM video under 20 MB and 30 seconds.',
    );
    ensure(
      input.file.size <= 20 * 1024 * 1024,
      400,
      'VIDEO_TOO_LARGE',
      'Choose a video under 20 MB.',
    );
    const [count] = await db.query('SELECT COUNT(*)::int AS n FROM media WHERE owner_id=$1', [
      user.id,
    ]);
    ensure(count.n < 500, 409, 'MEDIA_LIMIT', 'Your media storage limit has been reached.');
    const dir = await mkdtemp(join(tmpdir(), 'market-status-video-'));
    let uploaded = false,
      posterStored = false;
    const id = randomUUID(),
      key = `statuses/${user.id}/${id}.mp4`,
      posterKey = `statuses/${user.id}/${id}-thumb.webp`;
    try {
      const source = join(dir, 'source'),
        output = join(dir, 'output.mp4'),
        poster = join(dir, 'poster.jpg');
      await writeFile(source, input.file.buffer, { mode: 0o600 });
      let data: any;
      try {
        const probe = await exec(
          process.env.FFPROBE_PATH || 'ffprobe',
          [
            '-v',
            'error',
            '-protocol_whitelist',
            'file,pipe',
            '-show_format',
            '-show_streams',
            '-of',
            'json',
            source,
          ],
          { timeout: 15000, maxBuffer: 512 * 1024 },
        );
        data = JSON.parse(probe.stdout);
      } catch (e: any) {
        if (e.code === 'ENOENT')
          throw new AppError(
            503,
            'VIDEO_PROCESSOR_UNAVAILABLE',
            'Video processing is not configured on the server.',
          );
        throw new AppError(
          400,
          'INVALID_VIDEO',
          'This video could not be decoded. Choose an MP4, MOV or WebM file.',
        );
      }
      ensure(
        /mov|mp4|webm/.test(data.format?.format_name || ''),
        400,
        'VIDEO_FORMAT',
        'Choose an MP4, MOV or WebM video.',
      );
      const videos = data.streams?.filter(
          (s: any) => s.codec_type === 'video' && !s.disposition?.attached_pic,
        ),
        video = videos?.[0],
        duration = Math.max(
          Number(data.format?.duration),
          ...data.streams.map((s: any) => Number(s.duration) || 0),
        );
      ensure(
        video &&
          videos.length === 1 &&
          data.streams.length <= 4 &&
          Number.isFinite(duration) &&
          duration > 0 &&
          duration <= 30,
        400,
        'VIDEO_DURATION',
        'Use one video track between 0 and 30 seconds.',
      );
      ensure(
        video.width > 0 && video.height > 0 && video.width <= 4096 && video.height <= 4096,
        400,
        'VIDEO_DIMENSIONS',
        'Choose a video no larger than 4096 pixels on either side.',
      );
      try {
        await exec(
          process.env.FFMPEG_PATH || 'ffmpeg',
          [
            '-nostdin',
            '-v',
            'error',
            '-y',
            '-protocol_whitelist',
            'file,pipe',
            '-i',
            source,
            '-map',
            `0:${video.index}`,
            '-map',
            '0:a:0?',
            '-t',
            '30',
            '-vf',
            "scale=w='min(720,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24",
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '25',
            '-maxrate',
            '1400k',
            '-bufsize',
            '2800k',
            '-pix_fmt',
            'yuv420p',
            '-threads',
            '2',
            '-c:a',
            'aac',
            '-b:a',
            '96k',
            '-ac',
            '2',
            '-map_metadata',
            '-1',
            '-map_chapters',
            '-1',
            '-movflags',
            '+faststart',
            output,
          ],
          { timeout: 90000, maxBuffer: 512 * 1024 },
        );
        await exec(
          process.env.FFMPEG_PATH || 'ffmpeg',
          [
            '-nostdin',
            '-v',
            'error',
            '-y',
            '-i',
            output,
            '-frames:v',
            '1',
            '-vf',
            'scale=400:400:force_original_aspect_ratio=decrease',
            '-threads',
            '1',
            poster,
          ],
          { timeout: 15000, maxBuffer: 512 * 1024 },
        );
      } catch (e: any) {
        if (e.code === 'ENOENT')
          throw new AppError(
            503,
            'VIDEO_PROCESSOR_UNAVAILABLE',
            'Video processing is not configured on the server.',
          );
        throw new AppError(
          400,
          'VIDEO_PROCESSING_FAILED',
          'The video could not be processed within the upload limits. Try a shorter clip.',
        );
      }
      ensure(
        (await stat(output)).size <= 12 * 1024 * 1024,
        400,
        'VIDEO_OUTPUT_LIMIT',
        'The processed video is too large. Choose a shorter clip.',
      );
      await store.put(key, await readFile(output), 'video/mp4');
      uploaded = true;
      await store.put(
        posterKey,
        await sharp(await readFile(poster))
          .webp({ quality: 75 })
          .toBuffer(),
        'image/webp',
      );
      posterStored = true;
      const root = config.publicApiUrl.replace(/\/$/, ''),
        url = `${root}/media/${id}.mp4`,
        thumbnail_url = `${root}/media/${id}-thumb.webp`;
      await db.query(
        "INSERT INTO media(id,owner_id,url,thumbnail_url,storage_provider,storage_key,thumbnail_key,media_type,duration_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,'VIDEO',$8)",
        [id, user.id, url, thumbnail_url, store.provider(), key, posterKey, duration],
      );
      uploaded = false;
      posterStored = false;
      return { id, url, thumbnail_url, media_type: 'VIDEO', duration_seconds: duration };
    } finally {
      if (uploaded) await store.remove(key).catch(() => {});
      if (posterStored) await store.remove(posterKey).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  }
  return { uploadVideo };
}
