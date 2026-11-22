"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Turnstile, turnstileEnabled } from "./Turnstile";
import { api, euro, fullLabel } from "@/lib/client";
import { SlotPicker, type PickedSlot } from "./SlotPicker";

export interface WizardService {
  id: string; slug: string; name: string; shortDescription: string | null;
  priceCents: number; durationMin: number; payAtClinicAllowed: boolean;
}
interface Props {
  services: WizardService[]; initialSlug?: string; stripeKey: string; windowDays: number;
  phone: string; phoneHref: string; cancellationHours: number;
}
interface Hold { holdId: string; startAt: string; expiresAt: string }
interface Result { bookingRef: string; manageToken: string; status: string; clientSecret?: string; amountCents: number }

const CONDITIONS = [["DIABETES", "Diabetes"], ["HEART_DISEASE", "Heart disease"], ["ASTHMA", "Asthma"], ["PREGNANCY", "Pregnancy"], ["OTHER", "Other"]] as const;
const box = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-3";

export function BookingWizard(p: Props) {
  const preset = p.services.find((s) => s.slug === p.initialSlug) ?? null;
  const [service, setService] = useState<WizardService | null>(preset);
  const [hold, setHold] = useState<Hold | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const step = result ? (result.clientSecret ? "pay" : "done") : hold ? "details" : service ? "time" : "service";

  async function pick(slot: PickedSlot) {
    if (!service) return;
    setBusy(true); setError("");
    try {
      const h = await api<Hold>("/api/bookings/hold", { method: "POST", body: JSON.stringify({ serviceId: service.id, startAt: slot.startAt }) });
      setHold(h);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold">Book an appointment</h1>
      <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm">This service is not for emergencies. In an emergency call <a className="underline" href="tel:112">112</a> or <a className="underline" href="tel:999">999</a>.</p>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}

      {step === "service" && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">1. Choose a service</h2>
          <ul className="mt-4 space-y-3">
            {p.services.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => { setService(s); setError(""); }} className="w-full rounded-xl border-2 border-slate-200 p-4 text-left hover:border-brand-700">
                  <span className="flex justify-between gap-4 font-semibold"><span>{s.name}</span><span>{euro(s.priceCents)}</span></span>
                  <span className="mt-1 block text-sm text-slate-600">{s.durationMin} min{s.shortDescription ? ` · ${s.shortDescription}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === "time" && service && (
        <section className="mt-6">
          <button type="button" className="text-sm underline" onClick={() => setService(null)}>Change service</button>
          <h2 className="mt-2 text-xl font-semibold">2. Pick a time for {service.name}</h2>
          <div className="mt-4"><SlotPicker serviceId={service.id} windowDays={p.windowDays} onPick={pick} busy={busy} /></div>
        </section>
      )}

      {step === "details" && service && hold && (
        <DetailsStep
          service={service} hold={hold} p={p}
          onExpired={() => { setHold(null); setError("Your held time ran out. Please pick a time again."); }}
          onBack={() => setHold(null)}
          onDone={setResult}
        />
      )}

      {step === "pay" && result && service && (
        <PayStep result={result} service={service} stripeKey={p.stripeKey} />
      )}

      {step === "done" && result && service && hold && (
        <section className="mt-6 rounded-xl bg-brand-50 p-6" role="status">
          <h2 className="text-2xl font-bold text-brand-900">Your appointment is booked</h2>
          <p className="mt-2">Reference: <strong>{result.bookingRef}</strong></p>
          <p>{service.name} on <strong>{fullLabel(hold.startAt)}</strong> (Irish time)</p>
          <p className="mt-2 text-sm">Please pay at the clinic. Bring photo ID{p.phone ? ` and call ${p.phone} if anything changes` : ""}.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link className="rounded-lg bg-brand-700 px-5 py-3 font-semibold text-white" href={`/booking/${result.bookingRef}#token=${result.manageToken}`}>Manage or cancel</Link>
            <a className="rounded-lg border-2 border-brand-700 px-5 py-3 font-semibold text-brand-700" href={`/api/bookings/${result.bookingRef}/ics?token=${encodeURIComponent(result.manageToken)}`}>Add to calendar</a>
          </div>
          <p className="mt-4 text-sm text-slate-600">Keep your manage link private. It lets anyone with it change this booking.</p>
        </section>
      )}
    </div>
  );
}

function Countdown({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) { clearInterval(t); onExpired(); }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, onExpired]);
  return <span aria-live="off">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>;
}

