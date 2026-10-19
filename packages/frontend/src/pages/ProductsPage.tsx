/**
 * Products — full product catalogue management.
 * List, search/filter, create, edit, archive.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { Pagination } from '../components/ui/Pagination.js';
import { Modal } from '../components/ui/Modal.js';
import { EmptyState, LoadingSpinner } from '../components/ui/EmptyState.js';
import type { Product } from '@store/shared';

function formatCurrency(cents: number, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

interface ProductFormData {
  name: string;
  description: string;
  price_pounds: string; // user types in £ — converted to cents on submit
  currency: string;
  status: string;
  stock_quantity: string;
  low_stock_threshold: string;
}

const EMPTY_FORM: ProductFormData = {
  name: '',
  description: '',
  price_pounds: '',
  currency: 'GBP',
  status: 'draft',
  stock_quantity: '0',
  low_stock_threshold: '5',
};

function productToForm(p: Product): ProductFormData {
  return {
    name: p.name,
    description: p.description,
    price_pounds: (p.priceCents / 100).toFixed(2),
    currency: p.currency,
    status: p.status,
    stock_quantity: String(p.stockQuantity),
    low_stock_threshold: String(p.lowStockThreshold),
  };
}

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormData>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.products.list({ page, pageSize: 20, search: search || undefined, status: statusFilter });
    if (res.ok) {
      setProducts(res.data.items);
      setMeta(res.data.meta);
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  function openCreate() {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    setEditingProduct(p);
    setForm(productToForm(p));
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setFormError(null);
    const priceCents = Math.round(parseFloat(form.price_pounds) * 100);
    if (!form.name.trim()) { setFormError('Product name is required.'); return; }
    if (isNaN(priceCents) || priceCents < 0) { setFormError('Enter a valid price (e.g. 9.99).'); return; }
    const stockQty = parseInt(form.stock_quantity, 10);
    if (isNaN(stockQty) || stockQty < 0) { setFormError('Stock quantity must be 0 or more.'); return; }
    const threshold = parseInt(form.low_stock_threshold, 10);
    if (isNaN(threshold) || threshold < 0) { setFormError('Low stock threshold must be 0 or more.'); return; }

    setSaving(true);
    let res;
    if (editingProduct) {
      res = await api.products.update(editingProduct.id, {
        name: form.name.trim(),
        description: form.description,
        price_cents: priceCents,
        currency: form.currency,
        status: form.status,
        low_stock_threshold: threshold,
      });
    } else {
      res = await api.products.create({
        name: form.name.trim(),
        description: form.description,
        price_cents: priceCents,
        currency: form.currency,
        status: form.status,
        stock_quantity: stockQty,
        low_stock_threshold: threshold,
      });
    }
    setSaving(false);

    if (res.ok) {
      setModalOpen(false);
      load();
    } else {
      setFormError(res.message);
    }
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    setArchiving(true);
    const res = await api.products.archive(archiveTarget.id);
    setArchiving(false);
    setArchiveTarget(null);
    if (res.ok) load();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Products</h2>
          <p className="mt-1 text-sm text-slate-500">Manage your store's product catalogue.</p>
        </div>
        <button type="button" className="btn-primary" onClick={openCreate}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add product
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          className="input sm:max-w-xs"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search products"
        />
        <select
          className="input sm:max-w-[180px]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && <LoadingSpinner label="Loading products…" />}

      {/* Empty */}
      {!loading && products.length === 0 && (
        <EmptyState
          title="No products found"
          description={search || statusFilter !== 'all' ? 'Try adjusting your search or filter.' : 'Add your first product to start building your catalogue.'}
          action={!search && statusFilter === 'all' ? (
            <button type="button" className="btn-primary" onClick={openCreate}>Add product</button>
          ) : undefined}
        />
      )}

      {/* Table */}
      {!loading && products.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-subtle">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Product</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Price</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Stock</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p) => {
                  const isLow = p.stockQuantity <= p.lowStockThreshold;
                  return (
                    <tr key={p.id} className="hover:bg-surface-subtle transition-colors">
                      <td className="px-6 py-3">
                        <p className="font-medium text-slate-900">{p.name}</p>
                        {p.description && <p className="text-xs text-slate-400 truncate max-w-xs">{p.description}</p>}
                      </td>
                      <td className="px-6 py-3"><StatusBadge status={p.status} /></td>
                      <td className="px-6 py-3 text-right font-medium text-slate-900">{formatCurrency(p.priceCents, p.currency)}</td>
                      <td className="px-6 py-3 text-right">
                        <span className={`font-mono text-sm ${isLow ? 'text-amber-700 font-semibold' : 'text-slate-700'}`}>
                          {p.stockQuantity}
                        </span>
                        {isLow && <span className="ml-1 text-xs text-amber-600">low</span>}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-xs"
                            onClick={() => openEdit(p)}
                          >
                            Edit
                          </button>
                          {p.status !== 'archived' && (
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1 text-xs text-amber-700 hover:bg-amber-50"
                              onClick={() => setArchiveTarget(p)}
                            >
                              Archive
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-6">
            <Pagination
              page={meta.page}
              totalPages={meta.totalPages}
              total={meta.total}
              pageSize={meta.pageSize}
              onPage={setPage}
            />
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingProduct ? 'Edit product' : 'Add product'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : (editingProduct ? 'Save changes' : 'Create product')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700" role="alert">
              {formError}
            </div>
          )}
          <div>
            <label className="label" htmlFor="prod-name">Name <span aria-hidden="true">*</span></label>
            <input id="prod-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200} required />
          </div>
          <div>
            <label className="label" htmlFor="prod-desc">Description</label>
            <textarea id="prod-desc" className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="prod-price">Price (£) <span aria-hidden="true">*</span></label>
              <input id="prod-price" className="input" type="number" min="0" step="0.01" value={form.price_pounds} onChange={(e) => setForm({ ...form, price_pounds: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="prod-currency">Currency</label>
              <select id="prod-currency" className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="GBP">GBP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="prod-status">Status</label>
            <select id="prod-status" className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          {!editingProduct && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="prod-stock">Initial stock</label>
                <input id="prod-stock" className="input" type="number" min="0" step="1" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="prod-threshold">Low stock alert at</label>
                <input id="prod-threshold" className="input" type="number" min="0" step="1" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} />
              </div>
            </div>
          )}
          {editingProduct && (
            <div>
              <label className="label" htmlFor="prod-threshold2">Low stock alert at</label>
              <input id="prod-threshold2" className="input" type="number" min="0" step="1" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} />
            </div>
          )}
        </div>
      </Modal>

      {/* Archive confirm modal */}
      <Modal
        open={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        title="Archive product"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setArchiveTarget(null)}>Cancel</button>
            <button type="button" className="btn-danger" onClick={handleArchive} disabled={archiving}>
              {archiving ? 'Archiving…' : 'Archive product'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Archive <strong>{archiveTarget?.name}</strong>? It will be hidden from your catalogue but not deleted.
          You can restore it by editing and changing the status back to active.
        </p>
      </Modal>
    </div>
  );
}
