import { getPage } from "@rmc/core";
import { notFound } from "next/navigation";
import { db } from "@/lib/server";

/** WEB-09: legal pages are edited and versioned in admin. */
export async function LegalPage({ pageKey }: { pageKey: string }) {
  const page = await getPage(db(), pageKey);
  if (!page) notFound();
  const text = (page.body as { text?: string }).text ?? "";
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">{page.title}</h1>
      <p className="mt-1 text-sm text-slate-500">Version {page.version}</p>
      <div className="mt-6 space-y-4 whitespace-pre-line text-slate-700">{text}</div>
    </div>
  );
}
