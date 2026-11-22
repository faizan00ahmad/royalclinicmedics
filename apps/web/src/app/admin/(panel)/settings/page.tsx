import { EDITABLE_SETTINGS, loadSettingsMap } from "@rmc/core";
import { Card, Flash, Title, btn, input } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";
import { db } from "@/lib/server";
import { settingsAction } from "../../actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireCan("settings:write");
  const current = await loadSettingsMap(db());
  const groups = [...new Set(Object.values(EDITABLE_SETTINGS).map((d) => d.group))];
  return (
    <>
      <Title sub="Clinic details appear across the website. Values still showing [TBD] are placeholders: replace them.">Settings</Title>
      <Flash ok={sp.ok} error={sp.error} />
      <form action={settingsAction} className="space-y-4">
        {groups.map((g) => (
          <Card key={g} title={g}>
            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(EDITABLE_SETTINGS).filter(([, d]) => d.group === g).map(([key, d]) => (
                d.kind === "boolean" ? (
                  <label key={key} className="flex items-start gap-2 text-sm"><input type="checkbox" name={key} defaultChecked={current[key] === true} className="mt-1 size-5" /><span>{d.label}{d.help && <span className="block text-xs text-slate-500">{d.help}</span>}</span></label>
                ) : (
                  <label key={key} className="block text-sm font-medium">{d.label}
                    <input name={key} type={d.kind === "number" ? "number" : "text"} min={d.min} max={d.max} defaultValue={String(current[key] ?? "")} className={input} />
                  </label>
                )
              ))}
            </div>
          </Card>
        ))}
        <button className={btn}>Save settings</button>
      </form>
    </>
  );
}
