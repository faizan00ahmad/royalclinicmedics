import { getAnnouncementForEdit, getPage, listAllFaqs } from "@rmc/core";
import { Card, Field, Flash, Title, btn, btnDanger, btnLight, input } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";
import { announcementAction, deleteFaqAction, faqAction, legalAction } from "../../actions";

const LEGAL = [["privacy", "Privacy policy"], ["terms", "Terms and conditions"], ["cookies", "Cookie policy"], ["cancellation", "Cancellation policy"]] as const;

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; legal?: string }> }) {
  const sp = await searchParams;
  await requireCan("content:write");
  const [faqs, banner] = await Promise.all([listAllFaqs(db()), getAnnouncementForEdit(db())]);
  const legalKey = LEGAL.find(([k]) => k === sp.legal)?.[0] ?? "privacy";
  const page = await getPage(db(), legalKey);

  return (
    <>
      <Title sub="Changes appear on the website straight away.">Website content</Title>
      <Flash ok={sp.ok} error={sp.error} />

      <Card title="Announcement banner">
        <form action={announcementAction} className="space-y-3">
          <Field label="Text (max 200 characters)" hint="Shown at the top of every page, for example a holiday closing notice."><input name="text" maxLength={200} defaultValue={banner?.text ?? ""} className={input} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={banner?.active ?? true} className="size-5" /> Show it</label>
          <button className={btn}>Save banner</button>
        </form>
      </Card>

      <Card title="Frequently asked questions" className="mt-4">
        <div className="space-y-4">
          {faqs.map((f) => (
            <div key={f.id} className="rounded-lg border border-slate-200 p-3">
              <form action={faqAction} className="grid gap-2">
                <input type="hidden" name="id" value={f.id} />
                <div className="grid gap-2 sm:grid-cols-[10rem_1fr_6rem]">
                  <input name="category" defaultValue={f.category} className={input} aria-label="Category" />
                  <input name="question" defaultValue={f.question} className={input} aria-label="Question" />
                  <input name="sortOrder" type="number" defaultValue={f.sortOrder} className={input} aria-label="Order" />
                </div>
                <textarea name="answer" defaultValue={f.answer} rows={2} className={input} aria-label="Answer" />
                <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={f.active} className="size-5" /> Shown</label><button className={btnLight}>Save</button></div>
              </form>
              <form action={deleteFaqAction} className="mt-1"><input type="hidden" name="id" value={f.id} /><button className={btnDanger}>Delete</button></form>
            </div>
          ))}
          <form action={faqAction} className="grid gap-2 rounded-lg border-2 border-dashed border-slate-300 p-3">
            <p className="text-sm font-semibold">Add a question</p>
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr_6rem]">
              <input name="category" placeholder="Category" defaultValue="General" className={input} />
              <input name="question" placeholder="Question" required className={input} />
              <input name="sortOrder" type="number" defaultValue={faqs.length} className={input} />
            </div>
            <textarea name="answer" placeholder="Answer" required rows={2} className={input} />
            <input type="hidden" name="active" value="on" />
            <button className={`${btn} w-fit`}>Add</button>
          </form>
        </div>
      </Card>

      <Card title="Legal pages" className="mt-4">
        <p className="mb-3 text-sm text-slate-600">Each save creates a new version. Patients accept the version that is live when they book. Have a solicitor review these before launch.</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {LEGAL.map(([k, label]) => <a key={k} href={`?legal=${k}`} className={k === legalKey ? btn : btnLight}>{label}</a>)}
        </div>
        <form action={legalAction} className="space-y-2">
          <input type="hidden" name="key" value={legalKey} />
          <textarea name="text" rows={14} defaultValue={(page?.body as { text?: string } | undefined)?.text ?? ""} className={input} />
          <p className="text-xs text-slate-500">Current version: {page?.version ?? "none"}</p>
          <button className={btn}>Publish new version</button>
        </form>
      </Card>
    </>
  );
}
