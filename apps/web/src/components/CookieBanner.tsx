"use client";

import { useEffect, useState } from "react";

const KEY = "rmc_cookie_consent";
const TWELVE_MONTHS_MS = 365 * 24 * 3600 * 1000;

type Choice = { analytics: boolean; at: number };

function read(): Choice | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Choice;
    return Date.now() - c.at < TWELVE_MONTHS_MS ? c : null; // WEB-13: choice kept for 12 months
  } catch {
    return null;
  }
}

function loadAnalytics(gaId: string) {
  if (!gaId || document.getElementById("ga-script")) return;
  const s = document.createElement("script");
  s.id = "ga-script";
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
  document.head.appendChild(s);
  const w = window as unknown as { dataLayer: unknown[]; gtag: (...a: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  w.gtag = function () { w.dataLayer.push(arguments); };
  w.gtag("js", new Date());
  w.gtag("config", gaId, { anonymize_ip: true });
}

/** WEB-13, GDPR-03. Analytics is off until the visitor accepts. Reject is as easy as accept. */
export function CookieBanner({ gaId }: { gaId: string }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    const c = read();
    if (c?.analytics) loadAnalytics(gaId);
    setOpen(!c);
    const reopen = (e: Event) => {
      if ((e.target as HTMLElement).closest("[data-cookie-settings]")) setOpen(true);
    };
    document.addEventListener("click", reopen);
    return () => document.removeEventListener("click", reopen);
  }, [gaId]);

  function save(a: boolean) {
    try { localStorage.setItem(KEY, JSON.stringify({ analytics: a, at: Date.now() } satisfies Choice)); } catch { /* storage blocked */ }
    if (a) loadAnalytics(gaId);
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div role="dialog" aria-label="Cookie preferences" className="fixed inset-x-2 bottom-20 z-50 mx-auto max-w-xl rounded-xl border border-slate-300 bg-white p-4 shadow-xl md:bottom-4">
      <p className="text-sm text-slate-700">
        We use necessary cookies to run the site. With your permission we also use analytics to see how the site is used.
        We never put health information in analytics. <a className="underline" href="/cookies">Cookie policy</a>
      </p>
      {custom && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked disabled className="size-4" /> Necessary (always on)
          <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="ml-4 size-4" /> Analytics
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => save(false)} className="min-h-11 rounded-lg border-2 border-slate-700 px-4 font-semibold">Reject all</button>
        {custom ? (
          <button type="button" onClick={() => save(analytics)} className="min-h-11 rounded-lg border-2 border-slate-700 px-4 font-semibold">Save choices</button>
        ) : (
          <button type="button" onClick={() => setCustom(true)} className="min-h-11 rounded-lg border-2 border-slate-300 px-4 font-semibold">Customise</button>
        )}
        <button type="button" onClick={() => save(true)} className="min-h-11 rounded-lg bg-brand-700 px-4 font-semibold text-white">Accept all</button>
      </div>
    </div>
  );
}
