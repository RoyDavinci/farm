/**
 * Loads the demo catalogue (sellers, products with photos, stories) into a TEST environment.
 *
 *   DEMO_CATALOG=yes node dist/database/demo-catalog.js <photos folder>     add (safe to re-run)
 *   DEMO_CATALOG=yes node dist/database/demo-catalog.js --refresh-stories   bring stories back
 *   DEMO_CATALOG=yes node dist/database/demo-catalog.js --remove            delete all demo data
 *
 * Demo accounts use the reserved domain demo.ahia.example and cannot sign in unless
 * DEMO_PASSWORD is set. Photos are re-encoded like seller uploads (WebP plus thumbnail).
 */
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { config } from '../config/index.js';
import { storage } from '../lib/storage.js';
import { publicPin } from '../services/geography.service.js';
import { connect } from './client.js';
import { demoSellers } from './demo-catalog-data.js';

if (process.env.DEMO_CATALOG !== 'yes')
  throw new Error('Set DEMO_CATALOG=yes to confirm this is a test environment.');
const DOMAIN = 'demo.ahia.example';
const storyHours = Number(process.env.DEMO_STORY_HOURS || 24 * 7);
const args = process.argv.slice(2);
const db = connect(config.databaseUrl);
const store = storage(config);
const root = config.publicApiUrl.replace(/\/$/, '');
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000);

async function refreshStories() {
  const rows = await db.query(
    `UPDATE local_statuses ls SET status='ACTIVE', created_at=now()-(random()*10+1)*interval '1 hour',
       expires_at=now()+$1::int*interval '1 hour'
     FROM users u WHERE u.id=ls.seller_id AND u.email LIKE $2 AND ls.status IN ('ACTIVE','EXPIRED')
     RETURNING ls.id`,
    [storyHours, `%@${DOMAIN}`],
  );
  console.log(`Stories live again for ${storyHours} hours: ${rows.length}`);
}

async function remove() {
  const users = await db.query('SELECT id FROM users WHERE email LIKE $1', [`%@${DOMAIN}`]);
  const ids = users.map((u: any) => u.id);
  if (!ids.length) return console.log('No demo data found.');
  const media = await db.query(
    'SELECT storage_key,thumbnail_key FROM media WHERE owner_id=ANY($1)',
    [ids],
  );
  await db.transaction(async (q) => {
    await q.query('DELETE FROM local_statuses WHERE seller_id=ANY($1)', [ids]);
    await q.query(
      'DELETE FROM listing_variants WHERE listing_id IN (SELECT id FROM listings WHERE seller_id=ANY($1))',
      [ids],
    );
    await q.query('DELETE FROM listings WHERE seller_id=ANY($1)', [ids]);
    await q.query('DELETE FROM media WHERE owner_id=ANY($1)', [ids]);
    await q.query('DELETE FROM sellers WHERE user_id=ANY($1)', [ids]);
    await q.query('DELETE FROM users WHERE id=ANY($1)', [ids]);
  });
  for (const m of media)
    for (const key of [m.storage_key, m.thumbnail_key])
      if (key) await store.remove(key).catch(() => {});
  console.log(`Removed ${ids.length} demo sellers, their products, photos and stories.`);
}

async function savePhoto(owner: string, file: string) {
  const input = await readFile(file);
  const full = await sharp(input, { limitInputPixels: 40000000 })
    .rotate()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const thumb = await sharp(full)
    .resize(400, 400, { fit: 'cover' })
    .webp({ quality: 72 })
    .toBuffer();
  const key = randomUUID();
  const storageKey = `listings/${owner}/${key}.webp`,
    thumbnailKey = `listings/${owner}/${key}-thumb.webp`;
  await store.put(storageKey, full, 'image/webp');
  await store.put(thumbnailKey, thumb, 'image/webp');
  const url = `${root}/media/${key}.webp`,
    thumbnail_url = `${root}/media/${key}-thumb.webp`;
  await db.query(
    'INSERT INTO media(id,owner_id,url,thumbnail_url,storage_provider,storage_key,thumbnail_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [key, owner, url, thumbnail_url, store.provider(), storageKey, thumbnailKey],
  );
  return { url, thumbnail_url };
}

async function addStory(
  seller: string,
  listing: string,
  caption: string,
  photo: { url: string; thumbnail_url: string },
  age: number,
  q: { query: (sql: string, params?: unknown[]) => Promise<any> } = db,
) {
  await q.query(
    `INSERT INTO local_statuses(id,seller_id,listing_id,caption,media_url,thumbnail_url,media_type,created_at,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,'IMAGE',$7,now()+$8::int*interval '1 hour')`,
    [
      randomUUID(),
      seller,
      listing,
      caption,
      photo.url,
      photo.thumbnail_url,
      hoursAgo(age),
      storyHours,
    ],
  );
}

