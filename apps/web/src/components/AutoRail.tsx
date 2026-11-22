"use client";

import { useEffect, useRef, useState } from "react";

const SPEED = 28; // pixels per second: slow and calm
const RESUME_MS = 4000; // wait after the visitor touches it

/**
 * Swipeable row that also drifts slowly on its own. It pauses while the visitor hovers, touches or
 * focuses it, stops for people who prefer reduced motion, and has a Pause/Play button (WCAG 2.2.2).
 */
export function AutoRail({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(false);
  const hold = useRef(false);
  const resumeAt = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || !playing || reduced) return;
    let raf = 0, last = 0, pos = el.scrollLeft, dir = 1, edgeUntil = 0;
    const tick = (t: number) => {
      const dt = last ? Math.min(t - last, 100) : 0;
      last = t;
      const max = el.scrollWidth - el.clientWidth;
      if (max > 4 && !hold.current && t > resumeAt.current && t > edgeUntil && document.visibilityState === "visible") {
        if (Math.abs(el.scrollLeft - pos) > 2) pos = el.scrollLeft; // the visitor moved it
        pos += (dir * SPEED * dt) / 1000;
        if (pos >= max) { pos = max; dir = -1; edgeUntil = t + 1500; }
        else if (pos <= 0) { pos = 0; dir = 1; edgeUntil = t + 1500; }
        el.scrollLeft = pos;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, reduced]);

  const touch = () => { resumeAt.current = performance.now() + RESUME_MS; };

  return (
    <section className="mt-8" aria-label={title}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl font-bold text-brand-800">{title}</h2>
          {hint && <p className="text-sm text-slate-600">{hint}</p>}
        </div>
        {!reduced && (
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing}
            className="inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-brand-800 hover:bg-brand-100">
            {playing ? "Pause" : "Play"}
          </button>
        )}
      </div>
      <div
        ref={box}
        tabIndex={0}
        onMouseEnter={() => { hold.current = true; }}
        onMouseLeave={() => { hold.current = false; touch(); }}
        onFocus={() => { hold.current = true; }}
        onBlur={() => { hold.current = false; touch(); }}
        onTouchStart={touch}
        onTouchMove={touch}
        onWheel={touch}
        className="-mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:thin]"
      >
        {children}
      </div>
    </section>
  );
}
