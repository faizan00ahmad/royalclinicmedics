import { VARIABLES, formatDublin, listRecentEmails, listTemplates } from "@rmc/core";
import { Card, Flash, Table, Title, btn, btnDanger, btnLight, input, td } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";
import { resetTemplateAction, saveTemplateAction, testEmailAction } from "../../actions";

export default async function EmailPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireCan("settings:write");
  const [templates, recent] = await Promise.all([listTemplates(db()), listRecentEmails(db(), 30)]);
  const transport = process.env.EMAIL_TRANSPORT ?? "resend";

  return (
    <>
      <Title sub="The wording of every automatic email. Placeholders like {{firstName}} are filled in for each patient.">Emails</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <p className="mb-4 rounded-lg bg-slate-100 p-3 text-sm">
        Sending method: <strong>{transport === "console" ? "development preview (emails are saved as files, nothing is really sent)" : "Resend"}</strong>.
        Emails never include health answers, and only the placeholders listed below can be used.
      </p>

      <div className="space-y-4">
        {templates.map((t) => (
          <Card key={t.id} title={<span>{t.label} <span className="ml-2 text-xs font-normal text-slate-500">to the {t.audience}{t.customised ? " · edited" : ""}</span></span>}>
            <form action={saveTemplateAction} className="space-y-2">
              <input type="hidden" name="id" value={t.id} />
              <label className="block text-xs font-medium">Subject<input name="subject" defaultValue={t.subject} required maxLength={200} className={input} /></label>
              <label className="block text-xs font-medium">Message<textarea name="body" defaultValue={t.body} required rows={10} maxLength={5000} className={`${input} font-mono`} /></label>
              <p className="text-xs text-slate-500">Placeholders you can use: {t.variables.map((v) => `{{${v}}}`).join(" ")}</p>
              <div className="flex flex-wrap items-end gap-2">
                <button className={btn}>Save wording</button>
              </div>
            </form>
            <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
              <form action={testEmailAction} className="flex items-end gap-2">
                <input type="hidden" name="id" value={t.id} />
                <label className="text-xs font-medium">Send a test to<input name="to" type="email" defaultValue={user.email} required className={`${input} w-64`} /></label>
                <button className={btnLight}>Send test</button>
              </form>
              {t.customised && <form action={resetTemplateAction}><input type="hidden" name="id" value={t.id} /><button className={btnDanger}>Back to standard wording</button></form>}
            </div>
          </Card>
        ))}
      </div>

      <details className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold">All placeholders</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">{Object.entries(VARIABLES).map(([k, v]) => <div key={k}><dt className="inline font-mono">{`{{${k}}}`}</dt> <dd className="inline text-slate-600">{v}</dd></div>)}</dl>
      </details>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Recent emails</h2>
      <Table head={["Sent", "Type", "To", "Status"]}>
        {recent.map((r) => (
          <tr key={r.id}><td className={td}>{formatDublin(r.sentAt)}</td><td className={`${td} font-mono text-xs`}>{r.type.split(":")[0]}</td><td className={td}>{r.recipient}</td><td className={td}>{r.status.toLowerCase()}</td></tr>
        ))}
      </Table>
    </>
  );
}
