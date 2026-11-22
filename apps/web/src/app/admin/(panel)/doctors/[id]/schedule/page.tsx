import { formatDublin, getSchedule } from "@rmc/core";
import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, Field, Flash, Table, Title, btn, btnDanger, btnLight, input, td } from "@/components/admin/ui";
import { can, requireVerified } from "@/lib/admin";
import { db } from "@/lib/server";
import { blockAction, overrideAction, removeBlockAction, removeOverrideAction, weeklyHoursAction } from "../../../../actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // show Monday first

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireVerified();
  const manage = can(user, "schedules:write");
  if (!manage && !can(user, "schedules:writeOwn", { doctorId: id })) redirect("/admin?error=" + encodeURIComponent("You do not have permission to do that."));

  const [doctor] = await db().select().from(schema.doctors).where(eq(schema.doctors.id, id));
  if (!doctor) notFound();
  const { rules, overrides, blocks } = await getSchedule(db(), id);
  const hh = (t: string) => t.slice(0, 5);

  return (
    <>
      {manage && <p className="text-sm"><Link className="underline" href="/admin/doctors">All doctors</Link></p>}
      <Title sub="All times are Irish time. Changes apply to the booking calendar immediately.">{doctor.displayName}: hours and time off</Title>
      <Flash ok={sp.ok} error={sp.error} />

      {manage && (
        <Card title="Weekly hours">
          <p className="mb-3 text-sm text-slate-600">Up to three time ranges a day (for example morning, afternoon, evening). Leave a day empty if the doctor does not work.</p>
          <form action={weeklyHoursAction} className="space-y-2">
            <input type="hidden" name="doctorId" value={id} />
            {ORDER.map((day) => {
              const r = rules.filter((x) => x.weekday === day);
              return (
                <div key={day} className="grid grid-cols-[6rem_1fr] items-center gap-2 sm:grid-cols-[7rem_repeat(3,1fr)]">
                  <span className="text-sm font-medium">{DAYS[day]}</span>
                  {[0, 1, 2].map((n) => (
                    <span key={n} className="flex items-center gap-1 text-sm">
                      <input type="time" name={`d${day}_s${n + 1}`} defaultValue={r[n] ? hh(r[n]!.startTime) : ""} className={`${input} mt-0`} aria-label={`${DAYS[day]} range ${n + 1} start`} />
                      to <input type="time" name={`d${day}_e${n + 1}`} defaultValue={r[n] ? hh(r[n]!.endTime) : ""} className={`${input} mt-0`} aria-label={`${DAYS[day]} range ${n + 1} end`} />
                    </span>
                  ))}
                </div>
              );
            })}
            <button className={`${btn} mt-3`}>Save weekly hours</button>
          </form>
        </Card>
      )}

      <Card title="Block time off" className="mt-4">
        <form action={blockAction} className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="doctorId" value={id} />
          <Field label="From"><input type="datetime-local" name="startAt" step={900} required className={input} /></Field>
          <Field label="Until"><input type="datetime-local" name="endAt" step={900} required className={input} /></Field>
          <Field label="Reason (private)"><input name="reason" maxLength={200} className={input} /></Field>
          <div className="flex items-end"><button className={btn}>Block</button></div>
        </form>
        {blocks.length > 0 && (
          <div className="mt-4"><Table head={["From", "Until", "Reason", ""]}>
            {blocks.map((b) => (
              <tr key={b.id}><td className={td}>{formatDublin(b.startAt)}</td><td className={td}>{formatDublin(b.endAt)}</td><td className={td}>{b.reason}</td>
                <td className={td}><form action={removeBlockAction}><input type="hidden" name="doctorId" value={id} /><input type="hidden" name="id" value={b.id} /><button className="underline">Remove</button></form></td></tr>
            ))}
          </Table></div>
        )}
      </Card>

      <Card title="One-off changes to a single day" className="mt-4">
        <form action={overrideAction} className="grid gap-3 sm:grid-cols-5">
          <input type="hidden" name="doctorId" value={id} />
          <Field label="Date"><input type="date" name="date" required className={input} /></Field>
          <Field label="What"><select name="kind" className={input}><option value="closed">Not working that day</option><option value="extra">Extra hours</option></select></Field>
          <Field label="Extra from"><input type="time" name="startTime" className={input} /></Field>
          <Field label="Extra until"><input type="time" name="endTime" className={input} /></Field>
          <div className="flex items-end"><button className={btnLight}>Add</button></div>
        </form>
        {overrides.length > 0 && (
          <div className="mt-4"><Table head={["Date", "Change", ""]}>
            {overrides.map((o) => (
              <tr key={o.id}><td className={td}>{o.date}</td><td className={td}>{o.isClosed ? "Not working" : `Extra ${o.startTime?.slice(0, 5)} to ${o.endTime?.slice(0, 5)}`}</td>
                <td className={td}><form action={removeOverrideAction}><input type="hidden" name="doctorId" value={id} /><input type="hidden" name="id" value={o.id} /><button className={btnDanger}>Remove</button></form></td></tr>
            ))}
          </Table></div>
        )}
      </Card>
    </>
  );
}
