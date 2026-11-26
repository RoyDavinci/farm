import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';

/**
 * Gives every request an id (honouring a sane incoming X-Request-Id), returns it to the client,
 * and logs one line per request with status, duration and user. Query strings are not logged
 * because they can contain search terms or signed-link signatures. A failed request also logs
 * the error code and message the app was shown (user-facing text, never secrets) and the
 * device's user agent, so "it didn't work on my phone" can be traced.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const incoming = req.header('X-Request-Id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  const started = process.hrtime.bigint();
  // Remember the { error } a handler sends, whichever way it was sent.
  const json = res.json.bind(res);
  res.json = (body: any) => {
    if (body?.error?.code) res.locals.errorBody = body.error;
    return json(body);
  };
  res.on('finish', () => {
    if (req.path.startsWith('/health')) return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
    logger.log(level, `${req.method} ${req.baseUrl}${req.path} ${res.statusCode}`, {
      requestId: id,
      method: req.method,
      path: `${req.baseUrl}${req.path}`,
      status: res.statusCode,
      durationMs: Math.round(ms),
      userId: res.locals.user?.id,
      ip: req.ip,
      ...(res.statusCode >= 400
        ? {
            // Not "code": the logger redacts that name (it protects sign-in codes).
            errorCode: res.locals.errorBody?.code,
            reason: String(res.locals.errorBody?.message ?? '').slice(0, 200) || undefined,
            ua: String(req.header('User-Agent') ?? '').slice(0, 160) || undefined,
          }
        : {}),
    });
  });
  next();
};
