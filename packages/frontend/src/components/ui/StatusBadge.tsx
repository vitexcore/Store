/** Status badge — uses both colour and text label (never colour alone). */

import type { ProductStatus, OrderStatus, PaymentStatus } from '@store/shared';

type AnyStatus = ProductStatus | OrderStatus | PaymentStatus | 'low_stock' | 'ok_stock';

const BADGE_CLASSES: Record<string, string> = {
  // Order statuses
  pending:          'badge-pending',
  confirmed:        'badge-confirmed',
  cancelled:        'badge-cancelled',
  refunded:         'badge-cancelled',
  // Product statuses
  active:           'badge-active',
  draft:            'badge-draft',
  archived:         'badge-archived',
  // Payment statuses
  awaiting_payment: 'badge-pending',
  paid:             'badge-confirmed',
  failed:           'badge-failed',
  expired:          'badge-expired',
  // Inventory
  low_stock:        'badge bg-amber-100 text-amber-800',
  ok_stock:         'badge bg-emerald-100 text-emerald-800',
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
  const cls = BADGE_CLASSES[status] ?? 'badge bg-slate-100 text-slate-600';
  const text = label ?? LABELS[status] ?? status;
  return <span className={cls}>{text}</span>;
}
