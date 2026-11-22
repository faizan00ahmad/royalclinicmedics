import { formatDublin, listEnquiries } from "@rmc/core";
import Link from "next/link";
import { Badge, Card, Flash, Title, btnLight, input } from "@/components/admin/ui";
import { can, requireCan } from "@/lib/admin";
import { db } from "@/lib/server";
import { enquiryAction } from "../../actions";

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; status?: string }> }) {
  const sp = await searchParams;
  const user = await requireCan("enquiries:read");
  const status = ["NEW", "REPLIED", "CLOSED"].includes(sp.status ?? "") ? sp.status : undefined;
  const rows = await listEnquiries(db(), status);
  const write = can(user, "enquiries:write");
  return (
    <>
      <Title sub="Messages from the Contact page. Reply from your own email, then mark them replied.">Enquiries</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="mb-4 flex gap-2 text-sm">
        {[["", "All"], ["NEW", "New"], ["REPLIED", "Replied"], ["CLOSED", "Closed"]].map(([v, l]) => <Link key={l} href={v ? `?status=${v}` : "?"} className={btnLight}>{l}</Link>)}
      </div>
      {rows.length === 0 && <p className="text-slate-600">No enquiries.</p>}
      <div className="space-y-3">
        {rows.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-center gap-3"><span className="font-semibold">{e.name}</span><Badge value={e.status} /><span className="text-xs text-slate-500">{formatDublin(e.createdAt)}</span></div>
            <p className="mt-1 text-sm"><a className="underline" href={`mailto:${e.email}`}>{e.email}</a>{e.phone && <> · <a className="underline" href={`tel:${e.phone}`}>{e.phone}</a></>}</p>
            <p className="mt-2 whitespace-pre-line text-sm">{e.message}</p>
            {write && (
              <form action={enquiryAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={e.id} />
                <select name="status" defaultValue={e.status} className={`${input} w-auto`}><option value="NEW">New</option><option value="REPLIED">Replied</option><option value="CLOSED">Closed</option></select>
                <input name="notes" defaultValue={e.notes ?? ""} placeholder="Internal note" className={`${input} max-w-xs`} />
                <button className={btnLight}>Update</button>
              </form>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
