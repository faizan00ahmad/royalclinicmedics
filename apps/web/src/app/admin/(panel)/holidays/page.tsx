import { schema } from "@rmc/db";
import { asc, gte } from "drizzle-orm";
import { Card, Field, Flash, Table, Title, btn, input, td } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";
import { holidayAction, removeHolidayAction } from "../../actions";

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireCan("schedules:write");
  const today = new Date().toISOString().slice(0, 10);
  const days = await db().select().from(schema.clinicHolidays).where(gte(schema.clinicHolidays.date, today)).orderBy(asc(schema.clinicHolidays.date));
  return (
    <>
      <Title sub="Days the whole clinic is closed. Irish public holidays are already added. Remember weekend bank holidays may move to a Monday.">Closed days</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <Card title="Add a closed day">
        <form action={holidayAction} className="grid gap-3 sm:grid-cols-3">
          <Field label="Date"><input type="date" name="date" required className={input} /></Field>
          <Field label="Name"><input name="name" placeholder="e.g. Staff training day" className={input} /></Field>
          <div className="flex items-end"><button className={btn}>Add</button></div>
        </form>
      </Card>
      <div className="mt-4"><Table head={["Date", "Name", ""]}>
        {days.map((h) => (
          <tr key={h.id}><td className={td}>{h.date}</td><td className={td}>{h.name}</td>
            <td className={td}><form action={removeHolidayAction}><input type="hidden" name="id" value={h.id} /><button className="underline">Remove</button></form></td></tr>
        ))}
      </Table></div>
    </>
  );
}
