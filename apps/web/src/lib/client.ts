/** Browser-side helpers. Must not import server packages such as @rmc/core. */
const TZ = "Europe/Dublin";

export const euro = (cents: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);

export const dublinDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); // YYYY-MM-DD

export const dublinHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d)) % 24;

export const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-IE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export const dayLabel = (isoDate: string) =>
  new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${isoDate}T12:00:00Z`));

/** NFR-08: "Mon 24 Nov 2026, 10:30" */
export const fullLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-IE", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export function partOfDay(iso: string): "Morning" | "Afternoon" | "Evening" {
  const h = dublinHour(new Date(iso));
  return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
}

export interface ApiFailure { error: string; message?: string; issues?: { path: string; message: string }[] }

export async function api<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const headers: Record<string, string> = { ...(init?.body ? { "content-type": "application/json" } : {}) };
  if (init?.token) headers["x-manage-token"] = init.token;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const f = data as ApiFailure;
    const detail = f.issues?.length ? `Please check: ${f.issues.map((i) => i.path || "form").join(", ")}.` : "";
    throw Object.assign(new Error(f.message ?? detail ?? "Something went wrong."), { code: f.error, status: res.status });
  }
  return data as T;
}
