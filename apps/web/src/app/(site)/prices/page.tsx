import { formatEuro, groupBy, listServices } from "@rmc/core";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/server";
import { loadChrome } from "@/lib/site";

export const metadata: Metadata = { title: "Prices", description: "Clear prices for every appointment. Pay online or at the clinic." };

export default async function PricesPage() {
  const { clinic } = await loadChrome();
  const groups = groupBy(await listServices(db()), (s) => s.category);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">Prices</h1>
      {groups.map((g) => (
        <section key={g.key} className="mt-8">
          <h2 className="text-xl font-semibold text-brand-800">{g.key}</h2>
          <table className="mt-3 w-full text-left">
            <caption className="sr-only">{g.key} prices</caption>
            <thead className="sr-only"><tr><th>Service</th><th>Length</th><th>Price</th></tr></thead>
            <tbody>
              {g.items.map((s) => (
                <tr key={s.id} className="border-b border-slate-200">
                  <td className="py-3"><Link className="font-medium hover:text-brand-700" href={`/services/${s.slug}`}>{s.name}</Link></td>
                  <td className="py-3 text-sm text-slate-600">{s.durationMin} min</td>
                  <td className="py-3 text-right font-semibold">{formatEuro(s.priceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
