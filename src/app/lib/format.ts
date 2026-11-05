import { formatMinor, roles, type Currency, type Role } from '@/domain';

const TZ = 'Asia/Bangkok';

export const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: TZ,
      })
    : '—';

export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso.length === 10 ? iso + 'T00:00:00+07:00' : iso).toLocaleDateString('th-TH', {
        dateStyle: 'medium',
        timeZone: TZ,
      })
    : '—';

export const fmtQty = (n: number | null | undefined, unit?: string) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString('th-TH', { maximumFractionDigits: 3 }) + (unit ? ' ' + unit : '');

export const fmtMoney = (minor: number | null | undefined, currency: Currency | string = 'THB') =>
  minor === null || minor === undefined
    ? '—'
    : formatMinor(minor) + ' ' + (currency === 'THB' ? 'บาท' : currency);

/** Minor units → plain input string ("12.50"). */
export const moneyInput = (minor: number) => (minor / 100).toFixed(2);

export const roleName = (r: Role | string) => roles[r as Role] ?? r;

/** Local "now" for datetime-local inputs (Bangkok). */
export const nowLocalInput = () => {
  const d = new Date(Date.now() + 7 * 3600_000);
  return d.toISOString().slice(0, 16);
};
/** datetime-local (Bangkok wall time) → ISO */
export const localInputToIso = (v: string) => new Date(v + ':00+07:00').toISOString();

export const todayBangkok = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
