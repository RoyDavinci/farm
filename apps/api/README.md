# Farmers Market API

Express 5 + TypeScript, PostgreSQL through Prisma, Winston logging.

## Layout

```text
src/
  server.ts            HTTP entry: connects, starts the server, realtime and (optionally) jobs; graceful shutdown
  worker.ts            Background-jobs entry for a separate deployment (RUN_WORKERS=false on the API)
  app.ts               Builds the Express app: security, logging, parsers, routes, error handling
  config/              env.ts validates every environment variable (zod); index.ts exposes typed config
  database/            client.ts (Prisma client + parameterised SQL in one transaction), seed.ts
  routes/              URL → controller wiring only; index.ts mounts everything under /v1 in order
  controllers/         Request handling: validate input, call services, shape responses
  services/            Business logic and data access shared across controllers
  middleware/          security (helmet, CORS, compression), request logging, authentication,
                       staff roles, idempotency, rate limits, errors
  validators/          Shared zod request schemas
  jobs/                Scheduler for expiry, email, push and cleanup jobs (with heartbeats)
  realtime/            WebSocket hub that nudges clients to refresh
  lib/                 Infrastructure: errors, logger, mail, file storage
  types/               Shared types (AppDeps, Mutate)
  generated/prisma     Generated Prisma client (git-ignored; `npm run db:generate`)
prisma/
  schema.prisma        Schema of record
  migrations/          SQL migrations (0_init is the baseline of the pre-Prisma schema)
test/                  Integration tests against a real PostgreSQL test database
```

A request flows `routes → controller → services → database`. Controllers get their dependencies (`db`, `config`, `mutate`) from `AppDeps`, so tests can build apps with different configuration.

## Data access

- **Prisma client** (`db.prisma`, or `q.prisma` inside a transaction) for ordinary reads and writes.
- **Parameterised SQL** (`db.query(sql, params)` / `q.query`) where Prisma's API can't express what money and stock logic needs: row locks (`SELECT … FOR UPDATE`), `ON CONFLICT` upserts, keyset paging and reporting queries. Values are always passed as parameters, never interpolated.
- Both styles share one transaction inside `db.transaction(async (q) => …)`.
- Every state-changing endpoint goes through `mutate` (middleware/idempotency.ts): one transaction, serialised per user, with `Idempotency-Key` replay.

Schema changes: edit `prisma/schema.prisma`, then `npm run db:migrate:dev -- --name <change>`; deploy with `npm run db:migrate` (`prisma migrate deploy`) as a release step before starting the new version. Check constraints and partial indexes are written in migration SQL because Prisma doesn't model them.

## Operations

- Logs: `LOG_LEVEL` (error, warn, info, http, debug). Production writes JSON lines to stdout; secrets, tokens, codes and account numbers are redacted. Each request gets an `X-Request-Id`.
- Health: `/health` (liveness) and `/health/ready` (database, job heartbeats, delayed email/push, stuck payouts).
- Security: helmet headers (strict CSP, HSTS in production, no framing), CORS limited to `CORS_ORIGINS`, compression, per-IP rate limits (`RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT`), `TRUST_PROXY` for load balancers, 100 kB JSON limit.
- Production refuses to start without `DATABASE_URL`, SMTP, a strong `OTP_SECRET` and `PAYOUT_ENCRYPTION_KEY`, an `https://` `PUBLIC_API_URL` and `https://` CORS origins.
- Docker: `apps/api/Dockerfile` builds one image for the API (`node dist/server.js`), the worker (`node dist/worker.js`) and migrations (`npx prisma migrate deploy`).

## Commands

```sh
npm run dev            # migrate, then watch-run the API
npm run dev:worker     # watch-run the standalone worker
npm test               # integration tests (needs TEST_DATABASE_URL, a database ending in _test)
npm run db:migrate     # apply migrations
npm run db:migrate:dev # create a migration from schema.prisma changes
npm run db:seed        # demo accounts (development only)
npm run db:studio      # browse data
```
