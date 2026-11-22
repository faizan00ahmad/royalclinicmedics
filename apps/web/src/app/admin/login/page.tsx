import { redirect } from "next/navigation";
import { Flash, btn, input } from "@/components/admin/ui";
import { currentUser } from "@/lib/admin";
import { loginAction, staffCount } from "../auth-actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  if ((await staffCount()) === 0) redirect("/admin/setup");
  const user = await currentUser();
  if (user?.mfaVerified) redirect("/admin");
  if (user) redirect("/admin/verify");
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">Staff sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Royal Medics Clinic admin</p>
      <div className="mt-6"><Flash ok={sp.ok} error={sp.error} /></div>
      <form action={loginAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <label className="block text-sm font-medium">Email<input name="email" type="email" required autoComplete="username" className={input} /></label>
        <label className="block text-sm font-medium">Password<input name="password" type="password" required autoComplete="current-password" className={input} /></label>
        <button className={`${btn} w-full`}>Continue</button>
      </form>
    </main>
  );
}