async function add(photos: string) {
  const hash = await bcrypt.hash(process.env.DEMO_PASSWORD || randomBytes(24).toString('hex'), 12);
  let sellers = 0,
    products = 0,
    stories = 0,
    missing = 0,
    photos_added = 0;
  for (const [index, s] of demoSellers.entries()) {
    const email = `${s.key}@${DOMAIN}`;
    await db.query(
      'INSERT INTO users(id,name,email,phone,password_hash,email_verified_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(email) DO NOTHING',
      [randomUUID(), s.name, email, `+2348099${String(100000 + index).slice(-6)}`, hash],
    );
    const [user] = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    const pin = publicPin(s.lat, s.lng);
    const [created] = await db.query(
      `INSERT INTO sellers(user_id,business_name,business_type,city,area,address,status,latitude,longitude,
         public_latitude,public_longitude,state,lga,profile_details)
       VALUES($1,$2,$3,$4,$5,$6,'APPROVED',$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(user_id) DO NOTHING RETURNING user_id`,
      [
        user.id,
        s.business,
        s.type,
        s.city,
        s.area,
        `${s.area}, ${s.city}`,
        s.lat,
        s.lng,
        pin.latitude,
        pin.longitude,
        s.state,
        s.lga,
        JSON.stringify({ demo: true, description: s.about }),
      ],
    );
    if (created) sellers++;
    for (const [n, item] of s.products.entries()) {
      const file = join(photos, `${item.slug}.jpg`);
      const [exists] = await db.query(
        'SELECT id,image_url FROM listings WHERE seller_id=$1 AND title=$2',
        [user.id, item.title],
      );
      if (exists) {
        // Re-runs give earlier products the photo (and story) they were missing.
        if (exists.image_url || !existsSync(file)) continue;
        const photo = await savePhoto(user.id, file);
        await db.query('UPDATE listings SET image_url=$1,image_urls=$2 WHERE id=$3', [
          photo.url,
          JSON.stringify([photo.url]),
          exists.id,
        ]);
        photos_added++;
        if (item.story) {
          await addStory(user.id, exists.id, item.story, photo, 1 + ((index + n) % 9));
          stories++;
        }
        continue;
      }
      const photo = existsSync(file) ? await savePhoto(user.id, file) : null;
      if (!photo) missing++;
      const id = randomUUID();
      await db.transaction(async (q) => {
        await q.query(
          `INSERT INTO listings(id,seller_id,title,description,category,unit,price_kobo,stock,image_url,image_urls,condition,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            id,
            user.id,
            item.title,
            item.description,
            item.category,
            item.unit,
            item.price * 100,
            item.stock,
            photo?.url ?? null,
            JSON.stringify(photo ? [photo.url] : []),
            item.condition || 'NEW',
            hoursAgo(index * 3 + n * 7 + 2),
          ],
        );
        await q.query(
          "INSERT INTO listing_variants(id,listing_id,name,unit,price_kobo,stock,is_primary) VALUES($1,$2,'Standard',$3,$4,$5,TRUE)",
          [randomUUID(), id, item.unit, item.price * 100, item.stock],
        );
        for (const [name, unit, price] of item.options || [])
          await q.query(
            'INSERT INTO listing_variants(id,listing_id,name,unit,price_kobo,stock) VALUES($1,$2,$3,$4,$5,$6)',
            [randomUUID(), id, name, unit, price * 100, Math.max(5, Math.round(item.stock / 2))],
          );
        if (item.story && photo) {
          await addStory(user.id, id, item.story, photo, 1 + ((index + n) % 9), q);
          stories++;
        }
      });
      products++;
    }
  }
  console.log(
    `Demo catalogue: ${sellers} new sellers, ${products} new products, ${stories} stories` +
      (photos_added ? `, photos added to ${photos_added} existing products` : '') +
      (missing ? `, ${missing} products without a photo` : '') +
      `. Stories stay up for ${storyHours} hours; re-run with --refresh-stories to bring them back.`,
  );
}

try {
  if (args.includes('--remove')) await remove();
  else if (args.includes('--refresh-stories')) await refreshStories();
  else {
    if (!args[0]) throw new Error('Pass the folder that holds the demo photos.');
    await add(args[0]);
  }
} finally {
  await db.close();
}
