import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { connect } from './client.js';
if (config.production) throw new Error('Demo seed is disabled in production.');
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 10)
  throw new Error('Set SEED_PASSWORD to at least 10 characters before running the demo seed.');
const db = connect(config.databaseUrl);
try {
  const ph = await bcrypt.hash(password, 12);
  await db.transaction(async (q) => {
    for (const [name, email, phone, admin] of [
      ['Market Admin', 'admin@farmers.market', '+2348000000001', true],
      ['Ada Okafor', 'seller@farmers.market', '+2348000000002', false],
      ['Tunde Bello', 'buyer@farmers.market', '+2348000000003', false],
    ] as const)
      await q.query(
        'INSERT INTO users(id,name,email,phone,password_hash,admin,staff_role) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(email) DO NOTHING',
        [randomUUID(), name, email, phone, ph, admin, admin ? 'owner' : null],
      );
    const [seller] = await q.query("SELECT id FROM users WHERE email='seller@farmers.market'");
    const [existing] = await q.query('SELECT user_id FROM sellers WHERE user_id=$1', [seller.id]);
    if (!existing) {
      await q.query(
        "INSERT INTO sellers(user_id,business_name,business_type,city,area,address,status) VALUES($1,'Ada’s Fresh Harvest','farm','Lagos','Ikorodu','Collection point: 12 Market Road, Ikorodu, Lagos','APPROVED')",
        [seller.id],
      );
      for (const [title, category, unit, price, stock, description] of [
        [
          'Fresh Roma tomatoes',
          'Vegetables',
          'basket',
          1850000,
          24,
          'Freshly harvested Roma tomatoes, sorted and ready for collection.',
        ],
        [
          'Sweet yellow maize',
          'Grains',
          'bag',
          4200000,
          16,
          'Dry yellow maize sourced directly from local growers.',
        ],
        [
          'Farm fresh plantain',
          'Fruit',
          'piece',
          250000,
          40,
          'A generous bunch of firm, fresh plantain.',
        ],
        [
          'Fresh spinach',
          'Vegetables',
          'kg',
          120000,
          30,
          'Tender leafy greens harvested this morning.',
        ],
      ] as const)
        await q.query(
          'INSERT INTO listings(id,seller_id,title,description,category,unit,price_kobo,stock) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [randomUUID(), seller.id, title, description, category, unit, price, stock],
        );
    }
    await q.query(
      "INSERT INTO listing_variants(id,listing_id,name,unit,price_kobo,stock,is_primary) SELECT gen_random_uuid()::text,l.id,'Standard',l.unit,l.price_kobo,l.stock,TRUE FROM listings l WHERE NOT EXISTS(SELECT 1 FROM listing_variants v WHERE v.listing_id=l.id)",
    );
  });
  console.log(
    'Demo accounts ready: admin@farmers.market, seller@farmers.market, buyer@farmers.market. Password: your SEED_PASSWORD. Existing passwords are preserved.',
  );
} finally {
  await db.close();
}
