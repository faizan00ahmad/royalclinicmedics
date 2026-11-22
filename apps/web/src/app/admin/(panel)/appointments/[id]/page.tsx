import { formatDublin, formatEuro, getAppointmentDetail } from "@rmc/core";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, Flash, Field, btn, btnDanger, btnLight, input } from "@/components/admin/ui";
import { actorOf, can, requireVerified } from "@/lib/admin";
import { db } from "@/lib/server";
import { cancelAction, markPaidAction, noteAction, refundAction, rescheduleAction, statusAction } from "../../../actions";

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; health?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireVerified();

  const preview = await getAppointmentDetail(db(), id, { includeQuestionnaire: false, actor: await actorOf(user) });
  if (!preview) notFound();
  const doctorId = preview.appointment.doctorId;
  if (!can(user, "appointments:read", { doctorId })) redirect("/admin?error=" + encodeURIComponent("You do not have permission to do that."));

  // The questionnaire is loaded (and audited) only when explicitly requested.
  const mayReadHealth = can(user, "appointments:questionnaire", { doctorId });
  const wantsHealth = sp.health === "1" && mayReadHealth;
  const d = wantsHealth ? (await getAppointmentDetail(db(), id, { includeQuestionnaire: true, actor: await actorOf(user) }))! : preview;
  const a = d.appointment;
  const staff = can(user, "appointments:write");
  const active = a.status === "CONFIRMED" || a.status === "CHECKED_IN";
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const q = d.questionnaire as Record<string, unknown> | null | undefined;

  return (
    <>
      <p className="text-sm"><Link className="underline" href="/admin/appointments">All appointments</Link></p>
      <div className="mb-6 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{d.patient.firstName} {d.patient.lastName}</h1>
        <Badge value={a.status} /> <Badge value={a.paymentStatus} />
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Appointment">
          <dl className="space-y-2 text-sm">
            <div><dt className="text-slate-500">When (Irish time)</dt><dd className="font-semibold">{formatDublin(a.startAt)} to {formatDublin(a.endAt).split(", ")[1]}</dd></div>
            <div><dt className="text-slate-500">Service</dt><dd>{d.service.name} · {formatEuro(a.totalCents)}</dd></div>
            <div><dt className="text-slate-500">Doctor</dt><dd>{d.doctor.displayName}</dd></div>
            <div><dt className="text-slate-500">Reference</dt><dd className="font-mono">{a.bookingRef}</dd></div>
            <div><dt className="text-slate-500">Booked via</dt><dd>{a.source.replace("_", " ").toLowerCase()} on {formatDublin(a.createdAt)}</dd></div>
            {a.reason && <div><dt className="text-slate-500">Reason given</dt><dd>{a.reason}</dd></div>}
          </dl>
        </Card>

        <Card title="Patient">
          <dl className="space-y-2 text-sm">
            <div><dt className="text-slate-500">Phone</dt><dd><a className="underline" href={`tel:${d.patient.phone}`}>{d.patient.phone}</a></dd></div>
            <div><dt className="text-slate-500">Email</dt><dd>{d.patient.email || "none given"}</dd></div>
            <div><dt className="text-slate-500">Date of birth</dt><dd>{d.patient.dob}</dd></div>
            <div><dt className="text-slate-500">Medical card</dt><dd>{d.patient.medicalCard ? "Yes" : "No"}</dd></div>
            {d.patient.guardianName && <div><dt className="text-slate-500">Parent or guardian</dt><dd>{d.patient.guardianName}</dd></div>}
          </dl>
        </Card>
      </div>

      {staff && active && (
        <Card title="Actions" className="mt-4">
          <div className="flex flex-wrap gap-2">
            {a.status === "CONFIRMED" && <form action={statusAction}>{hidden("id", id)}{hidden("to", "CHECKED_IN")}<button className={btn}>Check in</button></form>}
            <form action={statusAction}>{hidden("id", id)}{hidden("to", "COMPLETED")}<button className={btn}>Mark completed</button></form>
            {a.status === "CONFIRMED" && <form action={statusAction}>{hidden("id", id)}{hidden("to", "NO_SHOW")}<button className={btnLight}>No-show</button></form>}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <form action={rescheduleAction} className="flex items-end gap-2">{hidden("id", id)}
              <Field label="Move to (Irish time)"><input type="datetime-local" name="when" step={900} required className={input} /></Field>
              <button className={btnLight}>Move</button>
            </form>
            <form action={cancelAction} className="flex items-end gap-2">{hidden("id", id)}
              <Field label="Cancel (full refund if paid online)"><input name="reason" placeholder="Reason (optional)" className={input} /></Field>
              <button className={btnDanger}>Cancel</button>
            </form>
          </div>
        </Card>
      )}

      <Card title="Payment" className="mt-4">
        {d.payments.length === 0 && <p className="text-sm text-slate-600">No payment recorded yet.</p>}
        <ul className="space-y-1 text-sm">
          {d.payments.map((p) => (
            <li key={p.id}><Badge value={p.status} /> {formatEuro(p.amountCents)} via {p.provider.toLowerCase()}{p.method ? ` (${p.method.replace("_", " ").toLowerCase()})` : ""}{p.receiptNumber ? ` · receipt ${p.receiptNumber}` : ""}</li>
          ))}
          {d.refunds.map((r) => <li key={r.id} className="text-slate-600">Refunded {formatEuro(r.amountCents)}: {r.reason}</li>)}
        </ul>
        {a.paymentChoice === "AT_CLINIC" && a.paymentStatus === "UNPAID" && can(user, "payments:markPaid") && ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(a.status) && (
          <form action={markPaidAction} className="mt-3 flex items-end gap-2">{hidden("id", id)}
            <Field label="Paid at the clinic by"><select name="method" className={input}><option value="TERMINAL">Card terminal</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select></Field>
            <button className={btn}>Mark as paid</button>
          </form>
        )}
        {d.payments.some((p) => p.status === "PAID" || p.status === "PARTIALLY_REFUNDED") && can(user, "payments:refund") && (
          <form action={refundAction} className="mt-3 flex flex-wrap items-end gap-2">{hidden("id", id)}
            <Field label="Refund amount (€, blank = everything left)"><input name="amount" inputMode="decimal" className={input} /></Field>
            <Field label="Reason"><input name="reason" className={input} /></Field>
            <button className={btnDanger}>Refund</button>
          </form>
        )}
      </Card>

      <Card title="Health questionnaire" className="mt-4">
        {q ? (
          <dl className="space-y-2 text-sm">
            {Object.entries(q).filter(([k]) => k !== "version").map(([k, v]) => (
              <div key={k}><dt className="text-slate-500">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt><dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>
            ))}
          </dl>
        ) : mayReadHealth ? (
          <>
            <p className="text-sm text-slate-600">Private health answers. Opening them is recorded in the audit log.</p>
            {/* Plain link: a prefetch must never open (and audit) the answers */}
            <a className={`${btnLight} mt-3`} href={`?health=1`}>Show answers</a>
          </>
        ) : <p className="text-sm text-slate-600">You do not have access to these answers.</p>}
      </Card>

      {staff && (
        <Card title="Staff note (not a medical record)" className="mt-4">
          <form action={noteAction} className="space-y-2">{hidden("id", id)}
            <textarea name="note" defaultValue={a.staffNote ?? ""} rows={3} maxLength={1000} className={input} />
            <button className={btnLight}>Save note</button>
          </form>
        </Card>
      )}

      <Card title="History" className="mt-4">
        <ul className="space-y-1 text-sm text-slate-700">
          {d.events.map((e) => <li key={e.id}>{formatDublin(e.occurredAt)}: {e.type}</li>)}
          {d.consents.map((c) => <li key={c.id}>{formatDublin(c.acceptedAt)}: accepted {c.type.toLowerCase()} v{c.documentVersion}</li>)}
        </ul>
      </Card>
    </>
  );
}
