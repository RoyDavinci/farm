import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

/** Rebuilds the test database from the Prisma migrations before the suite runs. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL (see apps/api/.env.example) to run tests.');
  // Guard: tests truncate every table, so never point them at a real database.
  if (!new URL(url).pathname.endsWith('_test'))
    throw new Error('TEST_DATABASE_URL must name a database ending in "_test".');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });
}
