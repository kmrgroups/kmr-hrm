"use client";
export function PrintButton({ label = "Print" }: { label?: string }) {
  return <button type="button" className="btn secondary" onClick={() => window.print()}>{label}</button>;
}
