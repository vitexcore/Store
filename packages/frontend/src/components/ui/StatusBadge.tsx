import type { ProductStatus, OrderStatus, PaymentStatus } from '@store/shared';

type AnyStatus = ProductStatus | OrderStatus | PaymentStatus | 'low_stock' | 'ok_stock';

const BADGE_CLASSES: Record<string, string> = {
  pending:          'badge-pending',
  confirmed:        'badge-confirmed',
  cancelled:        'badge-cancelled',
  refunded:         'badge-cancelled',
  active:           'badge-active',
  draft:            'badge-draft',
  archived:         'badge-archived',
  awaiting_payment: 'badge-pending',
  paid:             'badge-confirmed',
  failed:           'badge-failed',
  expired:          'badge-expired',
  low_stock:        'badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  ok_stock:         'badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
};

const LABELS: Record<string, string> = {
  pending:          'Pending',
  confirmed:        'Confirmed',
  cancelled:        'Cancelled',
  refunded:         'Refunded',
  active:           'Active',
  draft:            'Draft',
  archived:         'Archived',
  awaiting_payment: 'Awaiting Payment',
  paid:             'Paid',
  failed:           'Failed',
  expired:          'Expired',
  low_stock:        'Low Stock',
  ok_stock:         'In Stock',
};

interface StatusBadgeProps {
  status: AnyStatus;
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const cls = BADGE_CLASSES[status] ?? 'badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
  const text = label ?? LABELS[status] ?? status;
  return <span className={cls}>{text}</span>;
}
