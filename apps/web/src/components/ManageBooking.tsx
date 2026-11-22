"use client";

import { useCallback, useEffect, useState } from "react";
import { api, euro, fullLabel } from "@/lib/client";
import { SlotPicker } from "./SlotPicker";

interface Summary {
  bookingRef: string; serviceId: string; doctorId: string; status: string; paymentStatus: string; paymentChoice: string;
  startAt: string; endAt: string; totalCents: number; service: { name: string }; doctor: { displayName: string };
  patientFirstName: string; canCancelFree: boolean; canReschedule: boolean; reschedulesLeft: number; cancellationWindowHours: number;
  clinic: { name: string; phone: string; address: string };
}

const STATUS_TEXT: Record<string, string> = {
  PENDING_PAYMENT: "Waiting for payment", CONFIRMED: "Confirmed", CHECKED_IN: "Checked in", COMPLETED: "Completed",
  CANCELLED_BY_PATIENT: "Cancelled", CANCELLED_BY_CLINIC: "Cancelled by the clinic", NO_SHOW: "Missed",
};

/** WEB-10. The token lives in the URL fragment (#token=...), which browsers never send to servers or in Referer headers. */
export function ManageBooking({ bookingRef, paid }: { bookingRef: string; paid: boolean }) {
  const [token, setToken] = useState("");
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"view" | "reschedule" | "confirmCancel">("view");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("token");
    const fromQuery = new URLSearchParams(window.location.search).get("token"); // links from older emails
    setToken(fromHash ?? fromQuery ?? "");
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try { setS(await api<Summary>(`/api/bookings/${bookingRef}`, { token })); setError(""); }
    catch { setError("We could not find that booking. Please check your link, or phone the clinic."); }
  }, [bookingRef, token]);

  useEffect(() => { void load(); }, [load]);

  // After paying, the webhook may take a few seconds to confirm the booking.
  useEffect(() => {
    if (!paid || !s || s.status !== "PENDING_PAYMENT") return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [paid, s, load]);

  async function cancel() {
    setBusy(true);
    try {
      const r = await api<{ status: string; refundedCents: number }>(`/api/bookings/${bookingRef}/cancel`, { method: "POST", token });
      setNotice(r.refundedCents ? `Your appointment is cancelled and ${euro(r.refundedCents)} will be refunded to your card.` : "Your appointment is cancelled.");
      setMode("view");
      await load();
    } catch (e) { setNotice((e as Error).message); setMode("view"); } finally { setBusy(false); }
  }

  async function reschedule(startAt: string) {
    setBusy(true);
    try {
      await api(`/api/bookings/${bookingRef}/reschedule`, { method: "POST", token, body: JSON.stringify({ newStartAt: startAt }) });
      setNotice("Your appointment has been moved.");
      setMode("view");
      await load();
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  }

  if (error) return <p role="alert" className="mx-auto max-w-xl px-4 py-16 text-center">{error}</p>;
  if (!token) return <p className="mx-auto max-w-xl px-4 py-16 text-center">This page needs the link from your confirmation email.</p>;
  if (!s) return <p className="mx-auto max-w-xl px-4 py-16 text-center">Loading your booking...</p>;

  const active = s.status === "CONFIRMED" || s.status === "PENDING_PAYMENT";
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-bold">Your appointment</h1>
      {paid && s.status === "PENDING_PAYMENT" && <p role="status" className="mt-4 rounded-lg bg-brand-50 p-3">Thank you. We are confirming your payment...</p>}
      {notice && <p role="status" className="mt-4 rounded-lg bg-brand-50 p-3">{notice}</p>}

      <dl className="mt-6 space-y-3 rounded-xl border border-slate-200 p-5">
        <div><dt className="text-sm text-slate-500">Status</dt><dd className="font-semibold">{STATUS_TEXT[s.status] ?? s.status}</dd></div>
        <div><dt className="text-sm text-slate-500">Reference</dt><dd className="font-semibold">{s.bookingRef}</dd></div>
        <div><dt className="text-sm text-slate-500">Appointment</dt><dd>{s.service.name} with {s.doctor.displayName}</dd></div>
        <div><dt className="text-sm text-slate-500">When (Irish time)</dt><dd className="font-semibold">{fullLabel(s.startAt)}</dd></div>
        <div><dt className="text-sm text-slate-500">Where</dt><dd>{s.clinic.name}{s.clinic.address && !s.clinic.address.includes("[TBD]") ? `, ${s.clinic.address}` : ""}</dd></div>
        <div><dt className="text-sm text-slate-500">Payment</dt><dd>{euro(s.totalCents)}: {s.paymentStatus === "PAID" ? "paid" : s.paymentChoice === "AT_CLINIC" ? "to pay at the clinic" : s.paymentStatus.toLowerCase().replace("_", " ")}</dd></div>
      </dl>

      {active && (
        <div className="mt-6 space-y-3">
          <a className="inline-block rounded-lg border-2 border-brand-700 px-5 py-3 font-semibold text-brand-700" href={`/api/bookings/${s.bookingRef}/ics?token=${encodeURIComponent(token)}`}>Add to calendar</a>
          {mode === "view" && (
            <div className="flex flex-wrap gap-3">
              <button disabled={!s.canReschedule} onClick={() => setMode("reschedule")} className="min-h-12 rounded-lg bg-brand-700 px-5 font-semibold text-white disabled:opacity-40">Change time</button>
              <button disabled={!s.canCancelFree} onClick={() => setMode("confirmCancel")} className="min-h-12 rounded-lg border-2 border-red-700 px-5 font-semibold text-red-700 disabled:opacity-40">Cancel appointment</button>
            </div>
          )}
          {mode === "view" && (!s.canCancelFree || (!s.canReschedule && s.status === "CONFIRMED")) && (
            <p className="text-sm text-slate-600">
              Free changes end {s.cancellationWindowHours} hours before your appointment{s.reschedulesLeft === 0 ? ", and this booking has used all its changes" : ""}.
              To change it now, please phone the clinic{s.clinic.phone && !s.clinic.phone.includes("[TBD]") ? ` on ${s.clinic.phone}` : ""}.
            </p>
          )}
          {mode === "confirmCancel" && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="font-semibold">Cancel this appointment?</p>
              <div className="mt-3 flex gap-3">
                <button disabled={busy} onClick={cancel} className="min-h-11 rounded-lg bg-red-700 px-5 font-semibold text-white">Yes, cancel</button>
                <button onClick={() => setMode("view")} className="min-h-11 rounded-lg border px-5 font-semibold">Keep it</button>
              </div>
            </div>
          )}
          {mode === "reschedule" && (
            <div className="rounded-xl border border-slate-200 p-4">
              <h2 className="font-semibold">Pick a new time</h2>
              <div className="mt-3"><SlotPicker serviceId={s.serviceId} doctorId={s.doctorId} windowDays={30} onPick={(p) => void reschedule(p.startAt)} busy={busy} /></div>
              <button onClick={() => setMode("view")} className="mt-4 underline">Back</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
