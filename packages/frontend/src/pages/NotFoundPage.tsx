import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
      <p className="text-6xl font-bold text-slate-200" aria-hidden="true">404</p>
      <h2 className="text-xl font-semibold text-slate-900">Page not found</h2>
      <p className="text-sm text-slate-500 max-w-xs">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link to="/dashboard" className="btn-primary mt-2">
        Go to Dashboard
      </Link>
    </div>
  );
}
