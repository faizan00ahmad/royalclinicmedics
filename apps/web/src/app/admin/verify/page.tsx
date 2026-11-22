import { beginEnrolment } from "@rmc/auth";
import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { Flash, btn, input } from "@/components/admin/ui";
import { currentUser } from "@/lib/admin";
import { db } from "@/lib/server";
import { logoutAction, verifyAction } from "../auth-actions";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  if (user.mfaVerified) redirect("/admin");

  // First sign-in: show the QR code once so the authenticator app can be set up.
  const enrol = user.totpConfirmed ? null : await beginEnrolment(db(), user.id);
  const qr = enrol ? await QRCode.toString(enrol.uri, { type: "svg", margin: 1, width: 220 }) : null;

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">{enrol ? "Set up two-factor sign-in" : "Enter your code"}</h1>
      {enrol ? (
        <div className="mt-3 space-y-3 text-sm text-slate-700">
          <p>1. Install an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or 1Password).</p>
          <p>2. Scan this code, or type the key into the app.</p>
          {/* QR is generated on our server from our own data */}
          <div className="flex justify-center rounded-xl bg-white p-3" dangerouslySetInnerHTML={{ __html: qr! }} />
          <p className="break-all rounded bg-slate-100 p-2 text-center font-mono text-xs">{enrol.secret}</p>
          <p>3. Type the 6 digit code the app shows.</p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-600">Open your authenticator app and type the 6 digit code for Royal Medics Clinic.</p>
      )}
      <div className="mt-6"><Flash error={sp.error} /></div>
      <form action={verifyAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <label className="block text-sm font-medium">6 digit code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus className={`${input} text-center text-xl tracking-widest`} />
        </label>
        <button className={`${btn} w-full`}>{enrol ? "Confirm and sign in" : "Sign in"}</button>
      </form>
      <form action={logoutAction} className="mt-4 text-center"><button className="text-sm underline">Cancel</button></form>
    </main>
  );
}
