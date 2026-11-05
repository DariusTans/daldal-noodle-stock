/**
 * Shop state, schemaVersion 6 — identical JSON shape to the v0.8.1 prototype,
 * so prototype backups import unchanged and parity tests can deep-compare.
 */
import type {
  attachmentTypes,
  expenseCategories,
  ingredientCategories,
  movementKinds,
  orderStatuses,
  receiptIssues,
  unitTypes,
} from './constants.js';

export type Role = 'owner' | 'manager' | 'staff';
export type ReviewerRole = Exclude<Role, 'staff'>;
export type Currency = 'THB' | 'USD' | 'KRW' | 'JPY';
/** Money is always an integer in minor units (1/100). */
export type Minor = number;

export type IngredientCategory = (typeof ingredientCategories)[number];
export type UnitType = (typeof unitTypes)[number];

// ── Master data ──────────────────────────────────────────────
export interface Unit {
  id: string;
  name: string;
  symbol: string;
  type: UnitType;
}

export interface Ingredient {
  id: string;
  code: string;
  name: string;
  category: IngredientCategory;
  unitId: string;
  location: string;
  note: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MasterEvent {
  id: string;
  target: string;
  action: string;
  actor: string;
  time: string;
}

// ── Counting ─────────────────────────────────────────────────
export type CountStatus = 'draft' | 'review' | 'confirmed' | 'cancelled';

export interface CountLine {
  ingredientId: string;
  code: string;
  name: string;
  category: string;
  location: string;
  unitId: string;
  unitName: string;
  unitSymbol: string;
  previousQty: number | null;
  previousAt: string | null;
  previousRoundId: string | null;
  qty: number | null;
  countedAt: string | null;
  countedBy: string | null;
  reason: string;
  expectedQty?: number | null;
  expectedAt?: string | null;
  expectedBy?: string | null;
}

export interface QtyChange {
  ingredientId: string;
  before: number | null;
  after: number | null;
  reason: string;
}

export interface CountAudit {
  time: string;
  action: string;
  person: string;
  role: Role;
  changes?: QtyChange[];
  reason?: string;
}

export interface CountRound {
  id: string;
  title: string;
  status: CountStatus;
  createdBy: string;
  createdAt: string;
  submittedAt: string | null;
  submittedBy: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  feedback: string;
  cancelledAt: string | null;
  cancelReason: string;
  lines: CountLine[];
  audit: CountAudit[];
}

/** A confirmed count line enriched with its round (see `latestCounts`). */
export interface LatestCount extends CountLine {
  roundId: string;
  roundTitle: string;
  confirmedAt: string;
  confirmedBy: string;
}

// ── Stock ────────────────────────────────────────────────────
export type MovementKind = keyof typeof movementKinds;

export interface Movement {
  id: string;
  ingredientId: string;
  roundId: string;
  unitId: string;
  name: string;
  unitSymbol: string;
  kind: MovementKind;
  qty: number;
  delta: number;
  person: string;
  at: string;
  role: Role;
  reason: string;
  reference: string;
  reverseOf: string | null;
  receiptId?: string;
  purchaseOrderId?: string;
}

export interface StockCheck {
  id: string;
  ingredientId: string;
  roundId: string;
  /** `|`-joined movement ids covered by the check. */
  movementIds: string;
  complete: true;
  note: string;
  person: string;
  role: Role;
  at: string;
}

export interface StockPolicy {
  id: string;
  ingredientId: string;
  unitId: string;
  minimum: number;
  target: number;
  enabled: boolean;
  person: string;
  role: Role;
  at: string;
}

export type RequestStatus = 'draft' | 'ready' | 'cancelled' | 'completed';

export interface PurchaseRequest {
  id: string;
  ingredientId: string;
  roundId: string;
  name: string;
  unitSymbol: string;
  referenceQty: number;
  referenceAt: string;
  referenceBasis: 'count' | 'ledger';
  suggested: number;
  fingerprint: string;
  qty: number;
  status: RequestStatus;
  reason: string;
  person: string;
  role: Role;
  at: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewedRole?: Role;
  cancelReason?: string;
  cancelledAt?: string;
  completedOrderId?: string;
  completedAt?: string;
}

export interface StockAudit {
  id: string;
  at: string;
  action: string;
  target: string;
  person: string;
  role: Role;
  [detail: string]: unknown;
}

export interface StockRow extends Ingredient {
  unit: Unit;
  base: LatestCount | undefined;
  movements: Movement[];
  net: number;
  ledger: number | null;
  check: StockCheck | null | undefined;
  policy: StockPolicy | undefined;
  referenceQty: number | null;
  referenceAt: string | null;
  low: boolean;
  suggested: number | null;
  fingerprint: string;
}

// ── Purchasing ───────────────────────────────────────────────
export type OrderStatus = keyof typeof orderStatuses;

export interface PurchasePolicy {
  id: string;
  currency: Currency;
  mode: 'all' | 'above';
  threshold: Minor;
  approver: string;
  approverRole: ReviewerRole;
  note: string;
  person: string;
  at: string;
}

export interface Offer {
  id: string;
  vendor: string;
  packQty: number;
  packPrice: Minor;
  shipping: Minor;
  extra: Minor;
  discount: Minor;
  currency: Currency;
  source: string;
  conditions: string;
  quotedAt: string;
  at: string;
  person: string;
}

export interface QuoteTotal {
  packs: number;
  units: number;
  total: Minor;
  unitCost: number;
}

export interface Decision {
  type: 'approve' | 'clear';
  at: string;
  person: string;
  role: Role;
  reason: string;
  qty: number;
  offer: Offer;
  selectedId: string;
  total: Minor;
  sourceFingerprint: string;
}

export interface Purchase {
  reference: string;
  person: string;
  at: string;
  total: Minor;
  offer: Offer;
  qty: number;
  orderedQty: number;
  packCount: number;
  receivedQty: number;
}

export type Receiving =
  | { status: 'open' }
  | {
      status: 'closed';
      accepted: number;
      unreceived: number;
      reason: string;
      person: string;
      role: Role;
      at: string;
    };

export interface OrderAudit {
  at: string;
  action: string;
  person: string;
  role: Role;
  [detail: string]: unknown;
}

export interface PurchaseOrder {
  id: string;
  requestId: string;
  ingredientId: string;
  name: string;
  unitId: string;
  unitSymbol: string;
  qty: number;
  currency: Currency;
  status: OrderStatus;
  at: string;
  person: string;
  role: Role;
  sourceFingerprint: string;
  sourceCheckedBy: string;
  sourceCheckedAt: string;
  sourceReason: string;
  offers: Offer[];
  selectedId: string | null;
  selectionReason: string;
  policySnapshot: PurchasePolicy | null;
  decision: Decision | null;
  purchase: Purchase | null;
  audit: OrderAudit[];
  submittedAt?: string;
  submittedBy?: string;
  receiving?: Receiving;
}

// ── Receiving ────────────────────────────────────────────────
export type ReceiptIssue = keyof typeof receiptIssues;
export type ReceiptStatus = 'draft' | 'confirmed' | 'void' | 'cancelled';

export interface Resolution {
  note: string;
  person: string;
  role: Role;
  at: string;
}

export interface Receipt {
  id: string;
  orderId: string;
  ingredientId: string;
  unitId: string;
  status: ReceiptStatus;
  reference: string;
  accepted: number;
  rejected: number;
  issueType: ReceiptIssue;
  note: string;
  person: string;
  role: Role;
  at: string;
  baseRoundId: string;
  movementId: string | null;
  resolution: Resolution | null;
  confirmedBy?: string;
  confirmedRole?: Role;
  confirmedAt?: string;
  notCounted?: true;
  reversalId?: string;
  cancelReason?: string;
  cancelledBy?: string;
  cancelledRole?: Role;
  cancelledAt?: string;
}

export interface ReceivingSummary {
  receipts: Receipt[];
  accepted: number;
  rejected: number;
  remaining: number;
  issues: Receipt[];
  draft: Receipt | undefined;
  closed: boolean;
}

// ── Expenses ─────────────────────────────────────────────────
export type ExpenseStatus = 'draft' | 'pending' | 'returned' | 'confirmed' | 'cancelled';
export type ExpenseCategory = (typeof expenseCategories)[number];
export type Funding = 'shop' | 'personal';
export type AttachmentType = (typeof attachmentTypes)[number];

interface AttachmentBase {
  name: string;
  type: AttachmentType;
  size: number;
  /** sha-256 hex — also used for duplicate-bill detection */
  hash: string;
}

/** Prototype format: file embedded as a data: URL (≤ 350 KB, ≤ 1.4 MB per state). */
export interface InlineAttachment extends AttachmentBase {
  data: string;
}

/** Server format: file in the private Supabase Storage bucket `evidence` (≤ 5 MB). */
export interface StoredAttachment extends AttachmentBase {
  evidenceId: string;
  /** `<shop_id>/<evidence_id>` */
  path: string;
}

export type Attachment = InlineAttachment | StoredAttachment;

export const isStoredAttachment = (a: Attachment | null | undefined): a is StoredAttachment =>
  !!a &&
  typeof (a as InlineAttachment).data !== 'string' &&
  typeof (a as StoredAttachment).path === 'string';

export interface ExpenseReviewer {
  id: string;
  name: string;
  role: ReviewerRole;
  note: string;
  person: string;
  at: string;
}

export interface ExpenseSnapshot {
  vendor: string;
  date: string;
  reference: string;
  amount: Minor;
  currency: Currency;
  category: ExpenseCategory;
  funding: Funding;
  payer: string;
  orderId: string | null;
  note: string;
  noEvidenceReason: string;
  attachment: { name: string; hash: string } | null;
}

export interface ExpenseAudit {
  action: string;
  person: string;
  role: Role;
  note: string;
  at: string;
  before?: ExpenseSnapshot | null;
  after?: ExpenseSnapshot;
}

export interface ExpenseReview {
  person: string;
  role: Role;
  at: string;
  note: string;
  checked: true;
  warnings: string[];
}

export interface Expense {
  id: string;
  status: ExpenseStatus;
  vendor: string;
  /** Bill date, YYYY-MM-DD (Asia/Bangkok). */
  date: string;
  reference: string;
  amount: Minor;
  currency: Currency;
  category: ExpenseCategory;
  funding: Funding;
  payer: string;
  orderId: string | null;
  note: string;
  person: string;
  role: Role;
  at: string;
  attachment: Attachment | null;
  noEvidenceReason: string;
  audit: ExpenseAudit[];
  reviewPolicy?: ExpenseReviewer;
  review?: ExpenseReview;
  feedback?: string;
  cancelReason?: string;
}

// ── Whole state ──────────────────────────────────────────────
export interface ShopState {
  schemaVersion: 6;
  revision: number;
  units: Unit[];
  ingredients: Ingredient[];
  events: MasterEvent[];
  countRounds: CountRound[];
  movements: Movement[];
  stockChecks: StockCheck[];
  stockPolicies: StockPolicy[];
  purchaseRequests: PurchaseRequest[];
  stockAudit: StockAudit[];
  purchaseOrders: PurchaseOrder[];
  purchasePolicy: PurchasePolicy | null;
  purchasePolicyAudit: PurchasePolicy[];
  receipts: Receipt[];
  expenses: Expense[];
  expenseReviewer: ExpenseReviewer | null;
}
