"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About the doctor" },
  { href: "/services", label: "Services" },
  { href: "/prices", label: "Prices" },
  { href: "/faqs", label: "FAQs" },
  { href: "/contact", label: "Contact" },
];

/** Header: logo, nav with the current page marked, Call and Book, and a proper menu panel on phones. */
export function SiteHeader({ name, phoneLabel, phoneHref }: { name: string; phoneLabel?: string; phoneHref?: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = ""; };
  }, [open]);

  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

  return (
    <header className={`sticky top-0 z-40 border-b bg-white/95 backdrop-blur transition-shadow ${scrolled || open ? "border-slate-200 shadow-md" : "border-transparent"}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <Link href="/" className="inline-flex min-h-11 items-center" aria-label={`${name} home`}><Logo /></Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}
              className={`relative inline-flex min-h-11 items-center px-3 text-sm font-semibold transition-colors ${active(n.href) ? "text-brand-800" : "text-slate-600 hover:text-brand-800"}`}>
              {n.label}
              <span aria-hidden="true" className={`absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-accent-500 transition-opacity ${active(n.href) ? "opacity-100" : "opacity-0"}`} />
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {phoneHref && (
            <a href={phoneHref} className="hidden min-h-11 items-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-brand-800 hover:bg-brand-100 lg:inline-flex">
              Call {phoneLabel}
            </a>
          )}
          <Link href="/admin/login" className="hidden min-h-11 items-center rounded-full px-3 text-sm font-semibold text-slate-600 hover:text-brand-800 md:inline-flex">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mr-1.5"><circle cx="10" cy="7" r="3.5" /><path d="M3.5 17c.8-3.2 3.3-5 6.5-5s5.7 1.8 6.5 5" /></svg>
            Admin sign in
          </Link>
          <Link href="/book" className="inline-flex min-h-11 items-center rounded-full bg-accent-500 px-5 text-sm font-bold text-white hover:bg-accent-600">Book now</Link>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex size-11 items-center justify-center rounded-full border border-slate-300 text-brand-800 md:hidden">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M3 5h14M3 10h14M3 15h14" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-menu" aria-label="Main (mobile)" className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-slate-200 bg-white px-4 pb-6 pt-2 md:hidden">
          <ul>
            {NAV.map((n) => (
              <li key={n.href} className="border-b border-slate-100">
                <Link href={n.href} aria-current={active(n.href) ? "page" : undefined}
                  className={`flex min-h-12 items-center justify-between text-lg font-semibold ${active(n.href) ? "text-accent-500" : "text-brand-800"}`}>
                  {n.label}
                  <span aria-hidden="true" className="text-slate-400">›</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/admin/login" className="mt-4 flex min-h-12 items-center justify-center rounded-full border border-slate-300 font-semibold text-brand-800">Admin sign in</Link>
          {phoneHref && <a href={phoneHref} className="mt-3 flex min-h-12 items-center justify-center rounded-full border-2 border-brand-700 font-bold text-brand-700">Call {phoneLabel}</a>}
        </nav>
      )}
    </header>
  );
}
