import { isTbd, listReviews, listServices } from "@rmc/core";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { HeroVideo } from "@/components/HeroVideo";
import { AutoRail } from "@/components/AutoRail";
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

      <section className="relative isolate flex min-h-[78vh] items-end overflow-hidden bg-brand-800 text-white md:min-h-[82vh]">
        <HeroVideo src="/video/hero-consultation.mp4" />
        <div className="absolute inset-0 bg-gradient-to-t from-brand-900/90 via-brand-900/45 to-brand-900/20" aria-hidden="true" />
        <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-16 pt-32">
          <h1 className="max-w-xl font-serif text-4xl font-bold tracking-tight md:text-6xl">Your GP in Waterford.</h1>
          <p className="mt-3 max-w-md text-lg text-white/90">Book in minutes.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/book" className="inline-flex min-h-12 items-center rounded-full bg-accent-500 px-8 text-lg font-bold text-white hover:bg-accent-600">Book now</Link>
            {phone && <a href={telHref(clinic.phone)} className="inline-flex min-h-12 items-center rounded-full border-2 border-white/70 px-7 text-lg font-bold text-white">Call {clean(clinic.phone)}</a>}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-4 pt-4">
        <AutoRail title="Popular services" hint="Hover or touch to pause">{featured.map((s) => <ServiceCard key={s.id} s={s} rail />)}</AutoRail>
        <p className="mt-2"><Link href="/services" className="font-semibold text-brand-700 underline">See all services and prices</Link></p>
      </section>

      <section className="bg-page py-12">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="font-serif text-2xl font-bold text-brand-800">How it works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map(([n, t, d]) => (
              <li key={n} className="rounded-2xl bg-white p-5 shadow-sm">
                <span className="flex size-9 items-center justify-center rounded-full bg-brand-700 font-bold text-white">{n}</span>
                <h3 className="mt-3 font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-slate-600">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="font-serif text-2xl font-bold text-brand-800">Why choose us</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {why.map(([t, d]) => (
            <li key={t} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-slate-600">{d}</p></li>
          ))}
        </ul>
      </section>

      {reviews.length > 0 && (
        <section className="bg-page py-12">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="font-serif text-2xl font-bold text-brand-800">What patients say</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {reviews.map((r) => (
                <figure key={r.id} className="rounded-2xl bg-white p-5 shadow-sm">
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
        <h2 className="font-serif text-2xl font-bold text-brand-800">Opening hours and location</h2>
        <p className="mt-3">{clean(clinic.openingHoursText)}</p>
        <p className="mt-1 text-slate-600">{clean(clinic.address) || "Address to be confirmed"}</p>
      </section>

      <section className="bg-brand-800 py-12 text-center text-white">
        <h2 className="font-serif text-2xl font-bold text-white">Ready to book?</h2>
        <Link href="/book" className="mt-5 inline-block min-h-12 rounded-full bg-accent-500 px-8 py-3 text-lg font-bold text-white">Book now</Link>
      </section>
    </>
  );
}
