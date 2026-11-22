import { formatEuro, groupBy, listServices } from "@rmc/core";
import type { Metadata } from "next";
import Link from "next/link";
import { ServicePicture } from "@/components/ServiceArt";
import { db } from "@/lib/server";
import { loadChrome } from "@/lib/site";

export const metadata: Metadata = { title: "Prices", description: "Clear prices for every appointment. Pay online or at the clinic." };

export default async function PricesPage() {
  const { clinic } = await loadChrome();
  const groups = groupBy(await listServices(db()), (s) => s.category);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-4xl font-bold text-brand-800">Prices</h1>
      {groups.map((g) => (
        <section key={g.key} className="mt-8">
          <h2 className="font-serif text-xl font-bold text-brand-800">{g.key}</h2>
          <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {g.items.map((s) => (
              <li key={s.id} className="flex items-center gap-3 p-3">
                <ServicePicture slug={s.slug} category={s.category} className="h-12 w-16 shrink-0 rounded-lg" />
                <div className="grow">
                  <Link className="font-semibold text-brand-800 hover:underline" href={`/services/${s.slug}`}>{s.name}</Link>
                  <p className="text-sm text-slate-600">{s.durationMin} min</p>
                </div>
                <b className="text-brand-800">{formatEuro(s.priceCents)}</b>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="mt-10 space-y-3 rounded-xl bg-slate-50 p-5 text-sm text-slate-700">
        <h2 className="text-lg font-semibold text-slate-900">Payment and changes</h2>
        <p>Pay by card, Apple Pay or Google Pay when you book. Some appointments can be paid for at the clinic.</p>
        <p>
          You can change or cancel for free up to {clinic.cancellationWindowHours} hours before your appointment. Online payments are refunded
          automatically. Closer to the time, please phone the clinic. See our <Link className="underline" href="/cancellation-policy">cancellation policy</Link>.
        </p>
        <p><strong>Medical card patients:</strong> please phone the clinic to book and to confirm what applies to you.</p>
      </section>
    </div>
  );
}
