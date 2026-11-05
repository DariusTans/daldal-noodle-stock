/** Small UI kit (Tailwind). Mobile-first, keyboard accessible, Thai typography. */
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

// ── Button ──
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-orange-800 disabled:bg-orange-300',
  secondary:
    'bg-white text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50 disabled:text-stone-400',
  ghost: 'text-stone-700 hover:bg-stone-100 disabled:text-stone-400',
  danger: 'bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50 disabled:text-red-300',
};
export function Button({
  variant = 'secondary',
  size = 'md',
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md';
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-sm' : 'px-4 py-2',
        variants[variant],
        className,
      )}
    >
      {busy && (
        <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

// ── Layout ──
export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: string;
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="text-xs font-semibold tracking-widest text-brand uppercase">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-bold text-stone-900">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm text-stone-600">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-semibold text-stone-900">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
      {children}
    </p>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
      <p className="text-sm text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-stone-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

// ── Badge ──
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
const tones: Record<Tone, string> = {
  neutral: 'bg-stone-100 text-stone-700',
  info: 'bg-sky-100 text-sky-800',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-800',
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// ── Forms ──
const control =
  'w-full rounded-lg border-0 bg-white px-3 py-2 text-stone-900 ring-1 ring-stone-300 placeholder:text-stone-400 focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-stone-100';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-stone-700">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

export const Input = ({
  label,
  hint,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) => (
  <Field label={label} hint={hint}>
    {(id) => <input id={id} {...p} className={cx(control, p.className)} />}
  </Field>
);

export const Textarea = ({
  label,
  hint,
  ...p
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode }) => (
  <Field label={label} hint={hint}>
    {(id) => <textarea id={id} rows={2} {...p} className={cx(control, p.className)} />}
  </Field>
);

export const Select = ({
  label,
  hint,
  options,
  ...p
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: ReactNode;
  options: Array<[string, string]>;
}) => (
  <Field label={label} hint={hint}>
    {(id) => (
      <select id={id} {...p} className={cx(control, p.className)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    )}
  </Field>
);

export function Check({
  label,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm text-stone-700">
      <input type="checkbox" {...p} className="mt-0.5 size-4 rounded accent-brand" />
      <span>{label}</span>
    </label>
  );
}

export const FormError = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {error}
    </p>
  ) : null;

// ── Dialog (native <dialog>, focus-trapped by the browser) ──
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className={cx(
        'm-auto w-[calc(100%-1.5rem)] rounded-2xl p-0 shadow-xl backdrop:bg-stone-900/40',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="max-h-[85svh] overflow-y-auto p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิด"
              className="rounded-lg px-2 text-xl text-stone-500 hover:bg-stone-100"
            >
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

// ── Table ──
export function Table({
  head,
  children,
  empty,
}: {
  head: ReactNode[];
  children: ReactNode;
  empty?: string;
}) {
  const hasRows = Array.isArray(children) ? children.flat().some(Boolean) : !!children;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="border-b border-stone-200 text-xs text-stone-500">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">{children}</tbody>
      </table>
      {!hasRows && empty && (
        <div className="py-4">
          <Empty>{empty}</Empty>
        </div>
      )}
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx('px-2 py-2 align-top', className)}>{children}</td>
);
