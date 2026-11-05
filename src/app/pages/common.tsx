import { useState, type FormEvent, type ReactNode } from 'react';
import type { ActionPayload, ActionType } from '@/server/actions';
import { useAction } from '../state';
import { Badge, Button, Dialog, FormError } from '../ui';

export type Run = <T extends ActionType>(
  type: T,
  payload: ActionPayload<T>,
  success?: string,
) => Promise<boolean>;

export const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
export const opt = (f: FormData, k: string) => str(f, k) || undefined;
export const bool = (f: FormData, k: string) => f.get(k) === 'on';

/** A form in a dialog that submits one action; shows rule errors inline, closes on success. */
export function ActionDialog({
  open,
  onClose,
  title,
  submitLabel = 'บันทึก',
  submit,
  children,
  wide,
  danger,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel?: string;
  submit: (f: FormData, run: Run) => Promise<boolean>;
  children: ReactNode;
  wide?: boolean;
  danger?: boolean;
}) {
  const { run, pending, error, setError } = useAction();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      if (await submit(new FormData(e.currentTarget), run)) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ทำรายการไม่สำเร็จ');
    }
  }
  return (
    <Dialog
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title={title}
      wide={wide}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {children}
        <FormError error={error} />
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Opens an ActionDialog from a button. */
export function DialogButton({
  label,
  variant = 'secondary',
  size,
  disabled,
  children,
}: {
  label: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  children: (close: () => void, open: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {children(() => setOpen(false), open)}
    </>
  );
}

/** One-click action (no form). Errors surface as a small inline message. */
export function ActionButton<T extends ActionType>({
  type,
  payload,
  success,
  children,
  variant = 'secondary',
  size = 'sm',
  disabled,
}: {
  type: T;
  payload: ActionPayload<T>;
  success?: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const { run, pending, error } = useAction();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size={size}
        busy={pending}
        disabled={disabled}
        onClick={() => run(type, payload, success)}
      >
        {children}
      </Button>
      {error && <span className="max-w-xs text-xs text-red-700">{error}</span>}
    </span>
  );
}

const STATUS: Record<string, [string, 'neutral' | 'info' | 'success' | 'warning' | 'danger']> = {
  draft: ['ร่าง', 'neutral'],
  review: ['รอตรวจยอด', 'info'],
  confirmed: ['ยืนยันแล้ว', 'success'],
  cancelled: ['ยกเลิก', 'neutral'],
  ready: ['ตรวจแล้ว รอจัดซื้อ', 'info'],
  completed: ['ปิดงานแล้ว', 'success'],
  pending: ['รอพิจารณา', 'warning'],
  returned: ['ส่งกลับแก้ไข', 'warning'],
  approved: ['อนุมัติแล้ว', 'success'],
  cleared: ['ผ่าน (ไม่เข้าเกณฑ์วงเงิน)', 'success'],
  rejected: ['ไม่อนุมัติ', 'danger'],
  ordered: ['ซื้อแล้ว รอตรวจรับ', 'info'],
  void: ['ยกเลิกและกลับรายการ', 'neutral'],
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const [text, tone] = STATUS[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label ?? text}</Badge>;
}
