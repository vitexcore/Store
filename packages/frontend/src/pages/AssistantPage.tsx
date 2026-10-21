export function AssistantPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">AI Assistant</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Ask questions about your store's performance and analytics.
        </p>
      </div>

      <div className="rounded-lg border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/20 p-4">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Read-only analytics assistant</p>
        <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-400">
          The AI assistant can only read your store's analytics data. It cannot create, modify or
          delete any records, confirm payments, or access other stores' data.
        </p>
      </div>

      <div className="card border-dashed bg-surface-subtle dark:bg-slate-900/30">
        <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-slate-300 dark:text-slate-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Assistant not yet available</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm">
            Once connected, you can ask questions like "What were my top-selling products last week?" or "Show me revenue by category this month."
          </p>
        </div>
      </div>
    </div>
  );
}
