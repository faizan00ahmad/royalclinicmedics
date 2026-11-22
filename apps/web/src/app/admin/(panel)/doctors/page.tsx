import { listDoctors } from "@rmc/core";
import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { Card, Field, Flash, Table, Title, btn, input, td } from "@/components/admin/ui";
import { can, requireCan } from "@/lib/admin";
import { db } from "@/lib/server";
import { saveDoctorAction } from "../../actions";

export default async function DoctorsAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; edit?: string }> }) {
  const sp = await searchParams;
  const user = await requireCan("schedules:write");
  const canEdit = can(user, "doctors:write");
  const [all, logins] = await Promise.all([
    db().select().from(schema.doctors),
    db().select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.role, "DOCTOR")),
  ]);
  const doctors = all.length ? all : await listDoctors(db());
  const editing = sp.edit === "new" ? null : doctors.find((d) => d.id === sp.edit);

  return (
    <>
      <Title sub="Weekly hours, time off and extra sessions are on each doctor's schedule page.">Doctors and hours</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <Table head={["Doctor", "Active", "Login", ""]}>
        {doctors.map((d) => (
          <tr key={d.id}>
            <td className={td}><span className="font-medium">{d.displayName}</span><br /><span className="text-xs text-slate-500">{d.title}</span></td>
            <td className={td}>{d.isActive ? "Yes" : "No"}</td>
            <td className={td}>{logins.find((l) => l.id === d.userId)?.name ?? <span className="text-slate-400">none</span>}</td>
            <td className={`${td} space-x-3`}>
              <Link className="underline" href={`/admin/doctors/${d.id}/schedule`}>Hours and time off</Link>
              {canEdit && <Link className="underline" href={`?edit=${d.id}`}>Edit</Link>}
            </td>
          </tr>
        ))}
      </Table>
      {canEdit && (
        <>
          <p className="mt-4"><Link className={btn} href="?edit=new">Add a doctor</Link></p>
          {sp.edit && (
            <Card title={editing ? `Edit ${editing.displayName}` : "Add a doctor"} className="mt-4">
              <form action={saveDoctorAction} className="space-y-4">
                {editing && <input type="hidden" name="id" value={editing.id} />}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name"><input name="displayName" required defaultValue={editing?.displayName} className={input} /></Field>
                  <Field label="Title"><input name="title" defaultValue={editing?.title ?? ""} className={input} /></Field>
                  <Field label="Qualifications"><input name="qualifications" defaultValue={editing?.qualifications && !editing.qualifications.includes("[TBD]") ? editing.qualifications : ""} className={input} /></Field>
                  <Field label="Irish Medical Council number"><input name="imcNumber" defaultValue={editing?.imcNumber && !editing.imcNumber.includes("[TBD]") ? editing.imcNumber : ""} className={input} /></Field>
                  <Field label="Languages (comma separated)"><input name="languages" defaultValue={editing?.languages.join(", ") ?? "English"} className={input} /></Field>
                  <Field label="Order"><input name="sortOrder" type="number" min={0} defaultValue={editing?.sortOrder ?? 0} className={input} /></Field>
                  <Field label="Staff login for this doctor" hint="Create the login on the Staff page first (role: doctor).">
                    <select name="userId" defaultValue={editing?.userId ?? ""} className={input}><option value="">None</option>{logins.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                  </Field>
                  <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="isActive" defaultChecked={editing?.isActive ?? true} className="size-5" /> Active (bookable and shown on the website)</label>
                </div>
                <Field label="About (shown on the About page)"><textarea name="bio" rows={5} maxLength={3000} defaultValue={editing?.bio && !editing.bio.includes("[TBD]") ? editing.bio : ""} className={input} /></Field>
                <button className={btn}>Save doctor</button>
              </form>
            </Card>
          )}
        </>
      )}
    </>
  );
}
