import { listAllServices, listDoctors } from "@rmc/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Field, Flash, Title, btn, input } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";
import { saveServiceAction } from "../../../actions";

export default async function EditService({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  await requireCan("services:write");
  const [all, doctors] = await Promise.all([listAllServices(db()), listDoctors(db())]);
  const s = id === "new" ? null : all.find((x) => x.id === id);
  if (id !== "new" && !s) notFound();
  const check = (v: boolean | undefined, dflt: boolean) => (v ?? dflt);

  return (
    <>
      <p className="text-sm"><Link className="underline" href="/admin/services">All services</Link></p>
      <Title>{s ? `Edit ${s.name}` : "Add a service"}</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <form action={saveServiceAction} className="space-y-4">
        {s && <input type="hidden" name="id" value={s.id} />}
        <Card title="Basics">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><input name="name" required defaultValue={s?.name} className={input} /></Field>
            <Field label="Category" hint="Services are grouped by this on the website."><input name="category" defaultValue={s?.category ?? "General"} className={input} /></Field>
            <Field label="Price (€)"><input name="price" required inputMode="decimal" defaultValue={s ? (s.priceCents / 100).toFixed(2) : ""} className={input} /></Field>
            <Field label="Length (minutes)"><input name="durationMin" type="number" min={5} max={480} required defaultValue={s?.durationMin ?? 15} className={input} /></Field>
            <Field label="Gap after (minutes)" hint="Clean-up time. Not offered to the next patient."><input name="bufferMin" type="number" min={0} max={120} defaultValue={s?.bufferMin ?? 0} className={input} /></Field>
            <Field label="Order on the website" hint="Lower numbers first."><input name="sortOrder" type="number" min={0} defaultValue={s?.sortOrder ?? 0} className={input} /></Field>
          </div>
          <div className="mt-4 grid gap-2">
            <Field label="Short description (cards)"><input name="shortDescription" maxLength={300} defaultValue={s?.shortDescription ?? ""} className={input} /></Field>
            <Field label="Full description (service page)"><textarea name="description" rows={5} maxLength={5000} defaultValue={s?.description ?? ""} className={input} /></Field>
          </div>
        </Card>
        <Card title="Rules">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={check(s?.active, true)} className="size-5" /> Shown on the website and bookable</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="featured" defaultChecked={check(s?.featured, false)} className="size-5" /> Featured on the home page</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="payAtClinicAllowed" defaultChecked={check(s?.payAtClinicAllowed, true)} className="size-5" /> Patients may pay at the clinic</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="gmsEligible" defaultChecked={check(s?.gmsEligible, false)} className="size-5" /> Medical card eligible</label>
          </div>
          <div className="mt-4 max-w-xs"><Field label="Minimum notice override (minutes)" hint="Leave blank to use the clinic setting. Use 15 for same-day appointments."><input name="minNoticeOverrideMin" type="number" min={0} defaultValue={s?.minNoticeOverrideMin ?? ""} className={input} /></Field></div>
        </Card>
        <Card title="Which doctors provide it">
          {doctors.map((d) => (
            <label key={d.id} className="mr-6 inline-flex items-center gap-2 text-sm"><input type="checkbox" name="doctorIds" value={d.id} defaultChecked={s ? s.doctorIds.includes(d.id) : true} className="size-5" /> {d.displayName}</label>
          ))}
        </Card>
        <Card title="Search engines (optional)">
          <div className="grid gap-4">
            <Field label="Web address ending" hint="Letters, numbers and dashes. Leave blank to make it from the name."><input name="slug" defaultValue={s?.slug ?? ""} className={input} /></Field>
            <Field label="Page title (max 70)"><input name="seoTitle" maxLength={70} defaultValue={s?.seoTitle ?? ""} className={input} /></Field>
            <Field label="Page description (max 160)"><input name="seoDescription" maxLength={160} defaultValue={s?.seoDescription ?? ""} className={input} /></Field>
          </div>
        </Card>
        <button className={btn}>Save service</button>
      </form>
    </>
  );
}
