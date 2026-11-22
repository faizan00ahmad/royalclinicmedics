import { findPatients } from "@rmc/core";
import { Card, Flash, Table, Title, btn, btnDanger, btnLight, input, td } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";
import { anonymiseAction } from "../../actions";

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; q?: string }> }) {
  const sp = await searchParams;
  await requireCan("privacy:manage");
  const people = sp.q ? await findPatients(db(), sp.q) : [];
  return (
    <>
      <Title sub="When a person asks to see, or to delete, the information the clinic holds about them (GDPR). Administrators only. Every action is recorded in the audit log.">Privacy requests</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <Card title="Find the person">
        <form className="flex flex-wrap items-end gap-2">
          <label className="text-sm font-medium">Name, email or phone (at least 3 characters)<input name="q" defaultValue={sp.q ?? ""} className={`${input} w-72`} /></label>
          <button className={btn}>Search</button>
        </form>
      </Card>

      {sp.q && people.length === 0 && <p className="mt-4 text-slate-600">No one found.</p>}
      {people.length > 0 && (
        <div className="mt-4">
          <Table head={["Person", "Contact", "Date of birth", "Bookings", "Request"]}>
            {people.map((p) => (
              <tr key={p.id}>
                <td className={td}>{p.firstName} {p.lastName}{p.deletedAt && <span className="ml-2 text-xs text-slate-500">(anonymised)</span>}</td>
                <td className={td}>{p.email || "none"}<br /><span className="text-xs text-slate-500">{p.phone}</span></td>
                <td className={td}>{p.dob}</td><td className={td}>{p.appointments}</td>
                <td className={td}>
                  {!p.deletedAt && (
                    <div className="space-y-2">
                      {/* Plain link: downloading is recorded in the audit log, so it must never be prefetched */}
                      <a className={btnLight} href={`/admin/privacy/export/${p.id}`}>Download all their data (JSON)</a>
                      <form action={anonymiseAction} className="flex items-end gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <label className="text-xs font-medium">Type ANONYMISE<input name="confirm" autoComplete="off" className={`${input} w-32`} /></label>
                        <button className={btnDanger}>Anonymise</button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-slate-500">Anonymising removes the name, contact details, date of birth, address and health answers, and keeps the booking and payment records (needed for the clinic&apos;s accounts) without any link to the person. It cannot be undone, and it is refused while they have an upcoming appointment.</p>
        </div>
      )}
    </>
  );
}
