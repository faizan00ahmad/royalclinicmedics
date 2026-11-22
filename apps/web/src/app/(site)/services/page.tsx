import { groupBy, listServices } from "@rmc/core";
import type { Metadata } from "next";
import { Rail } from "@/components/Rail";
import { ServiceCard } from "@/components/ServiceCard";
import { db } from "@/lib/server";

export const metadata: Metadata = { title: "Services", description: "GP services, tests, certificates and more. Book online." };

export default async function ServicesPage() {
  const groups = groupBy(await listServices(db()), (s) => s.category);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent-500">What we offer</p>
      <h1 className="font-serif text-4xl font-bold text-brand-800">Our services</h1>
      <p className="mt-2 text-slate-600">Swipe through each group. Tap a card for details, or book in a few taps.</p>
      {groups.map((g) => (
        <Rail key={g.key} title={g.key} hint={`${g.items.length} ${g.items.length === 1 ? "service" : "services"}`}>
          {g.items.map((s) => <ServiceCard key={s.id} s={s} rail />)}
        </Rail>
      ))}
    </div>
  );
}
