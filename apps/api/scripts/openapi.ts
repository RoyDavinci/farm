/**
 * Builds the OpenAPI 3.1 contract from the route files, controllers and zod validators.
 *   npm run openapi         write apps/api/openapi.json
 *   npm run openapi:check   fail if openapi.json is out of date (used in CI and tests)
 * Routes are read from source so the contract always lists exactly what the server mounts.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { responses } from '../src/contracts/index.js';
import { fundingInput } from '../src/validators/funding.validators.js';
import { searchInput } from '../src/validators/geography.validators.js';
import { listingSchema, sellerSchema } from '../src/validators/marketplace.validators.js';
import { resolveDisputeInput } from '../src/validators/support.validators.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const read = (p: string) => readFileSync(join(src, p), 'utf8');

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Route {
  method: Method;
  path: string;
  tag: string;
  handler: string;
}

/** Prefix for each routes function, from routes/index.ts and app.ts. */
function mountPrefixes() {
  const index = read('routes/index.ts');
  const prefixes: Record<string, string> = { healthRoutes: '' };
  const section = (name: string) => {
    const start = index.indexOf(`export function ${name}`);
    return index.slice(start, index.indexOf('\n}\n', start));
  };
  for (const [fn, base] of [
    ['publicFileRoutes', ''],
    ['apiRoutes', '/v1'],
  ] as const) {
    for (const m of section(fn).matchAll(
      /r\.use\((?:'([^']+)',\s*)?(?:[\w.]+,\s*)*(\w+)\(deps\)\)/g,
    ))
      prefixes[m[2]] = `${base}${m[1] ?? ''}`;
  }
  return prefixes;
}

