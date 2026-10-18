/**
 * Register page — creates a new merchant account with a store.
 *
 * Registration creates both a store and a merchant user associated with it.
 * Accessible at /register. Redirects to /dashboard if already authenticated.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { APP_NAME } from '@store/shared';

export function RegisterPage() {
  const { register, loading, error, clearError } = useAuth();
  const navigate = useNavigate();

  const [storeName, setStoreName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!storeName.trim()) errors.storeName = 'Store name is required.';
    else if (storeName.length > 120) errors.storeName = 'Store name must be 120 characters or fewer.';

    const emailRegex = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
    if (!email.trim()) errors.email = 'Email is required.';
    else if (!emailRegex.test(email)) errors.email = 'Enter a valid email address.';

    if (!password) errors.password = 'Password is required.';
    else if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    else if (password.length > 128) errors.password = 'Password must be 128 characters or fewer.';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    if (!validate()) return;
    const ok = await register(email.trim(), password, storeName.trim());
    if (ok) navigate('/dashboard', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle px-4 py-8">
      <div className="w-full max-w-md">
        {/* Brand header */}
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600">
            <svg viewBox="0 0 24 24" fill="white" className="h-7 w-7" aria-hidden="true">
              <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-slate-500">Create your merchant account</p>
        </div>

        {/* Form card */}
        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Server error banner */}
            {error && (
              <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="storeName" className="label">Store name</label>
              <input
                id="storeName"
                type="text"
                autoComplete="organization"
                className="input"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                aria-invalid={!!fieldErrors.storeName}
                aria-describedby={fieldErrors.storeName ? 'storeName-error' : undefined}
                disabled={loading}
                maxLength={120}
                required
              />
              {fieldErrors.storeName && (
                <p id="storeName-error" className="mt-1 text-xs text-red-600">{fieldErrors.storeName}</p>
              )}
            </div>

            <div>
              <label htmlFor="email" className="label">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                disabled={loading}
                required
              />
              {fieldErrors.email && (
                <p id="email-error" className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="label">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? 'password-error' : 'password-hint'}
                disabled={loading}
                minLength={8}
                required
              />
              {fieldErrors.password ? (
                <p id="password-error" className="mt-1 text-xs text-red-600">{fieldErrors.password}</p>
              ) : (
                <p id="password-hint" className="mt-1 text-xs text-slate-400">Minimum 8 characters.</p>
              )}
            </div>

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={loading}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
              Sign in
            </Link>
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Demo application. Payments are simulated and do not transfer real funds.
        </p>
      </div>
    </div>
  );
}
