import { exportPatientData } from "@rmc/core";
import { actorOf, can, currentUser } from "@/lib/admin";
import { db } from "@/lib/server";

/** GET /admin/privacy/export/[id]. Administrators past two-factor only. Audited by exportPatientData. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || !user.mfaVerified) return new Response("Unauthorized", { status: 401 });
  if (!can(user, "privacy:manage")) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    const data = await exportPatientData(db(), id, await actorOf(user));
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="personal-data-${id.slice(0, 8)}.json"`, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
