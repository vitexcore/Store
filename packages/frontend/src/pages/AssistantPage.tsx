export function AssistantPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">AI Assistant</h2>
        <p className="mt-1 text-sm text-slate-500">
          Ask questions about your store's performance and analytics.
        </p>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-medium text-blue-800">Read-only analytics assistant</p>
        <p className="mt-0.5 text-xs text-blue-700">
          The AI assistant can only read your store's analytics data. It cannot create, modify or
          delete any records, confirm payments, or access other stores' data.
        </p>
      </div>

      <div className="card border-dashed bg-surface-subtle">
        <p className="text-center text-sm text-slate-400">
          AI assistant will be implemented in Day 5.
        </p>
      </div>
    </div>
  );
}
