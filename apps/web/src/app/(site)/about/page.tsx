import { isTbd, listDoctors } from "@rmc/core";
import type { Metadata } from "next";
import { db } from "@/lib/server";
import { clean } from "@/lib/site";

export const metadata: Metadata = { title: "About the doctor", description: "Meet the doctors at Royal Medics Clinic." };

export default async function AboutPage() {
  const doctors = await listDoctors(db());
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">About the doctor</h1>
      {doctors.map((d) => (
        <section key={d.id} className="mt-8 rounded-xl border border-slate-200 p-6">
          <h2 className="text-2xl font-semibold">{d.displayName}</h2>
          {d.title && <p className="text-brand-700">{d.title}</p>}
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
