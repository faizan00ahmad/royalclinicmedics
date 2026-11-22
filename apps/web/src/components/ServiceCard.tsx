import { formatEuro, type ServiceRow } from "@rmc/core";
import Link from "next/link";
import { ServicePicture } from "./ServiceArt";

/** Picture card used in the swipe rows. `rail` gives it a fixed width so the next card peeks in. */
export function ServiceCard({ s, rail = false }: { s: ServiceRow; rail?: boolean }) {
  return (
    <article className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${rail ? "w-[78vw] max-w-[290px] shrink-0 snap-start" : ""}`}>
      <ServicePicture slug={s.slug} category={s.category} className="aspect-[16/9] w-full" />
      <div className="flex grow flex-col p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent-500">{s.category}</p>
        <h3 className="mt-1 font-serif text-lg font-bold text-brand-800">
          <Link href={`/services/${s.slug}`} className="inline-flex min-h-11 items-center hover:text-brand-600">{s.name}</Link>
        </h3>
        <p className="mt-1 grow text-sm text-slate-600">{s.shortDescription}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-700"><b className="text-base text-brand-800">{formatEuro(s.priceCents)}</b> · {s.durationMin} min</p>
          <Link href={`/book?service=${s.slug}`} className="inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 font-bold text-white hover:bg-brand-800">Book</Link>
        </div>
      </div>
    </article>
  );
}

/** Horizontal, swipeable row (CSS scroll-snap, no script). */
export function Rail({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8" aria-label={title}>
      <h2 className="font-serif text-2xl font-bold text-brand-800">{title}</h2>
      {hint && <p className="text-sm text-slate-600">{hint}</p>}
      <div className="-mx-4 mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:thin]" tabIndex={0}>
        {children}
      </div>
    </section>
  );
}
