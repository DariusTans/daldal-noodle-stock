/**
 * UI primitives that render the prototype's markup and classes (src/app/legacy-css, copied
 * verbatim from legacy/assets). Keep class names identical to legacy — the CSS is the CI.
 */
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

// ── Button: legacy uses .primary / .secondary / .text-button / .mini ──
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
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
  const cls =
    size === 'sm'
      ? 'mini'
      : variant === 'primary'
        ? 'primary'
        : variant === 'ghost'
          ? 'text-button'
          : 'secondary';
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={cx(cls, className)}
    >
      {children}
    </button>
  );
}

// ── Page heading: .page-head > div > .eyebrow + h1 + .subtitle ──
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
    <div className="page-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {sub && <p className="subtitle">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

// ── Panel: section.panel > .panel-heading > h3 ──
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
    <section className={cx('panel', className)}>
      {(title || actions) && (
        <div className="panel-heading">
          {title && <h3>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

// ── Stats: .stats > .stat > div > small + strong(+.stat-unit) + .stat-symbol ──
export const Stats = ({ children }: { children: ReactNode }) => (
  <div className="stats">{children}</div>
);
export function Stat({
  label,
  value,
  unit,
  symbol,
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  symbol?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="stat">
      <div>
        <small>{label}</small>
        <strong>
          {value}
          {unit && <span className="stat-unit">{unit}</span>}
        </strong>
        {hint && <small>{hint}</small>}
      </div>
      {symbol && <span className="stat-symbol">{symbol}</span>}
    </div>
  );
}

// ── Chip ──
type Tone = 'ok' | 'review' | 'draft' | 'off' | 'category';
/** transitional aliases used by screens not yet rewritten to legacy markup */
type ToneAlias = 'success' | 'warning' | 'info' | 'neutral' | 'danger';
const ALIAS: Record<ToneAlias, Tone> = {
  success: 'ok',
  warning: 'review',
  info: 'draft',
  neutral: 'off',
  danger: 'review',
};
export function Badge({ tone = 'ok', children }: { tone?: Tone | ToneAlias; children: ReactNode }) {
  const t = (ALIAS as Record<string, Tone>)[tone] ?? (tone as Tone);
  return <span className={cx('chip', t !== 'ok' && t)}>{children}</span>;
}

// ── Form fields: label.field{.wide} > text + control ──
export const Input = ({
  label,
  hint,
  wide,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; wide?: boolean }) => (
  <label className={cx('field', wide && 'wide')}>
    {label}
    <input {...p} />
    {hint && <span>{hint}</span>}
  </label>
);

export const Textarea = ({
  label,
  hint,
  wide = true,
  ...p
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: ReactNode;
  wide?: boolean;
}) => (
  <label className={cx('field', wide && 'wide')}>
    {label}
    <textarea {...p} />
    {hint && <span>{hint}</span>}
  </label>
);

export const Select = ({
  label,
  hint,
  options,
  wide,
  ...p
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: ReactNode;
  options: Array<[string, string]>;
  wide?: boolean;
}) => (
  <label className={cx('field', wide && 'wide')}>
    {label}
    <select {...p}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
    {hint && <span>{hint}</span>}
  </label>
);

export const FieldGrid = ({ children }: { children: ReactNode }) => (
  <div className="field-grid">{children}</div>
);

export function Check({
  label,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="stock-checkbox">
      <input type="checkbox" {...p} />
      <span>{label}</span>
    </label>
  );
}

export const FormError = ({ error }: { error: string | null }) => (
  <p role="alert" className="form-error">
    {error ?? ''}
  </p>
);

// ── Dialog: native <dialog> > .dialog-head(.eyebrow + h2, .icon-btn ×) ──
export function Dialog({
  open,
  onClose,
  title,
  eyebrow = 'DALDAL',
  head,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  /** extra content under the title (legacy puts the status chip here) */
  head?: ReactNode;
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
    <dialog ref={ref} onClose={onClose} onCancel={onClose}>
      {open && (
        <>
          <div className="dialog-head">
            <div>
              <span className="eyebrow">{eyebrow}</span>
              <h2>{title}</h2>
              {head}
            </div>
            <button className="icon-btn" type="button" aria-label="ปิด" onClick={onClose}>
              ×
            </button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}

// ── Table: .table-wrap > table ──
export function Table({
  head,
  children,
  empty,
  label,
}: {
  head: ReactNode[];
  children: ReactNode;
  empty?: string;
  label?: string;
}) {
  const hasRows = Array.isArray(children) ? children.flat().some(Boolean) : !!children;
  return (
    <div className="table-wrap">
      <table aria-label={label}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {!hasRows && empty && <Empty>{empty}</Empty>}
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={className}>{children}</td>
);
