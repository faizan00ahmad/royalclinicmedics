import { formatDublin, listAuditLog } from "@rmc/core";
import { Table, Title, td } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";

export default async function AuditPage() {
  await requireCan("audit:read");
  const rows = await listAuditLog(db(), 300);
  return (
    <>
      <Title sub="Who did what, and when. Newest first. Health information is never recorded here.">Audit log</Title>
      <Table head={["When", "Who", "Action", "Item", "From"]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className={td}>{formatDublin(r.createdAt)}</td>
            <td className={td}>{r.actorRole?.toLowerCase() ?? "system"}</td>
            <td className={`${td} font-mono text-xs`}>{r.action}</td>
            <td className={`${td} font-mono text-xs`}>{r.entityType}{r.entityId ? ` ${r.entityId.slice(0, 8)}` : ""}</td>
            <td className={`${td} text-xs`}>{r.ip}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
