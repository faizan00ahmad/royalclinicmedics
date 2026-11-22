import type { ReactNode } from "react";

export const btn = "inline-flex min-h-10 items-center justify-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50";
export const btnLight = "inline-flex min-h-10 items-center justify-center rounded-lg border-2 border-slate-300 px-4 text-sm font-semibold hover:border-brand-700";
export const btnDanger = "inline-flex min-h-10 items-center justify-center rounded-lg border-2 border-red-700 px-4 text-sm font-semibold text-red-700 hover:bg-red-50";
export const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-slate-600">{sub}</p>}
    </div>
  );
}

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <p role={error ? "alert" : "status"} className={`mb-4 rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-brand-50 text-brand-900"}`}>
      {error ?? ok}
    </p>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 ${className}`}>
      {title && <h2 className="mb-3 font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  );
}

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: "bg-blue-100 text-blue-900", PENDING_PAYMENT: "bg-amber-100 text-amber-900", CHECKED_IN: "bg-purple-100 text-purple-900",
  COMPLETED: "bg-green-100 text-green-900", NO_SHOW: "bg-red-100 text-red-900", CANCELLED_BY_PATIENT: "bg-slate-200 text-slate-700",
  CANCELLED_BY_CLINIC: "bg-slate-200 text-slate-700", PAID: "bg-green-100 text-green-900", UNPAID: "bg-amber-100 text-amber-900",
  REFUNDED: "bg-slate-200 text-slate-700", PARTIALLY_REFUNDED: "bg-slate-200 text-slate-700", FAILED: "bg-red-100 text-red-900",
};

export function Badge({ value }: { value: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[value] ?? "bg-slate-100"}`}>{value.replaceAll("_", " ").toLowerCase()}</span>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{head.map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
export const td = "px-3 py-2 align-top";
