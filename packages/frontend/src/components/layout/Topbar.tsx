interface TopbarProps {
  onMenuClick: () => void;
  /** Whether the mobile sidebar is currently open — used for aria-expanded */
  sidebarOpen: boolean;
  title: string;
}

export function Topbar({ onMenuClick, sidebarOpen, title }: TopbarProps) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-border bg-white px-4 lg:px-6">
      {/* Mobile menu button */}
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

      <h1 className="text-base font-semibold text-slate-900">{title}</h1>

      {/* Right-side placeholder actions — expanded in Day 2 with auth */}
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          Demo
        </span>
      </div>
    </header>
  );
}
