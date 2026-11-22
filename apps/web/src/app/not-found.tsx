import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-3 text-slate-600">That page does not exist or has moved.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link className="rounded-lg bg-brand-700 px-5 py-3 font-semibold text-white" href="/">Home</Link>
        <Link className="rounded-lg bg-accent-500 px-5 py-3 font-semibold text-white" href="/book">Book now</Link>
      </div>
    </main>
  );
}
