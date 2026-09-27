// Shown instantly while a page's data loads, so every click gets immediate feedback.
export function PageLoading() {
  return (
    <div className="pageloading" role="status" aria-live="polite">
      <div className="bar" />
      <div className="spinner" />
      <span>Loading…</span>
    </div>
  );
}