function DetailsStep({ service, hold, p, onExpired, onBack, onDone }: {
  service: WizardService; hold: Hold; p: Props; onExpired: () => void; onBack: () => void; onDone: (r: Result) => void;
}) {
  const [for_, setFor] = useState<"me" | "child" | "other">("me");
  const [medCard, setMedCard] = useState(false);
  const [allergies, setAllergies] = useState(false);
  const [conditions, setConditions] = useState<string[]>([]);
  const [choice, setChoice] = useState<"ONLINE" | "AT_CLINIC">(p.stripeKey || !service.payAtClinicAllowed ? "ONLINE" : "AT_CLINIC");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setToken(t), []);
  const canOnline = Boolean(p.stripeKey) && service.priceCents > 0;
  const options = useMemo(() => [canOnline && "ONLINE", service.payAtClinicAllowed && "AT_CLINIC"].filter(Boolean) as ("ONLINE" | "AT_CLINIC")[], [canOnline, service.payAtClinicAllowed]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    if (g("email") !== g("email2")) { setError("The two email addresses do not match."); return; }
    if (medCard) { setError("Medical card patients: please phone the clinic to book."); return; }
    if (turnstileEnabled && !token) { setError("Please complete the check above the button."); return; }
    setBusy(true); setError("");
    try {
      const r = await api<Result>("/api/bookings/checkout", {
        method: "POST",
        body: JSON.stringify({
          holdId: hold.holdId,
          turnstileToken: token ?? undefined,
          paymentChoice: choice,
          reason: g("reason") || undefined,
          patient: {
            firstName: g("firstName"), lastName: g("lastName"), dob: g("dob"), email: g("email"), phone: g("phone"),
            addressLine1: g("address") || undefined, eircode: g("eircode") || undefined,
            medicalCard: medCard, guardianName: for_ === "me" ? undefined : g("guardian") || undefined,
            marketingOptIn: f.get("marketing") === "on",
          },
          questionnaire: {
            symptoms: g("symptoms"), allergies: { has: allergies, details: allergies ? g("allergyDetails") : undefined },
            medications: g("medications"), conditions, conditionsOther: conditions.includes("OTHER") ? g("conditionsOther") : undefined,
            smoker: f.get("smoker") === "yes", notes: g("notes") || undefined,
          },
          consents: { terms: f.get("terms") === "on", privacy: f.get("privacy") === "on", cancellation: f.get("cancellation") === "on", marketing: f.get("marketing") === "on" },
        }),
      });
      onDone(r);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setToken(null); window.turnstile?.reset(); // a token works only once
    }
  }

  const toggle = (c: string) => setConditions((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      <div className="rounded-xl bg-brand-50 p-4">
        <p className="font-semibold">{service.name} · {fullLabel(hold.startAt)}</p>
        <p className="text-sm">We are holding this time for you for <strong><Countdown expiresAt={hold.expiresAt} onExpired={onExpired} /></strong>. <button type="button" className="underline" onClick={onBack}>Choose another time</button></p>
      </div>

      <fieldset className="space-y-4">
        <legend className="text-xl font-semibold">3. Your details</legend>
        <label className="block text-sm font-medium">Who is the appointment for?
          <select className={box} value={for_} onChange={(e) => setFor(e.target.value as typeof for_)}>
            <option value="me">Myself</option><option value="child">My child</option><option value="other">Someone else</option>
          </select>
        </label>
        {for_ !== "me" && <label className="block text-sm font-medium">Your name (parent, guardian or carer)<input name="guardian" required className={box} /></label>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">{for_ === "me" ? "First name" : "Patient's first name"}<input name="firstName" required autoComplete="given-name" className={box} /></label>
          <label className="block text-sm font-medium">{for_ === "me" ? "Last name" : "Patient's last name"}<input name="lastName" required autoComplete="family-name" className={box} /></label>
        </div>
        <label className="block text-sm font-medium">Date of birth<input name="dob" type="date" required max={new Date().toISOString().slice(0, 10)} autoComplete="bday" className={box} /></label>
        <label className="block text-sm font-medium">Email (for your confirmation)<input name="email" type="email" required autoComplete="email" className={box} /></label>
        <label className="block text-sm font-medium">Confirm email<input name="email2" type="email" required autoComplete="off" className={box} /></label>
        <label className="block text-sm font-medium">Mobile phone<input name="phone" type="tel" required defaultValue="+353 " autoComplete="tel" className={box} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">Address (optional)<input name="address" autoComplete="street-address" className={box} /></label>
          <label className="block text-sm font-medium">Eircode (optional)<input name="eircode" autoComplete="postal-code" className={box} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={medCard} onChange={(e) => setMedCard(e.target.checked)} /> The patient has a medical card (GMS)</label>
        {medCard && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">
            Medical card patients, please phone the clinic to book so we can confirm what applies. {p.phone && <a className="font-semibold underline" href={p.phoneHref}>Call {p.phone}</a>}
          </p>
        )}
        <label className="block text-sm font-medium">Reason for your visit (optional, max 500 characters)<textarea name="reason" maxLength={500} rows={3} className={box} /></label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xl font-semibold">4. Health questions</legend>
        <p className="text-sm text-slate-600">These help the doctor prepare. They are kept private and are never sent by email.</p>
        <label className="block text-sm font-medium">Current symptoms or concerns<textarea name="symptoms" maxLength={1000} rows={3} className={box} /></label>
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-5" checked={allergies} onChange={(e) => setAllergies(e.target.checked)} /> I have known allergies</label>
        {allergies && <label className="block text-sm font-medium">Which allergies?<input name="allergyDetails" maxLength={500} className={box} /></label>}
        <label className="block text-sm font-medium">Current medications<textarea name="medications" maxLength={1000} rows={2} className={box} /></label>
        <div><p className="text-sm font-medium">Do any of these apply?</p>
          <div className="mt-2 flex flex-wrap gap-4">{CONDITIONS.map(([k, label]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={conditions.includes(k)} onChange={() => toggle(k)} /> {label}</label>)}</div>
        </div>
        {conditions.includes("OTHER") && <label className="block text-sm font-medium">Other condition<input name="conditionsOther" maxLength={300} className={box} /></label>}
        <fieldset><legend className="text-sm font-medium">Do you smoke?</legend>
          <label className="mr-6 text-sm"><input type="radio" name="smoker" value="yes" className="mr-1" required /> Yes</label>
          <label className="text-sm"><input type="radio" name="smoker" value="no" className="mr-1" /> No</label>
        </fieldset>
        <label className="block text-sm font-medium">Anything else the doctor should know (optional)<textarea name="notes" maxLength={1000} rows={2} className={box} /></label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xl font-semibold">5. Agree and pay</legend>
        <label className="flex items-start gap-2 text-sm"><input name="terms" type="checkbox" required className="mt-1 size-5" /> I accept the <Link className="underline" target="_blank" href="/terms">terms</Link>.</label>
        <label className="flex items-start gap-2 text-sm"><input name="privacy" type="checkbox" required className="mt-1 size-5" /> I agree the clinic may use my health information for this appointment, as set out in the <Link className="underline" target="_blank" href="/privacy">privacy policy</Link>.</label>
        <label className="flex items-start gap-2 text-sm"><input name="cancellation" type="checkbox" required className="mt-1 size-5" /> I accept the <Link className="underline" target="_blank" href="/cancellation-policy">cancellation policy</Link> (free changes up to {p.cancellationHours} hours before).</label>
        <label className="flex items-start gap-2 text-sm"><input name="marketing" type="checkbox" className="mt-1 size-5" /> Send me clinic news by email (optional).</label>

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="font-semibold">{service.name}: {euro(service.priceCents)}</p>
          {options.length === 0 && <p className="mt-2 text-sm text-red-700">Online booking is not available for this service right now. Please phone the clinic.</p>}
          {options.length > 0 && (
            <div className="mt-2 space-y-2" role="radiogroup" aria-label="Payment">
              {options.includes("ONLINE") && <label className="flex items-center gap-2"><input type="radio" name="pay" className="size-5" checked={choice === "ONLINE"} onChange={() => setChoice("ONLINE")} /> Pay now (card, Apple Pay, Google Pay)</label>}
              {options.includes("AT_CLINIC") && <label className="flex items-center gap-2"><input type="radio" name="pay" className="size-5" checked={choice === "AT_CLINIC"} onChange={() => setChoice("AT_CLINIC")} /> Pay at the clinic</label>}
            </div>
          )}
        </div>
      </fieldset>

      <Turnstile onToken={onToken} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <button disabled={busy || options.length === 0} className="min-h-12 w-full rounded-lg bg-accent-500 px-6 text-lg font-bold text-white disabled:opacity-50">
        {busy ? "Please wait..." : choice === "ONLINE" ? "Continue to payment" : "Confirm booking"}
      </button>
    </form>
  );
}

function PayStep({ result, service, stripeKey }: { result: Result; service: WizardService; stripeKey: string }) {
  const stripePromise = useMemo(() => loadStripe(stripeKey), [stripeKey]);
  return (
    <section className="mt-6">
      <h2 className="text-xl font-semibold">Pay {euro(result.amountCents)} for {service.name}</h2>
      <p className="mt-1 text-sm text-slate-600">Your card details go straight to Stripe. We never see them. Reference {result.bookingRef}.</p>
      <div className="mt-4">
        <Elements stripe={stripePromise} options={{ clientSecret: result.clientSecret! }}>
          <PayForm result={result} />
        </Elements>
      </div>
    </section>
  );
}

function PayForm({ result }: { result: Result }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setError("");
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/booking/${result.bookingRef}?paid=1#token=${result.manageToken}` },
    });
    if (err) { setError(err.message ?? "Payment failed. Please try again."); setBusy(false); }
  }

  return (
    <form onSubmit={pay} className="space-y-4">
      <PaymentElement />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <button disabled={!stripe || busy} className="min-h-12 w-full rounded-lg bg-accent-500 text-lg font-bold text-white disabled:opacity-50">{busy ? "Processing..." : "Pay now"}</button>
    </form>
  );
}
