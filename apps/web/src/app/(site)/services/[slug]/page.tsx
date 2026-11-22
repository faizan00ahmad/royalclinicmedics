import { formatEuro, getServiceBySlug } from "@rmc/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { db } from "@/lib/server";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getServiceBySlug(db(), (await params).slug);
  if (!data) return {};
  const { service } = data;
  return {
    title: service.seoTitle ?? service.name,
    description: service.seoDescription ?? service.shortDescription ?? undefined,
    alternates: { canonical: `/services/${service.slug}` },
  };
}

export default async function ServicePage({ params }: Props) {
  const data = await getServiceBySlug(db(), (await params).slug);
  if (!data) notFound();
  const { service, faqs, doctors } = data;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Services", item: "/services" },
          { "@type": "ListItem", position: 2, name: service.name },
        ],
      }} />
      {faqs.length > 0 && (
        <JsonLd data={{
          "@context": "https://schema.org", "@type": "FAQPage",
          mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
        }} />
      )}
      <p className="text-sm"><Link href="/services" className="underline">All services</Link></p>
      <h1 className="mt-2 text-3xl font-bold">{service.name}</h1>
      <p className="mt-3 text-lg text-slate-700">{service.description ?? service.shortDescription}</p>
      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-brand-50 p-5">
        <div><dt className="text-sm text-slate-600">Price</dt><dd className="text-xl font-bold">{formatEuro(service.priceCents)}</dd></div>
        <div><dt className="text-sm text-slate-600">Length</dt><dd className="text-xl font-bold">{service.durationMin} minutes</dd></div>
      </dl>
      <p className="mt-4 text-sm text-slate-600">
        {service.payAtClinicAllowed ? "Pay online when you book, or at the clinic." : "Payment is taken online when you book."}
      </p>
      {doctors.length > 0 && <p className="mt-2 text-sm text-slate-600">With {doctors.map((d) => d.displayName).join(", ")}.</p>}
      <Link href={`/book?service=${service.slug}`} className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-accent-500 px-8 font-bold text-slate-900 hover:bg-accent-600">
        Book this appointment
      </Link>
      {faqs.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Questions about this appointment</h2>
          {faqs.map((f) => (
            <details key={f.id} className="mt-3 rounded-lg border border-slate-200 p-4">
              <summary className="cursor-pointer font-medium">{f.question}</summary>
              <p className="mt-2 text-slate-700">{f.answer}</p>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
