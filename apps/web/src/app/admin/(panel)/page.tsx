import { formatDublin, formatEuro, getDashboard } from "@rmc/core";
import Link from "next/link";
import { Badge, Card, Flash, Table, Title, td } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireCan("dashboard:read");
  const d = await getDashboard(db(), { doctorId: user.role === "DOCTOR" ? user.doctorId ?? undefined : undefined });
  const tiles: [string, string | number][] = [
    ["Today", d.counts.today], ["This week", d.counts.week], ["New in 24 hours", d.counts.new24h],
    ["To pay at clinic", d.counts.unpaidAtClinic], ["Taken today", formatEuro(d.paidTodayCents)], ["Taken this month", formatEuro(d.paidMonthCents)],
  ];
  if (user.role !== "DOCTOR") tiles.push(["New enquiries", d.counts.newEnquiries]);

  return (
    <>
      <Title sub={d.today}>Dashboard</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value]) => (
          <Card key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></Card>
        ))}
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Today&apos;s appointments</h2>
      {d.timeline.length === 0 ? <p className="text-slate-600">Nothing booked for today.</p> : (
        <Table head={["Time", "Patient", "Service", "Doctor", "Status", "Payment"]}>
          {d.timeline.map((a) => (
            <tr key={a.id}>
              <td className={td}><Link className="font-semibold underline" href={`/admin/appointments/${a.id}`}>{formatDublin(a.startAt).split(", ")[1]}</Link></td>
              <td className={td}>{a.patientName}</td><td className={td}>{a.serviceName}</td><td className={td}>{a.doctorName}</td>
              <td className={td}><Badge value={a.status} /></td><td className={td}><Badge value={a.paymentStatus} /></td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
