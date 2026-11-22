import { notFound } from "next/navigation";
import { Flash, btn, input } from "@/components/admin/ui";
import { setupAction, staffCount } from "../auth-actions";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  if ((await staffCount()) > 0) notFound(); // closes itself once the first administrator exists
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold">Create the first administrator</h1>
      <p className="mt-1 text-sm text-slate-600">This page only works once. After this, add other staff from the Staff page.</p>
      <div className="mt-6"><Flash ok={sp.ok} error={sp.error} /></div>
      <form action={setupAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <label className="block text-sm font-medium">Your name<input name="name" required className={input} /></label>
        <label className="block text-sm font-medium">Email<input name="email" type="email" required autoComplete="username" className={input} /></label>
        <label className="block text-sm font-medium">Password (at least 12 characters)<input name="password" type="password" required minLength={12} autoComplete="new-password" className={input} /></label>
        <label className="block text-sm font-medium">Repeat password<input name="password2" type="password" required minLength={12} autoComplete="new-password" className={input} /></label>
        {process.env.NODE_ENV === "production" && (
          <label className="block text-sm font-medium">Setup code (from your hosting settings)<input name="setupToken" type="password" required className={input} /></label>
        )}
        <button className={`${btn} w-full`}>Create administrator</button>
      </form>
    </main>
  );
}
