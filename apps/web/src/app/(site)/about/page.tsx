import { isTbd, listDoctors } from "@rmc/core";
import type { Metadata } from "next";
import { db } from "@/lib/server";
import { clean } from "@/lib/site";

export const metadata: Metadata = { title: "About the doctor", description: "Meet the doctors at Royal Medics Clinic." };

export default async function AboutPage() {
  const doctors = await listDoctors(db());
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-4xl font-bold text-brand-800">About the doctor</h1>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/photos/waiting-room.jpg" alt="The clinic waiting area" width={900} height={1350} loading="lazy" className="mt-6 aspect-[16/7] w-full rounded-2xl object-cover" />
      {doctors.map((d) => (
        <section key={d.id} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4"><span aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand-700 font-serif text-2xl font-bold text-white">{d.displayName.replace(/^Dr\s+/,"").split(" ").map((w) => w[0]).slice(0,2).join("")}</span><div><h2 className="font-serif text-2xl font-bold text-brand-800">{d.displayName}</h2>
          {d.title && <p className="text-accent-500">{d.title}</p>}</div></div>
          {d.bio && !isTbd(d.bio) && <p className="mt-3 text-slate-700">{d.bio}</p>}
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {d.qualifications && !isTbd(d.qualifications) && <div><dt className="font-semibold">Qualifications</dt><dd>{clean(d.qualifications)}</dd></div>}
            {d.imcNumber && !isTbd(d.imcNumber) && <div><dt className="font-semibold">Irish Medical Council number</dt><dd>{clean(d.imcNumber)}</dd></div>}
            {d.languages.length > 0 && <div><dt className="font-semibold">Languages</dt><dd>{d.languages.join(", ")}</dd></div>}
          </dl>
        </section>
      ))}
    </div>
  );
}
