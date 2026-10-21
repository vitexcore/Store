import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';

interface TopbarProps {
  onMenuClick: () => void;
  sidebarOpen: boolean;
  title: string;
}

export function Topbar({ onMenuClick, sidebarOpen, title }: TopbarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  }

  const initials = user?.email ? user.email.substring(0, 2).toUpperCase() : '??';

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-border bg-white dark:bg-slate-900 dark:border-slate-700 px-4 lg:px-6">
      <button
        type="button"
        className="btn-ghost -ml-1 p-2 lg:hidden"
        onClick={onMenuClick}
        aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={sidebarOpen}
        aria-controls="sidebar"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h1>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          Demo
        </span>

        <ThemeToggle />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg p-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-surface-raised dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label="User menu"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/60 text-xs font-semibold text-brand-700 dark:text-brand-300">
              {initials}
            </span>
            <span className="hidden sm:inline max-w-[160px] truncate">{user?.storeName ?? user?.email}</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 text-slate-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-border dark:border-slate-700 bg-white dark:bg-slate-800 py-1 shadow-card-hover" role="menu">
              <div className="border-b border-border dark:border-slate-700 px-4 py-2">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{user?.email}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.storeName ?? 'No store'}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-surface-raised dark:hover:bg-slate-700"
                role="menuitem"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
