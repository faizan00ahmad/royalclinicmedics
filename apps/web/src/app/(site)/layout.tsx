import Link from "next/link";
import type { ReactNode } from "react";
import { CookieBanner } from "@/components/CookieBanner";
import { clean, hasPhone, loadChrome, telHref } from "@/lib/site";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About the doctor" },
  { href: "/services", label: "Services" },
  { href: "/prices", label: "Prices" },
  { href: "/faqs", label: "FAQs" },
  { href: "/contact", label: "Contact" },
];

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const { clinic, announcement } = await loadChrome();
  const phone = hasPhone(clinic);

  return (
    <>
      {announcement && (
        <div className="bg-accent-500 px-4 py-2 text-center text-sm font-medium text-slate-900" role="status">
          {announcement.text}
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="inline-flex min-h-11 items-center text-lg font-bold text-brand-800">{clinic.name}</Link>
          <nav aria-label="Main" className="hidden gap-5 text-sm font-medium text-slate-700 md:flex">
            {NAV.map((n) => <Link key={n.href} href={n.href} className="hover:text-brand-700">{n.label}</Link>)}
          </nav>
          <div className="flex items-center gap-2">
            {phone && (
              <a href={telHref(clinic.phone)} className="hidden rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-700 lg:inline-block">
                Call {clean(clinic.phone)}
              </a>
            )}
            <Link href="/book" className="inline-flex min-h-11 items-center rounded-lg bg-accent-500 px-4 py-2 text-sm font-bold text-slate-900 hover:bg-accent-600">
              Book now
            </Link>
          </div>
        </div>
        <nav aria-label="Main (mobile)" className="flex gap-4 overflow-x-auto border-t border-slate-100 px-4 py-2 text-sm font-medium text-slate-700 md:hidden">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="inline-flex min-h-11 items-center whitespace-nowrap px-1">{n.label}</Link>)}
        </nav>
      </header>

      <main id="main">{children}</main>

      <footer className="mt-16 bg-slate-900 text-slate-200">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-4">
          <div>
            <p className="font-bold text-white">{clinic.name}</p>
            <p className="mt-2 text-sm">{clean(clinic.address) || "Address to be confirmed"}</p>
            {clean(clinic.eircode) && <p className="text-sm">{clean(clinic.eircode)}</p>}
          </div>
          <div>
            <p className="font-bold text-white">Opening hours</p>
            <p className="mt-2 text-sm">{clean(clinic.openingHoursText)}</p>
          </div>
          <div>
            <p className="font-bold text-white">Contact</p>
            <p className="mt-2 text-sm">
              {phone ? <a className="inline-flex min-h-11 items-center underline" href={telHref(clinic.phone)}>{clean(clinic.phone)}</a> : "Phone to be confirmed"}
            </p>
            {clean(clinic.email) && <p className="text-sm">{clean(clinic.email)}</p>}
          </div>
          <div>
            <p className="font-bold text-white">Legal</p>
            <ul className="mt-2 text-sm">
              <li><Link className="inline-flex min-h-11 items-center underline" href="/privacy">Privacy policy</Link></li>
              <li><Link className="inline-flex min-h-11 items-center underline" href="/terms">Terms</Link></li>
              <li><Link className="inline-flex min-h-11 items-center underline" href="/cookies">Cookies</Link></li>
              <li><Link className="inline-flex min-h-11 items-center underline" href="/cancellation-policy">Cancellation policy</Link></li>
              <li><button type="button" data-cookie-settings className="inline-flex min-h-11 items-center underline">Cookie settings</button></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-700 px-4 py-4 text-center text-sm">
          <strong>This service is not for emergencies.</strong> In an emergency call <a className="inline-flex min-h-11 min-w-11 items-center justify-center underline" href="tel:112">112</a> or <a className="inline-flex min-h-11 min-w-11 items-center justify-center underline" href="tel:999">999</a>.
        </div>
      </footer>

      {/* WEB-00: fixed Call and Book bar on phones */}
      <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 gap-2 border-t border-slate-200 bg-white p-2 md:hidden">
        {phone ? (
          <a href={telHref(clinic.phone)} data-click-to-call className="flex min-h-12 items-center justify-center rounded-lg border-2 border-brand-700 font-bold text-brand-700">Call</a>
        ) : (
          <Link href="/contact" className="flex min-h-12 items-center justify-center rounded-lg border-2 border-brand-700 font-bold text-brand-700">Contact</Link>
        )}
        <Link href="/book" className="flex min-h-12 items-center justify-center rounded-lg bg-accent-500 font-bold text-slate-900">Book now</Link>
      </div>

      <CookieBanner gaId={process.env.NEXT_PUBLIC_GA_ID ?? ""} />
    </>
  );
}
