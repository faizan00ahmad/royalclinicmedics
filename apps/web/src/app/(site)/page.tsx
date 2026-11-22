import { isTbd, listReviews, listServices } from "@rmc/core";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { ServiceCard } from "@/components/ServiceCard";
import { db } from "@/lib/server";
import { clean, hasPhone, loadChrome, telHref } from "@/lib/site";

const STEPS = [
  ["1", "Choose a service", "Pick the appointment that fits what you need."],
  ["2", "Pick a time", "You only see times that are really free."],
  ["3", "See the doctor", "Pay online or at the clinic. You get an email with a link to change or cancel."],
] as const;

export default async function Home() {
  const { clinic } = await loadChrome();
  const [featured, reviews] = await Promise.all([listServices(db(), { featuredOnly: true }), listReviews(db(), clinic)]);
  const phone = hasPhone(clinic);

  const why = [
    ["Same-day appointments", "Book a time later today when something cannot wait."],
    ["Pay your way", "Card, Apple Pay, Google Pay, or at the clinic."],
    ["Easy changes", `Change or cancel free up to ${clinic.cancellationWindowHours} hours before.`],
    ["Your data stays private", "We keep your details secure and never put health information in emails."],
  ];

  return (
    <>
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "MedicalClinic", name: clinic.name,
        ...(phone ? { telephone: clean(clinic.phone) } : {}),
        ...(isTbd(clinic.address) ? {} : { address: { "@type": "PostalAddress", streetAddress: clean(clinic.address), postalCode: clean(clinic.eircode), addressCountry: "IE" } }),
        medicalSpecialty: "GeneralPractice",
      }} />

      <section className="bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-brand-900 md:text-5xl">Your GP in Dublin. Book online in minutes.</h1>
          <p className="mt-4 max-w-xl text-lg text-slate-700">See a doctor at {clinic.name}. Choose a service, pick a free time and pay online or at the clinic.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/book" className="min-h-12 rounded-lg bg-accent-500 px-6 py-3 text-lg font-bold text-slate-900 hover:bg-accent-600">Book now</Link>
            {phone && <a href={telHref(clinic.phone)} className="min-h-12 rounded-lg border-2 border-brand-700 px-6 py-3 text-lg font-bold text-brand-700">Call {clean(clinic.phone)}</a>}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-bold">Popular services</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{featured.map((s) => <ServiceCard key={s.id} s={s} />)}</div>
        <p className="mt-6"><Link href="/services" className="font-semibold text-brand-700 underline">See all services and prices</Link></p>
      </section>

      <section className="bg-slate-50 py-12">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-2xl font-bold">How it works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map(([n, t, d]) => (
              <li key={n} className="rounded-xl bg-white p-5 shadow-sm">
                <span className="flex size-9 items-center justify-center rounded-full bg-brand-700 font-bold text-white">{n}</span>
                <h3 className="mt-3 font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-slate-600">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-bold">Why choose us</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {why.map(([t, d]) => (
            <li key={t} className="rounded-xl border border-slate-200 p-5"><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-slate-600">{d}</p></li>
          ))}
        </ul>
      </section>

      {reviews.length > 0 && (
        <section className="bg-slate-50 py-12">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold">What patients say</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {reviews.map((r) => (
                <figure key={r.id} className="rounded-xl bg-white p-5 shadow-sm">
                  <p aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}</p>
                  <blockquote className="mt-2 text-sm text-slate-700">{r.text}</blockquote>
                  <figcaption className="mt-2 text-sm font-semibold">{r.authorName}</figcaption>
                </figure>
              ))}
            </div>
            {clinic.googleReviewUrl && <p className="mt-4"><a className="font-semibold text-brand-700 underline" href={clinic.googleReviewUrl}>See all reviews on Google</a></p>}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-bold">Opening hours and location</h2>
        <p className="mt-3">{clean(clinic.openingHoursText)}</p>
        <p className="mt-1 text-slate-600">{clean(clinic.address) || "Address to be confirmed"}</p>
      </section>

      <section className="bg-brand-700 py-12 text-center text-white">
        <h2 className="text-2xl font-bold">Ready to book?</h2>
        <Link href="/book" className="mt-5 inline-block min-h-12 rounded-lg bg-accent-500 px-8 py-3 text-lg font-bold text-slate-900">Book now</Link>
      </section>
    </>
  );
}
