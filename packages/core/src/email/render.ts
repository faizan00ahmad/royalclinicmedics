import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import type { Database } from "../db-types";
import { DEFAULT_TEMPLATES, type TemplateId } from "./templates";

export type Vars = Record<string, string | number | undefined>;

export interface Rendered { subject: string; text: string; html: string }

/** One pass, so a value that itself contains {{ref}} is NOT expanded again. Unknown variables become empty. */
export function fill(template: string, vars: Vars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => String(vars[key] ?? ""));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Plain text to HTML: escape everything first, then turn blank lines into paragraphs and web addresses into links. */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const safe = escapeHtml(block.trim())
        .replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" style="color:#0f766e">${url}</a>`)
        .replace(/\n/g, "<br>");
      return `<p style="margin:0 0 16px;line-height:1.5">${safe}</p>`;
    })
    .join("");
}

function layout(clinicName: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#0f766e;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold">${escapeHtml(clinicName)}</td></tr>
<tr><td style="padding:24px;font-size:15px">${inner}</td></tr>
</table></td></tr></table></body></html>`;
}

export function render(def: { subject: string; body: string }, vars: Vars): Rendered {
  const text = fill(def.body, vars).trim();
  // Header injection guard: a subject is a single line.
  const subject = fill(def.subject, vars).replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  return { subject, text, html: layout(String(vars.clinicName ?? ""), textToHtml(text)) };
}

/** AD-12: edits made in admin live in ops.settings. Falls back to the built-in wording. */
export async function loadTemplate(db: Database, id: TemplateId): Promise<{ subject: string; body: string; customised: boolean }> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, `email.template.${id}`));
  const v = row?.value as { subject?: unknown; body?: unknown } | undefined;
  const def = DEFAULT_TEMPLATES[id];
  if (v && typeof v.subject === "string" && typeof v.body === "string" && v.subject.trim() && v.body.trim()) {
    return { subject: v.subject, body: v.body, customised: true };
  }
  return { subject: def.subject, body: def.body, customised: false };
}
