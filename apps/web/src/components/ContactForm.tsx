"use client";

import { useCallback, useState } from "react";
import { Turnstile, turnstileEnabled } from "./Turnstile";

export function ContactForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setToken(t), []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (turnstileEnabled && !token) { setError("Please complete the check below."); setState("error"); return; }
    setState("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: f.get("name"), email: f.get("email"), phone: f.get("phone") || undefined,
          message: f.get("message"), consent: f.get("consent") === "on" ? true : false, website: f.get("website") || undefined, turnstileToken: token ?? undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(res.status === 429 ? "Too many messages. Please wait a minute." : data.message ?? "Please check your details and try again.");
      }
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
      setToken(null); window.turnstile?.reset(); // a token works only once
    }
  }

  if (state === "done") {
    return <p role="status" className="rounded-lg bg-brand-50 p-4 font-medium text-brand-900">Thank you. We have your message and will reply soon.</p>;
  }

  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-3";
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-slate-700">Please do not send medical details here. For medical advice, book an appointment. In an emergency call 112 or 999.</p>
      <label className="block text-sm font-medium">Name<input name="name" required autoComplete="name" className={input} /></label>
      <label className="block text-sm font-medium">Email<input name="email" type="email" required autoComplete="email" className={input} /></label>
      <label className="block text-sm font-medium">Phone (optional)<input name="phone" type="tel" autoComplete="tel" className={input} /></label>
      <label className="block text-sm font-medium">Message<textarea name="message" required minLength={5} rows={5} className={input} /></label>
      <div className="hidden" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className="flex items-start gap-2 text-sm"><input name="consent" type="checkbox" required className="mt-1 size-5" /> I agree that the clinic may use my details to reply. See the <a className="underline" href="/privacy">privacy policy</a>.</label>
      <Turnstile onToken={onToken} />
      {state === "error" && <p role="alert" className="text-red-700">{error}</p>}
      <button disabled={state === "sending"} className="min-h-12 rounded-lg bg-brand-700 px-6 font-bold text-white disabled:opacity-60">{state === "sending" ? "Sending..." : "Send message"}</button>
    </form>
  );
}
