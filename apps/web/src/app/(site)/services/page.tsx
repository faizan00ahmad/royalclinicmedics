import { groupBy, listServices } from "@rmc/core";
import type { Metadata } from "next";
import { ServiceCard } from "@/components/ServiceCard";
import { db } from "@/lib/server";

export const metadata: Metadata = { title: "Services", description: "GP services, check-ups, children's appointments, vaccinations and more. Book online." };

export default async function ServicesPage() {
  const groups = groupBy(await listServices(db()), (s) => s.category);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold">Our services</h1>
      {groups.map((g) => (
        <section key={g.key} className="mt-8">
          <h2 className="text-xl font-semibold text-brand-800">{g.key}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{g.items.map((s) => <ServiceCard key={s.id} s={s} />)}</div>
        </section>
      ))}
    </div>
  );
}
