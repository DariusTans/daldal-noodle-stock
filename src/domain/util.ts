export class DomainError extends Error {
  override name = 'DomainError';
}

export const fail = (message: string): never => {
  throw new DomainError(message);
};

/** JSON round-trip clone: identical to the legacy semantics (drops `undefined`). */
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export const isText = (v: unknown, max = 500): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;

export const isStamp = (v: unknown): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v));

/** Quantity: 0 ≤ v ≤ 1e9 with at most 3 decimals. */
export const isQuantity = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= 1e9 &&
  Math.abs(v * 1000 - Math.round(v * 1000)) < 0.00001;

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Required trimmed text or throw. */
export const required = (v: unknown, max: number, message: string): string =>
  isText(v, max) ? v.trim() : fail(message);

/** Master-data comparison key (codes/names): non-strings become ''. */
export const normName = (x: unknown): string =>
  (typeof x === 'string' ? x.trim() : '').normalize('NFKC').toLocaleLowerCase();

/** Delivery reference key (receiving). */
export const normRef = (v: unknown): string => String(v).normalize('NFKC').trim().toLowerCase();

/** Vendor/reference key for expenses: falsy becomes ''. */
export const normLoose = (v: unknown): string =>
  String(v || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();

export const hasOwn = (o: object, k: unknown): boolean =>
  typeof k === 'string' && Object.hasOwn(o, k);
