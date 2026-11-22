import type { Metadata } from "next";
import { isTbd } from "@rmc/core";
import { ContactForm } from "@/components/ContactForm";
import { clean, hasPhone, loadChrome, telHref } from "@/lib/site";

export const metadata: Metadata = { title: "Contact", description: "Phone, address, opening hours and a contact form for Royal Medics Clinic." };

export default async function ContactPage() {
  const { clinic } = await loadChrome();
  const mapOk = !isTbd(clinic.mapQuery);
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:grid-cols-2">
      <section>
        <h1 className="text-3xl font-bold">Contact us</h1>
        <dl className="mt-6 space-y-4">
          <div><dt className="font-semibold">Phone</dt><dd>{hasPhone(clinic) ? <a className="underline" href={telHref(clinic.phone)}>{clean(clinic.phone)}</a> : "To be confirmed"}</dd></div>
          {clean(clinic.email) && <div><dt className="font-semibold">Email</dt><dd>{clean(clinic.email)}</dd></div>}
          {clinic.whatsapp && <div><dt className="font-semibold">WhatsApp</dt><dd><a className="underline" href={`https://wa.me/${clinic.whatsapp.replace(/\D/g, "")}`}>Message us</a></dd></div>}
          <div><dt className="font-semibold">Address</dt><dd>{clean(clinic.address) || "To be confirmed"}{clean(clinic.eircode) ? `, ${clean(clinic.eircode)}` : ""}</dd></div>
          <div><dt className="font-semibold">Opening hours</dt><dd>{clean(clinic.openingHoursText)}</dd></div>
        </dl>
        <div className="mt-6 aspect-video overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
          {mapOk ? (
            <iframe title="Map showing the clinic" loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="size-full"
              src={`https://www.google.com/maps?q=${encodeURIComponent(clinic.mapQuery)}&output=embed`} />
          ) : (
            <p className="flex size-full items-center justify-center p-4 text-center text-sm text-slate-500">Map will appear here once the clinic address is added.</p>
          )}
        </div>
      </section>
      <section>
        <h2 className="text-2xl font-bold">Send us a message</h2>
        <div className="mt-4"><ContactForm /></div>
      </section>
    </div>
  );
}
