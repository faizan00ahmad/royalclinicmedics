"use client";

import { useEffect, useMemo, useState } from "react";
import { api, dayLabel, dublinDate, partOfDay, timeLabel } from "@/lib/client";

export interface PickedSlot { startAt: string; doctorId: string }
interface SlotsResponse { days: string[]; slots: { doctorId: string; startAt: string; endAt: string }[] }

/** BK-03: only days with free times, times grouped Morning / Afternoon / Evening, plus "Next available". */
export function SlotPicker({
  serviceId, doctorId, windowDays, onPick, busy,
}: { serviceId: string; doctorId?: string; windowDays: number; onPick: (s: PickedSlot) => void; busy?: boolean }) {
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    const from = dublinDate(new Date());
    const to = dublinDate(new Date(Date.now() + windowDays * 86_400_000));
    const qs = new URLSearchParams({ serviceId, from, to, ...(doctorId ? { doctorId } : {}) });
    api<SlotsResponse>(`/api/slots?${qs}`)
      .then((d) => { if (!cancelled) { setData(d); setDay(d.days[0] ?? ""); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [serviceId, doctorId, windowDays]);

  const todays = useMemo(() => {
    if (!data || !day) return [];
    const seen = new Set<string>();
    return data.slots.filter((s) => dublinDate(new Date(s.startAt)) === day && !seen.has(s.startAt) && seen.add(s.startAt));
  }, [data, day]);

  if (error) return <p role="alert" className="text-red-700">{error}</p>;
  if (!data) return <p>Loading free times...</p>;
  if (data.days.length === 0) return <p>There are no free times in the next {windowDays} days. Please phone the clinic.</p>;

  const parts = (["Morning", "Afternoon", "Evening"] as const).map((p) => ({ p, items: todays.filter((s) => partOfDay(s.startAt) === p) })).filter((g) => g.items.length);
  const first = data.slots[0]!;

  return (
    <div>
      <button type="button" disabled={busy} onClick={() => onPick({ startAt: first.startAt, doctorId: first.doctorId })}
        className="min-h-11 rounded-lg border-2 border-brand-700 px-4 font-semibold text-brand-700 disabled:opacity-50">
        Next available: {dayLabel(dublinDate(new Date(first.startAt)))} at {timeLabel(first.startAt)}
      </button>

      <h3 className="mt-6 font-semibold">Choose a day</h3>
      <div role="radiogroup" aria-label="Day" className="mt-2 flex gap-2 overflow-x-auto pb-2">
        {data.days.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={d === day} onClick={() => setDay(d)}
            className={`min-h-11 shrink-0 rounded-lg border-2 px-3 text-sm font-medium ${d === day ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300"}`}>
            {dayLabel(d)}
          </button>
        ))}
      </div>

      {parts.map((g) => (
        <section key={g.p} className="mt-4">
          <h3 className="font-semibold">{g.p}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {g.items.map((s) => (
              <button key={s.startAt} type="button" disabled={busy} onClick={() => onPick({ startAt: s.startAt, doctorId: s.doctorId })}
                className="min-h-11 min-w-20 rounded-lg border-2 border-slate-300 px-3 font-medium hover:border-brand-700 disabled:opacity-50">
                {timeLabel(s.startAt)}
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="mt-4 text-xs text-slate-500">All times are Irish time.</p>
    </div>
  );
}
