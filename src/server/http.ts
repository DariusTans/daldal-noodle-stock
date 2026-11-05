import { z } from 'zod';
import { DomainError } from '../domain/index.js';

/** An error with an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, 'unauthorized', 'กรุณาเข้าสู่ระบบ');
export const forbidden = (message = 'บทบาทนี้ทำรายการนี้ไม่ได้') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'ไม่พบข้อมูล') => new HttpError(404, 'not_found', message);
export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

/** Map any thrown value to a JSON error response. */
export function errorResponse(e: unknown, log?: (m: string, d?: unknown) => void): Response {
  if (e instanceof HttpError)
    return json({ error: e.code, message: e.message, details: e.details }, e.status);
  // Business-rule violation: the request was understood but not allowed by the rules.
  if (e instanceof DomainError) return json({ error: 'rule', message: e.message }, 422);
  if (e instanceof z.ZodError)
    return json(
      {
        error: 'bad_request',
        message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
        details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      400,
    );
  log?.('unhandled error', e);
  return json({ error: 'internal', message: 'ระบบขัดข้อง กรุณาลองใหม่' }, 500);
}

export async function readJson(req: Request, maxBytes = 4_000_000): Promise<unknown> {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > maxBytes) throw new HttpError(413, 'too_large', 'ข้อมูลมีขนาดใหญ่เกินไป');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', 'ข้อมูลมีขนาดใหญ่เกินไป');
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('รูปแบบ JSON ไม่ถูกต้อง');
  }
}

export const bearer = (req: Request): string | null => {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1]!.trim() : null;
};
