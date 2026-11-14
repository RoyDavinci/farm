import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
/**
 * Data access. Two styles share one connection pool and one transaction:
 *  - `prisma` — the typed Prisma client, for ordinary reads and writes.
 *  - `query(sql, params)` — parameterised SQL through Prisma, for row locks (SELECT … FOR UPDATE),
 *    ON CONFLICT upserts, keyset paging and reporting queries Prisma's API cannot express.
 * Inside `transaction`, both run on the same database transaction.
 */
export interface Query {
  query<T = Record<string, any>>(sql: string, params?: any[]): Promise<T[]>;
  prisma: Prisma.TransactionClient;
  /**
   * Runs `fn` once the surrounding transaction has committed (immediately outside a transaction).
   * Use it for side effects others must not see early, such as realtime "data changed" events.
   */
  afterCommit(fn: () => void): void;
}
export interface Database extends Query {
  prisma: PrismaClient;
  transaction<T>(fn: (q: Query) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** int8 → number (all amounts are kobo, far below 2^53) and numeric → number, for JSON responses. */
function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return value;
}
function rows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  for (const row of result as Record<string, unknown>[])
    for (const key of Object.keys(row)) row[key] = normalize(row[key]);
  return result as T[];
}
function runner(client: Prisma.TransactionClient | PrismaClient) {
  return <T>(sql: string, params: any[] = []) =>
    client.$queryRawUnsafe(sql, ...params).then((r) => rows<T>(r));
}

/**
 * True when Postgres aborted the transaction because of a deadlock (40P01) or a serialization /
 * write conflict (40001, Prisma P2034). The whole transaction rolled back, so retrying is safe.
 */
export function isTransientConflict(err: unknown) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2034') return true;
  const detail = `${err.message} ${JSON.stringify(err.meta ?? {})}`;
  return /40P01|40001|deadlock detected|could not serialize/i.test(detail);
}

export function createPrisma(url: string) {
  const adapter = new PrismaPg({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_SIZE || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  return new PrismaClient({ adapter });
}

export function connect(url: string): Database {
  if (!url) throw new Error('DATABASE_URL is required (see apps/api/.env.example).');
  const prisma = createPrisma(url);
  const runSafely = (fn: () => void) => {
    try {
      fn();
    } catch {
      // A failed side effect must never undo or fail a committed write.
    }
  };
  return {
    prisma,
    query: runner(prisma),
    afterCommit: runSafely,
    async transaction(fn) {
      const pending: (() => void)[] = [];
      const result = await prisma.$transaction(
        (tx) => fn({ prisma: tx, query: runner(tx), afterCommit: (cb) => pending.push(cb) }),
        { maxWait: 10000, timeout: 30000 },
      );
      pending.forEach(runSafely);
      return result;
    },
    close: () => prisma.$disconnect(),
  };
}
