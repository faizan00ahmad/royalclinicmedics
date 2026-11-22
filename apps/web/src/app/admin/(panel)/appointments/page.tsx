import { addDays, dublinDate, dublinToUtc, formatDublin, formatEuro, listAppointments } from "@rmc/core";
import { schema } from "@rmc/db";
import Link from "next/link";
import { Badge, Flash, Table, Title, btn, btnLight, input, td } from "@/components/admin/ui";
import { requireCan, requireVerified } from "@/lib/admin";
import { db } from "@/lib/server";

type SP = { ok?: string; error?: string; from?: string; to?: string; doctor?: string; status?: string; pay?: string; q?: string; page?: string; order?: string };
const STATUSES = ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED_BY_PATIENT", "CANCELLED_BY_CLINIC"] as const;
const PAYS = ["UNPAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"] as const;
const isDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireVerified();
  const user = await requireCan("appointments:read", { doctorId: me.doctorId });
  const isDoctor = user.role === "DOCTOR";
  const from = isDate(sp.from) ?? dublinDate(new Date());
  const to = isDate(sp.to) ?? addDays(from, 7);
  const page = Math.max(1, Number(sp.page) || 1);
  const doctors = await db().select().from(schema.doctors);

  const res = await listAppointments(db(), {
    fromUtc: dublinToUtc(`${from} 00:00`), toUtc: dublinToUtc(`${addDays(to, 1)} 00:00`),
    doctorId: isDoctor ? user.doctorId ?? "00000000-0000-0000-0000-000000000000" : sp.doctor || undefined,
    status: STATUSES.find((s) => s === sp.status), paymentStatus: PAYS.find((s) => s === sp.pay),
    q: sp.q, page, order: sp.order === "desc" ? "desc" : "asc",
  });
  const qs = (p: number) => new URLSearchParams({ ...(sp.from && { from }), ...(sp.to && { to }), ...(sp.doctor && { doctor: sp.doctor }), ...(sp.status && { status: sp.status }), ...(sp.pay && { pay: sp.pay }), ...(sp.q && { q: sp.q }), page: String(p) }).toString();

  return (
    <>
      <Title sub={`${res.total} appointment${res.total === 1 ? "" : "s"}`}>Appointments</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <form className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs font-medium">From<input type="date" name="from" defaultValue={from} className={input} /></label>
        <label className="text-xs font-medium">To<input type="date" name="to" defaultValue={to} className={input} /></label>
        {!isDoctor && (
          <label className="text-xs font-medium">Doctor
            <select name="doctor" defaultValue={sp.doctor ?? ""} className={input}><option value="">All</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select>
          </label>
        )}
        <label className="text-xs font-medium">Status
          <select name="status" defaultValue={sp.status ?? ""} className={input}><option value="">Any</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ").toLowerCase()}</option>)}</select>
        </label>
        <label className="text-xs font-medium">Payment
          <select name="pay" defaultValue={sp.pay ?? ""} className={input}><option value="">Any</option>{PAYS.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ").toLowerCase()}</option>)}</select>
        </label>
        <label className="text-xs font-medium sm:col-span-2 lg:col-span-1">Search<input name="q" defaultValue={sp.q ?? ""} placeholder="Name, phone, email, reference" className={input} /></label>
        <div className="flex items-end gap-2"><button className={btn}>Filter</button><Link href="/admin/appointments" className={btnLight}>Reset</Link></div>
      </form>

      {res.rows.length === 0 ? <p className="text-slate-600">No appointments match.</p> : (
        <Table head={["When", "Patient", "Service", "Doctor", "Status", "Payment", "Ref"]}>
          {res.rows.map((a) => (
            <tr key={a.id}>
              <td className={td}><Link className="font-semibold underline" href={`/admin/appointments/${a.id}`}>{formatDublin(a.startAt)}</Link></td>
              <td className={td}>{a.patientName}<br /><span className="text-xs text-slate-500">{a.patientPhone}</span></td>
              <td className={td}>{a.serviceName}<br /><span className="text-xs text-slate-500">{formatEuro(a.totalCents)}</span></td>
              <td className={td}>{a.doctorName}</td>
              <td className={td}><Badge value={a.status} /></td><td className={td}><Badge value={a.paymentStatus} /></td>
              <td className={`${td} font-mono text-xs`}>{a.bookingRef}</td>
            </tr>
          ))}
        </Table>
      )}
      <div className="mt-4 flex gap-3 text-sm">
        {page > 1 && <Link className="underline" href={`?${qs(page - 1)}`}>Previous</Link>}
        {page * res.pageSize < res.total && <Link className="underline" href={`?${qs(page + 1)}`}>Next</Link>}
      </div>
    </>
  );
}
