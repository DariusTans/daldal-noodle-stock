/**
 * Role-filtered view of the shop document.
 *
 * Owners and managers get the full document. Staff (no `expense` permission) must not see
 * finance: bills, prices, purchase totals, approval thresholds. The staff view keeps
 * everything the staff screens and today's-work list need (counts, stock, requests,
 * order names / quantities / receiving) and is display-only — it does not pass
 * `validate()` and must never be sent back as a state.
 */
import { can, type Role, type ShopState } from '../domain/index.js';

export interface StateView {
  revision: number;
  role: Role;
  redacted: boolean;
  state: ShopState;
}

export function viewFor(state: ShopState, role: Role): StateView {
  if (can(role, 'expense')) return { revision: state.revision, role, redacted: false, state };
  const redacted: ShopState = {
    ...state,
    expenses: [],
    expenseReviewer: null,
    purchasePolicy: null,
    purchasePolicyAudit: [],
    purchaseOrders: state.purchaseOrders.map((o) => {
      const purchase = o.purchase
        ? (({ total: _t, offer: _o, ...rest }) => rest)(o.purchase)
        : null;
      return {
        ...o,
        offers: [],
        selectionReason: '',
        policySnapshot: null,
        decision: null,
        purchase: purchase as ShopState['purchaseOrders'][number]['purchase'],
        // audit details can carry totals / offers / policies
        audit: o.audit.map(({ at, action, person, role }) => ({ at, action, person, role })),
      };
    }),
  };
  return { revision: state.revision, role, redacted: true, state: redacted };
}
