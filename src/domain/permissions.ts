import { roles } from './constants';
import { hasOwn } from './util';

/**
 * Action → who may perform it. Same decision table as the layered legacy `can`.
 * Note: the master-data fallback grants `owner` every action, including unknown ones.
 */
export type Action =
  | 'ingredient'
  | 'unit'
  | 'status'
  | 'count'
  | 'reviewCount'
  | 'movement'
  | 'request'
  | 'adjust'
  | 'stockReview'
  | 'policy'
  | 'requestReview'
  | 'buy'
  | 'buySettings'
  | 'receive'
  | 'receiveReview'
  | 'expense'
  | 'expenseSettings';

const isRole = (role: unknown): boolean => hasOwn(roles, role);
const isReviewer = (role: unknown): boolean => role === 'owner' || role === 'manager';

export function can(role: unknown, action: string): boolean {
  switch (action) {
    case 'expense':
      return isReviewer(role);
    case 'expenseSettings':
      return role === 'owner';
    case 'receive':
      return isRole(role);
    case 'receiveReview':
      return isReviewer(role);
    case 'buy':
      return isReviewer(role);
    case 'buySettings':
      return role === 'owner';
    case 'movement':
    case 'request':
      return isRole(role);
    case 'adjust':
    case 'stockReview':
    case 'policy':
    case 'requestReview':
      return isReviewer(role);
    case 'count':
      return isRole(role);
    case 'reviewCount':
      return isReviewer(role);
    default:
      return (
        role === 'owner' ||
        (role === 'manager' && ['ingredient', 'unit', 'status'].includes(action))
      );
  }
}
