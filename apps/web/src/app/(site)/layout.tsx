import Link from "next/link";
import type { ReactNode } from "react";
import { CookieBanner } from "@/components/CookieBanner";
import { Logo } from "@/components/Logo";
import { SiteHeader } from "@/components/SiteHeader";
import { clean, hasPhone, loadChrome, telHref } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const { clinic, announcement } = await loadChrome();
  const phone = hasPhone(clinic);

  return (
    <>
      {announcement && (
        <div className="bg-accent-500 px-4 py-2 text-center text-sm font-medium text-white" role="status">
          {announcement.text}
        </div>
      )}

      <SiteHeader name={clinic.name} phoneLabel={phone ? clean(clinic.phone) : undefined} phoneHref={phone ? telHref(clinic.phone) : undefined} />

      <main id="main">{children}</main>

      <footer className="mt-16 border-t-4 border-accent-500 bg-brand-900 text-slate-200">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-4">
          <div>
            <Logo light size={40} />
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
          <a href={telHref(clinic.phone)} data-click-to-call className="flex min-h-12 items-center justify-center rounded-full border-2 border-brand-700 font-bold text-brand-700">Call</a>
        ) : (
          <Link href="/contact" className="flex min-h-12 items-center justify-center rounded-full border-2 border-brand-700 font-bold text-brand-700">Contact</Link>
        )}
        <Link href="/book" className="flex min-h-12 items-center justify-center rounded-full bg-brand-700 font-bold text-white">Book now</Link>
      </div>

      <CookieBanner gaId={process.env.NEXT_PUBLIC_GA_ID ?? ""} />
    </>
  );
}
