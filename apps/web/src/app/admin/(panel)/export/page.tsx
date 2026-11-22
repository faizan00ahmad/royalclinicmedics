import { Card, Title, btn } from "@/components/admin/ui";
import { requireCan } from "@/lib/admin";

const ITEMS = [
  ["patients", "Patients", "Names, dates of birth, contact details, medical card, marketing choice."],
  ["appointments", "Appointments", "Every booking with status and payment status. No health answers."],
  ["payments", "Payments", "Payments and receipt numbers."],
  ["enquiries", "Enquiries", "Messages from the Contact page."],
  ["consents", "Consents", "Which policy version each patient accepted, and when."],
] as const;

export default async function ExportPage() {
  await requireCan("export:run");
  return (
    <>
      <Title sub="Your data is yours. Files contain personal information: keep them secure and delete them when finished. Every download is recorded in the audit log.">Export data</Title>
      <div className="grid gap-4 md:grid-cols-2">
        {ITEMS.map(([key, title, text]) => (
          <Card key={key} title={title}>
            <p className="text-sm text-slate-600">{text}</p>
            {/* Plain link, never prefetched: opening it downloads and audits */}
            <a href={`/admin/export/${key}`} className={`${btn} mt-3`}>Download CSV</a>
          </Card>
        ))}
      </div>
    </>
  );
}
