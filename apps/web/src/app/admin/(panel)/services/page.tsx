import { formatEuro, listAllServices } from "@rmc/core";
import Link from "next/link";
import { Badge, Flash, Table, Title, btn, td } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";

export default async function ServicesAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireCan("services:write");
  const services = await listAllServices(db());
  return (
    <>
      <Title sub="Changes are live on the website straight away.">Services and prices</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <p className="mb-4"><Link className={btn} href="/admin/services/new">Add a service</Link></p>
      <Table head={["Service", "Category", "Price", "Length", "Pay at clinic", "Shown", ""]}>
        {services.map((s) => (
          <tr key={s.id}>
            <td className={td}><span className="font-medium">{s.name}</span><br /><span className="text-xs text-slate-500">/services/{s.slug}</span></td>
            <td className={td}>{s.category}</td><td className={td}>{formatEuro(s.priceCents)}</td>
            <td className={td}>{s.durationMin} min{s.bufferMin ? ` + ${s.bufferMin}` : ""}</td>
            <td className={td}>{s.payAtClinicAllowed ? "Yes" : "No"}</td>
            <td className={td}>{s.active ? <Badge value="PAID" /> : <Badge value="CANCELLED_BY_CLINIC" />}</td>
            <td className={td}><Link className="underline" href={`/admin/services/${s.id}`}>Edit</Link></td>
          </tr>
        ))}
      </Table>
    </>
  );
}
