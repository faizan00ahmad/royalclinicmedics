import { EXPORT_TYPES, exportCsv, type ExportType } from "@rmc/core";
import { actorOf, can, currentUser } from "@/lib/admin";
import { db } from "@/lib/server";

/** GET /admin/export/[type]. Admin only, past two-factor, audited (AD-14). */
export async function GET(_req: Request, { params }: { params: Promise<{ type: string }> }) {
  const user = await currentUser();
  if (!user || !user.mfaVerified) return new Response("Unauthorized", { status: 401 });
  if (!can(user, "export:run")) return new Response("Forbidden", { status: 403 });

  const { type } = await params;
  if (!EXPORT_TYPES.includes(type as ExportType)) return new Response("Not found", { status: 404 });

  const { csv, filename } = await exportCsv(db(), type as ExportType, await actorOf(user));
  return new Response("﻿" + csv, { // BOM so Excel reads accents correctly
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
