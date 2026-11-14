import type { paths } from './api-types';

/*
 * Typed API calls from the generated contract (apps/api/openapi.json), shared by the apps.
 *
 *   const request = createRequest(send);
 *   const booking = await request('get', '/bookings/{id}', { params: { id } });
 *
 * The path must exist for that method, path parameters are required, JSON bodies are checked where
 * the API publishes a schema, and the result is typed where it publishes a response schema.
 * `send` is each app's own fetch wrapper (auth, refresh, retries, caching stay app-specific).
 */

/** Contract paths relative to /v1 (the mobile API_URL already ends in /v1). */
export type V1 = {
  [
    P in keyof paths as P extends `/v1${infer Rest}` ? (Rest extends '' ? '/' : Rest) : never
  ]: paths[P];
};
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type ApiPath = keyof V1;
type MethodsOf<P extends ApiPath> = {
  [M in Method]: V1[P] extends Record<M, infer O>
    ? [O] extends [never | undefined]
      ? never
      : M
    : never;
}[Method];
type Op<P extends ApiPath, M extends Method> = NonNullable<V1[P][M & keyof V1[P]]>;

type PathParams<O> = O extends { parameters: { path: infer X } }
  ? [X] extends [never]
    ? never
    : X
  : never;
type DeclaredQuery<O> = O extends { parameters: { query?: infer X } } ? X : never;
type QueryParams<O> = [DeclaredQuery<O>] extends [never | undefined]
  ? Record<string, string | number | boolean | undefined>
  : NonNullable<DeclaredQuery<O>>;
type Body<O> = O extends { requestBody?: { content: { 'application/json': infer B } } } ? B : never;
type Success<O> = O extends { responses: infer R }
  ? R extends { 200: { content: { 'application/json': infer J } } }
    ? J
    : R extends { 201: { content: { 'application/json': infer J } } }
      ? J
      : R extends { 202: { content: { 'application/json': infer J } } }
        ? J
        : unknown
  : unknown;
/** Responses without a published schema stay `any`, as before; published ones are typed. */
type Result<O> = unknown extends Success<O> ? any : Success<O>;

type Options<O> = {
  query?: QueryParams<O>;
  body?: Body<O>;
  /** Reuse one key when retrying a single user action (see funding.ts). */
  idempotencyKey?: string;
} & ([PathParams<O>] extends [never] ? { params?: undefined } : { params: PathParams<O> });
type Args<O> = [PathParams<O>] extends [never] ? [options?: Options<O>] : [options: Options<O>];

export type Send = (
  url: string,
  method: string,
  body: unknown,
  options: { idempotencyKey?: string },
) => Promise<any>;

export function createRequest(send: Send) {
  return function request<P extends ApiPath, M extends MethodsOf<P>>(
    method: M,
    path: P,
    ...[options]: Args<Op<P, M>>
  ): Promise<Result<Op<P, M>>> {
    const params = (options?.params ?? {}) as Record<string, string | number>;
    let url = String(path).replace(/\{(\w+)\}/g, (_, name: string) => {
      if (params[name] === undefined)
        throw new Error(`Missing path parameter "${name}" for ${path}`);
      return encodeURIComponent(String(params[name]));
    });
    const query = Object.entries((options?.query ?? {}) as Record<string, unknown>).filter(
      ([, v]) => v !== undefined && v !== '',
    );
    if (query.length) url += `?${new URLSearchParams(query.map(([k, v]) => [k, String(v)]))}`;
    return send(url, method.toUpperCase(), options?.body, {
      idempotencyKey: options?.idempotencyKey,
    });
  };
}
