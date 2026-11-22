import type { Action } from "@rmc/auth";
import Link from "next/link";
import type { ReactNode } from "react";
import { can, requireVerified } from "@/lib/admin";
import { logoutAction } from "../auth-actions";

const NAV: { href: string; label: string; needs: Action }[] = [
  { href: "/admin", label: "Dashboard", needs: "dashboard:read" },
  { href: "/admin/appointments", label: "Appointments", needs: "appointments:read" },
  { href: "/admin/walk-in", label: "Walk-in / phone booking", needs: "walkin:create" },
  { href: "/admin/enquiries", label: "Enquiries", needs: "enquiries:read" },
  { href: "/admin/services", label: "Services and prices", needs: "services:write" },
  { href: "/admin/doctors", label: "Doctors and hours", needs: "schedules:write" },
  { href: "/admin/holidays", label: "Closed days", needs: "schedules:write" },
  { href: "/admin/content", label: "Website content", needs: "content:write" },
  { href: "/admin/settings", label: "Settings", needs: "settings:write" },
  { href: "/admin/email", label: "Emails", needs: "settings:write" },
  { href: "/admin/staff", label: "Staff", needs: "staff:write" },
  { href: "/admin/export", label: "Export data", needs: "export:run" },
  { href: "/admin/audit", label: "Audit log", needs: "audit:read" },
];

export default async function Panel({ children }: { children: ReactNode }) {
  const user = await requireVerified();
  // Doctors have no resource on these list items, so check the plain permission with their own doctor id.
  const allowed = NAV.filter((n) => can(user, n.needs, { doctorId: user.doctorId }));
  const own = user.role === "DOCTOR" && user.doctorId;
  return (
    <div className="md:flex">
      <aside className="border-b border-slate-200 bg-white md:min-h-screen md:w-64 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between p-4 md:block">
          <p className="font-bold text-brand-800">Royal Medics admin</p>
          <p className="text-xs text-slate-500">{user.name} · {user.role.toLowerCase()}</p>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {allowed.map((n) => <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium hover:bg-brand-50">{n.label}</Link>)}
          {own && <Link href={`/admin/doctors/${user.doctorId}/schedule`} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium hover:bg-brand-50">My time off</Link>}
          <form action={logoutAction}><button className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100">Sign out</button></form>
        </nav>
      </aside>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
