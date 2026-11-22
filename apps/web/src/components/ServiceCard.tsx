import { formatEuro, type ServiceRow } from "@rmc/core";
import Link from "next/link";

export function ServiceCard({ s }: { s: ServiceRow }) {
  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">
        <Link href={`/services/${s.slug}`} className="hover:text-brand-700">{s.name}</Link>
      </h3>
      <p className="mt-2 grow text-sm text-slate-600">{s.shortDescription}</p>
      <p className="mt-3 text-sm text-slate-700">{formatEuro(s.priceCents)} · {s.durationMin} min</p>
      <Link href={`/book?service=${s.slug}`} className="mt-4 flex min-h-11 items-center justify-center rounded-lg bg-accent-500 font-bold text-slate-900 hover:bg-accent-600">
        Book
      </Link>
    </article>
  );
}
