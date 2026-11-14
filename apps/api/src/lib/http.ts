import type { Request } from 'express';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * The parts of an HTTP request that services may read. Services receive this plain object instead
 * of Express's req/res, so they can be called from jobs, scripts and tests without a server.
 */
export interface RequestInput {
  params: Record<string, string>;
  query: Record<string, any>;
  body: any;
  file?: Express.Multer.File;
  headers: IncomingHttpHeaders;
  rawBody?: Buffer;
  method: string;
  originalUrl: string;
  header(name: string): string | undefined;
}

export function requestInput(req: Request): RequestInput {
  return {
    params: req.params as Record<string, string>,
    query: req.query as Record<string, any>,
    body: req.body,
    file: req.file,
    headers: req.headers,
    rawBody: (req as any).rawBody,
    method: req.method,
    originalUrl: req.originalUrl,
    header: (name) => req.header(name),
  };
}