function routes(): Route[] {
  const prefixes = mountPrefixes();
  const out: Route[] = [];
  for (const file of readdirSync(join(src, 'routes')).filter((f) => f.endsWith('.routes.ts'))) {
    const text = read(`routes/${file}`);
    const tag = file.replace('.routes.ts', '');
    for (const fn of text.matchAll(/export function (\w+)\(deps: AppDeps\) \{([\s\S]*?)\n\}/g)) {
      const prefix = prefixes[fn[1]];
      if (prefix === undefined) throw new Error(`${fn[1]} is not mounted in routes/index.ts`);
      for (const r of fn[2].matchAll(
        /r\.(get|post|put|patch|delete)\('([^']*)',\s*(?:\.\.\.)?c\.(\w+)\)/g,
      )) {
        const path = `${prefix}${r[2] === '/' ? '' : r[2]}` || '/';
        out.push({ method: r[1] as Method, path, tag, handler: r[3] });
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** Handlers that go through mutate() (or read the key themselves) need an Idempotency-Key. */
function idempotentHandlers() {
  const names = new Set<string>();
  for (const file of readdirSync(join(src, 'controllers'))) {
    const text = read(`controllers/${file}`);
    for (const m of text.matchAll(
      /const (\w+): RequestHandler(?:\[\])? = [\s\S]*?(?=\n  const \w+: RequestHandler|\n  return \{)/g,
    ))
      if (/mutate\(|readIdempotency\(|service\.startFunding\(/.test(m[0]))
        names.add(`${file.replace('.controller.ts', '')}.${m[1]}`);
  }
  return names;
}

const isPublic = (r: Route) =>
  r.path.startsWith('/health') ||
  r.path.startsWith('/media') ||
  r.path.startsWith('/files') ||
  (r.path.startsWith('/v1/auth/') && r.handler !== 'logout') ||
  r.path.startsWith('/v1/webhooks/') ||
  r.path === '/v1/payments/return' ||
  (r.path === '/v1/settings' && r.method === 'get');

const json = (schema: z.ZodType, io: 'input' | 'output' = 'input') =>
  z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Record<string, unknown>;
/** Request bodies (and query strings) with real schemas; others accept any JSON object. */
const bodies: Record<string, Record<string, unknown>> = {
  'marketplace.applyAsSeller': json(sellerSchema),
  'marketplace.createListing': json(listingSchema),
  'marketplace.updateListing': json(listingSchema.partial()),
  'wallet.startFunding': json(fundingInput),
  'support.resolveDispute': json(resolveDisputeInput),
};
const queries: Record<string, z.ZodObject<any>> = { 'geography.search': searchInput };

/** Named response schemas (contracts/responses.ts) become components.schemas and are $ref'd. */
const schemaUri = (id: string) => `#/components/schemas/${id}`;
function namedSchemas() {
  const out = z.toJSONSchema(z.globalRegistry, {
    io: 'output',
    uri: schemaUri,
    unrepresentable: 'any',
  });
  const schemas: Record<string, Record<string, unknown>> = {};
  for (const [id, schema] of Object.entries(out.schemas)) {
    const { $schema: _drop, id: _id, ...rest } = schema as Record<string, unknown>;
    schemas[id] = rest;
  }
  return schemas;
}
function responseSchema(schema: z.ZodType): Record<string, unknown> {
  const id = (schema.meta() as { id?: string } | undefined)?.id;
  if (id) return { $ref: schemaUri(id) };
  if (schema instanceof z.ZodArray)
    return { type: 'array', items: responseSchema(schema.element as z.ZodType) };
  if (schema instanceof z.ZodNullable)
    return { anyOf: [responseSchema(schema.unwrap() as z.ZodType), { type: 'null' }] };
  return json(schema, 'output');
}

const statusFor = (r: Route) =>
  ['register', 'login', 'forgotPassword'].includes(r.handler) && r.tag === 'auth'
    ? '202'
    : ['uploadPhoto', 'uploadEvidence', 'uploadDocument'].includes(r.handler)
      ? '201'
      : '200';

export function buildOpenApi() {
  const idempotent = idempotentHandlers();
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes()) {
    const key = `${r.tag}.${r.handler}`;
    const path = r.path.replace(/:(\w+)/g, '{$1}');
    const parameters: unknown[] = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    if (idempotent.has(key)) parameters.push({ $ref: '#/components/parameters/IdempotencyKey' });
    const query = queries[key];
    if (query)
      for (const [name, field] of Object.entries(query.shape))
        parameters.push({ name, in: 'query', required: false, schema: json(field as z.ZodType) });
    const op: Record<string, unknown> = {
      operationId: key,
      tags: [r.tag],
      ...(parameters.length ? { parameters } : {}),
      ...(isPublic(r) ? { security: [] } : {}),
      responses: {
        [statusFor(r)]: {
          description: 'Success',
          content:
            r.handler === 'paymentReturnPage'
              ? { 'text/html': {} }
              : {
                  'application/json': responses[key]
                    ? { schema: responseSchema(responses[key]) }
                    : {},
                },
        },
        default: { $ref: '#/components/responses/Error' },
      },
    };
    if (['post', 'put', 'patch'].includes(r.method)) {
      const upload = ['uploadPhoto', 'uploadEvidence', 'uploadDocument'].includes(r.handler);
      op.requestBody = upload
        ? {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    [r.handler === 'uploadPhoto' ? 'image' : 'file']: {
                      type: 'string',
                      format: 'binary',
                    },
                  },
                },
              },
            },
          }
        : {
            required: Boolean(bodies[key]),
            content: {
              'application/json': {
                schema: bodies[key] ?? { type: 'object', additionalProperties: true },
              },
            },
          };
    }
    (paths[path] ??= {})[r.method] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Farmers Market API',
      version: '1.0.0',
      description:
        'Generated from apps/api/src by `npm run openapi`. Amounts are integers in kobo. Writes that change money, orders or accounts require an Idempotency-Key; retries with the same key replay the first response.',
    },
    servers: [{ url: 'http://localhost:4000' }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', minLength: 8, maxLength: 150 },
        },
      },
      schemas: {
        ...namedSchemas(),
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: {
                  type: 'string',
                  examples: ['VALIDATION_ERROR', 'NOT_FOUND', 'RATE_LIMITED'],
                },
                message: { type: 'string' },
                requestId: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        Error: {
          description: 'Error with a machine-readable code',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  };
}

export const specPath = join(root, 'openapi.json');
export const render = () => `${JSON.stringify(buildOpenApi(), null, 2)}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    if (readFileSync(specPath, 'utf8') !== render()) {
      console.error('openapi.json is out of date. Run `npm run openapi -w @farmers-market/api`.');
      process.exit(1);
    }
    console.log('openapi.json is up to date.');
  } else {
    writeFileSync(specPath, render());
    console.log(`Wrote ${specPath}`);
  }
}
