/**
 * Store Settings — view and update store profile.
 */

import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { LoadingSpinner } from '../components/ui/EmptyState.js';
import type { Store } from '@store/shared';

export function StoreSettingsPage() {
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [address, setAddress] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState('GBP');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.store.get().then((res) => {
      if (!mounted) return;
      if (res.ok) {
        const s = res.data;
        setStore(s);
        setName(s.name);
        setDescription(s.description ?? '');
        setContactEmail(s.contactEmail ?? '');
        setAddress(s.address ?? '');
        setDefaultCurrency(s.defaultCurrency);
      } else {
        setLoadError(res.message);
      }
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);

    if (!name.trim()) { setSaveError('Store name is required.'); return; }
    if (name.trim().length > 120) { setSaveError('Store name must be at most 120 characters.'); return; }
    if (description.length > 1000) { setSaveError('Description must be at most 1000 characters.'); return; }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setSaveError('Enter a valid contact email address.');
      return;
    }

    setSaving(true);
    const res = await api.store.update({
      name: name.trim(),
      description: description.trim() || null,
      contactEmail: contactEmail.trim() || null,
      address: address.trim() || null,
      defaultCurrency,
    });
    setSaving(false);

    if (res.ok) {
      setStore(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setSaveError(res.message);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Store Settings</h2>
        <p className="mt-1 text-sm text-slate-500">Update your store profile and contact information.</p>
      </div>

      {loading && <LoadingSpinner label="Loading settings…" />}
      {loadError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
          {loadError}
        </div>
      )}

      {!loading && store && (
        <form onSubmit={handleSave} className="card space-y-5" noValidate>
          {saveError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700" role="alert">
              {saveError}
            </div>
          )}
          {saved && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700" role="status">
              Settings saved successfully.
            </div>
          )}

          <div>
            <label className="label" htmlFor="s-name">Store name <span aria-hidden="true">*</span></label>
            <input
              id="s-name"
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              aria-describedby="s-name-hint"
            />
            <p id="s-name-hint" className="mt-1 text-xs text-slate-400">This appears as your store's display name.</p>
          </div>

          <div>
            <label className="label" htmlFor="s-slug">Store URL slug</label>
            <input
              id="s-slug"
              className="input bg-surface-raised cursor-not-allowed"
              type="text"
              value={store.slug}
              readOnly
              disabled
              aria-describedby="s-slug-hint"
            />
            <p id="s-slug-hint" className="mt-1 text-xs text-slate-400">The URL identifier for your store. Cannot be changed.</p>
          </div>

          <div>
            <label className="label" htmlFor="s-desc">Description</label>
            <textarea
              id="s-desc"
              className="input"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              placeholder="Tell customers about your store…"
            />
            <p className="mt-1 text-xs text-slate-400">{description.length}/1000</p>
          </div>

          <div>
            <label className="label" htmlFor="s-email">Contact email</label>
            <input
              id="s-email"
              className="input"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              maxLength={254}
              placeholder="contact@yourstore.com"
            />
          </div>

          <div>
            <label className="label" htmlFor="s-address">Business address</label>
            <textarea
              id="s-address"
              className="input"
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={500}
              placeholder="123 High Street, London…"
            />
          </div>

          <div>
            <label className="label" htmlFor="s-currency">Default currency</label>
            <select
              id="s-currency"
              className="input max-w-[180px]"
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
            >
              <option value="GBP">GBP — British Pound</option>
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
            </select>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <p className="text-xs text-slate-400">
              Store ID: <span className="font-mono">{store.id.substring(0, 8)}…</span>
            </p>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
