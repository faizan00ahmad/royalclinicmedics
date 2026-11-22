import { formatDublin, listStaff } from "@rmc/core";
import { Card, Field, Flash, Table, Title, btn, btnDanger, btnLight, input, td } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";
import { createStaffAction, resetTwoFactorAction, toggleStaffAction } from "../../actions";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const me = await requireCan("staff:write");
  const staff = await listStaff(db());
  return (
    <>
      <Title sub="Everyone signs in with a password and an authenticator app code.">Staff</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <Table head={["Name", "Role", "Two-factor", "Last sign in", ""]}>
        {staff.map((s) => (
          <tr key={s.id}>
            <td className={td}><span className="font-medium">{s.name}</span><br /><span className="text-xs text-slate-500">{s.email}</span>{!s.isActive && <span className="ml-2 text-xs text-red-700">deactivated</span>}</td>
            <td className={td}>{s.role.toLowerCase()}</td>
            <td className={td}>{s.totpConfirmedAt ? "Set up" : "Not yet"}</td>
            <td className={td}>{s.lastLoginAt ? formatDublin(s.lastLoginAt) : "never"}</td>
            <td className={`${td} flex flex-wrap gap-2`}>
              <form action={resetTwoFactorAction}><input type="hidden" name="id" value={s.id} /><button className={btnLight}>Reset two-factor</button></form>
              {s.id !== me.id && (
                <form action={toggleStaffAction}><input type="hidden" name="id" value={s.id} />{s.isActive ? <button className={btnDanger}>Deactivate</button> : <><input type="hidden" name="active" value="on" /><button className={btn}>Activate</button></>}</form>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <Card title="Add a staff member" className="mt-6">
        <form action={createStaffAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input name="name" required className={input} /></Field>
          <Field label="Email"><input name="email" type="email" required className={input} /></Field>
          <Field label="Role" hint="Receptionist: bookings, walk-ins, schedules, content. Doctor: own appointments and time off. Administrator: everything.">
            <select name="role" className={input}><option value="RECEPTIONIST">Receptionist</option><option value="DOCTOR">Doctor</option><option value="ADMIN">Administrator</option></select>
          </Field>
          <Field label="Starting password (12+ characters)" hint="Tell them in person. They sign in and set up two-factor."><input name="password" type="password" required minLength={12} autoComplete="new-password" className={input} /></Field>
          <div className="sm:col-span-2"><button className={btn}>Create account</button></div>
        </form>
      </Card>
    </>
  );
}
