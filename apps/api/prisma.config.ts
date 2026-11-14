import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/database/seed.ts',
  },
  // Optional here so `prisma generate` works in builds without a database;
  // migrate/studio commands fail clearly if it is missing.
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
