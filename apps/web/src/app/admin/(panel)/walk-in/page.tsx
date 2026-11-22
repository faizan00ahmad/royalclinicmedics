import { dublinDate, listServices, listDoctors } from "@rmc/core";
import { Card, Field, Flash, Title, btn, input } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";
import { walkInAction } from "../../actions";

/** Rounds now up to the next quarter hour, as an Irish-time datetime-local value. */
function nextQuarter(): string {
  const d = new Date(Math.ceil(Date.now() / 900_000) * 900_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${dublinDate(d)}T${parts.replace("24:", "00:")}`;
}

export default async function WalkInPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireCan("walkin:create");
  const [services, doctors] = await Promise.all([listServices(db()), listDoctors(db())]);
  return (
    <>
      <Title sub="Book a patient who is here now or phoned in. It uses the same rules as online bookings, so a time can never be double booked.">Walk-in and phone booking</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <form action={walkInAction} className="space-y-4">
        <Card title="Appointment">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Service"><select name="serviceId" required className={input}>{services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>)}</select></Field>
            <Field label="Doctor"><select name="doctorId" required className={input}>{doctors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select></Field>
            <Field label="Date and time (Irish time)" hint="Outside the doctor's normal hours is allowed; you will see a warning."><input type="datetime-local" name="when" step={900} defaultValue={nextQuarter()} required className={input} /></Field>
            <Field label="How did they book?"><select name="source" className={input}><option value="WALK_IN">Walk-in</option><option value="PHONE">Phone</option><option value="STAFF">Other</option></select></Field>
            <Field label="Payment"><select name="paymentChoice" className={input}><option value="AT_CLINIC">Pay at the clinic</option><option value="FREE">No charge</option></select></Field>
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="checkIn" className="size-5" /> They have arrived (check in now)</label>
          </div>
        </Card>
        <Card title="Patient">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name"><input name="firstName" required className={input} /></Field>
            <Field label="Last name"><input name="lastName" required className={input} /></Field>
            <Field label="Date of birth"><input type="date" name="dob" required className={input} /></Field>
            <Field label="Mobile phone"><input name="phone" required defaultValue="+353 " className={input} /></Field>
            <Field label="Email (optional)"><input type="email" name="email" className={input} /></Field>
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="medicalCard" className="size-5" /> Has a medical card</label>
          </div>
          <div className="mt-4"><Field label="Reason (optional)"><input name="reason" maxLength={500} className={input} /></Field></div>
        </Card>
        <button className={btn}>Book</button>
      </form>
    </>
  );
}
