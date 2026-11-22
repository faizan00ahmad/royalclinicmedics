import { listFaqs } from "@rmc/core";
import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { db } from "@/lib/server";
import { clean } from "@/lib/site";

export const metadata: Metadata = { title: "FAQs", description: "Answers to common questions about booking, paying and visiting the clinic." };

export default async function FaqsPage() {
  const groups = await listFaqs(db());
  const all = groups.flatMap((g) => g.items);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: all.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: clean(f.answer) } })),
      }} />
      <h1 className="text-3xl font-bold">Frequently asked questions</h1>
      {groups.map((g) => (
        <section key={g.key} className="mt-8">
          <h2 className="text-xl font-semibold text-brand-800">{g.key}</h2>
          {g.items.map((f) => (
            <details key={f.id} className="mt-3 rounded-lg border border-slate-200 p-4">
              <summary className="cursor-pointer font-medium">{f.question}</summary>
              <p className="mt-2 text-slate-700">{clean(f.answer)}</p>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}
