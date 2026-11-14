import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

type ErrorBody = { status: number; code: string; message: string };

/** True for a unique-constraint violation from either the Prisma client or a raw query. */
function isUniqueViolation(err: unknown) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2002') return true;
  const detail = JSON.stringify(err.meta ?? {});
  return err.code === 'P2010' && (detail.includes('23505') || detail.includes('UniqueConstraint'));
}

function classify(err: any): ErrorBody | null {
  if (err instanceof AppError) return { status: err.status, code: err.code, message: err.message };
  if (err instanceof z.ZodError)
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  if (isUniqueViolation(err))
    return { status: 409, code: 'ALREADY_EXISTS', message: 'That record already exists.' };
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')
    return { status: 404, code: 'NOT_FOUND', message: 'Not found.' };
  if (err?.code === 'LIMIT_FILE_SIZE')
    return { status: 400, code: 'FILE_TOO_LARGE', message: 'Choose a smaller file.' };
  if (err?.name === 'MulterError')
    return {
      status: 400,
      code: 'INVALID_UPLOAD',
      message: 'Upload one file in the expected field.',
    };
  if (err?.type === 'entity.parse.failed')
    return { status: 400, code: 'INVALID_JSON', message: 'Invalid JSON body.' };
  if (err?.type === 'entity.too.large')
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' };
  return null;
}

/** Single place that turns errors into `{ error: { code, message } }` responses. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = classify(err);
  if (known)
    return res.status(known.status).json({ error: { code: known.code, message: known.message } });
  // Unexpected: log everything for operators, reveal nothing internal to clients.
  logger.error('Unhandled API error', {
    requestId: res.locals.requestId,
    path: `${req.baseUrl}${req.path}`,
    err,
  });
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please retry.',
      requestId: res.locals.requestId,
    },
  });
};

export const notFound: RequestHandler = (_req, res) =>
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
