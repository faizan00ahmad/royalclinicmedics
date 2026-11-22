"use server";

import { AuthError, createStaffUser, resetTwoFactor, setStaffActive, type SessionUser } from "@rmc/auth";
import {
  resetTemplate, saveTemplate, sendTestEmail, audit, addHoliday, addOverride, addTimeBlock, cancelWithRefund, createStaffBooking, deleteFaq, dublinToUtc, markPaidAtClinic,
  publishLegalPage, refundAppointment, removeHoliday, removeOverride, removeTimeBlock, rescheduleAppointment, saveAnnouncement,
  saveDoctor, saveFaq, saveService, saveSettings, saveWeeklyHours, setAppointmentStatus, setStaffNote, updateEnquiry, EDITABLE_SETTINGS,
  BookingError,
} from "@rmc/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOf, bool, can, cents, go, int, opt, requestIp, requireCan, requireVerified, str } from "@/lib/admin";
import { sendEmailsSoon } from "@/lib/mail";
import { db, emailTransport, lazyGateway } from "@/lib/server";

/** datetime-local gives "2026-11-24T09:00" in Irish time. */
const irishTime = (v: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw new BookingError("POLICY", "Choose a date and time.");
  return dublinToUtc(v.replace("T", " "));
};

// ---------------------------------------------------------------- appointments

export async function statusAction(form: FormData) {
  const id = str(form, "id");
  await go(`/admin/appointments/${id}`, async () => {
    const user = await requireCan("appointments:write");
    const to = str(form, "to");
    if (!["CHECKED_IN", "COMPLETED", "NO_SHOW"].includes(to)) throw new BookingError("POLICY", "Unknown status.");
    await setAppointmentStatus(db(), { id, to: to as "CHECKED_IN", actor: await actorOf(user) });
    return "Status updated.";
  });
}

export async function cancelAction(form: FormData) {
  const id = str(form, "id");
  await go(`/admin/appointments/${id}`, async () => {
    const user = await requireCan("appointments:write");
    // BK-33: a cancellation by the clinic always refunds in full.
    const r = await cancelWithRefund(db(), lazyGateway(), { appointmentId: id, by: "CLINIC", reason: opt(form, "reason") ?? "Cancelled by clinic" });
    await audit(db(), { actorUserId: user.id, actorRole: user.role, action: "appointment.cancel", entityType: "appointment", entityId: id, ip: await requestIp(), changes: { refundedCents: r.refundedCents } });
    revalidatePath("/admin/appointments");
    sendEmailsSoon();
    return r.refundedCents ? `Cancelled and refunded €${(r.refundedCents / 100).toFixed(2)}.` : "Cancelled.";
  });
}

export async function rescheduleAction(form: FormData) {
  const id = str(form, "id");
  await go(`/admin/appointments/${id}`, async () => {
    const user = await requireCan("appointments:write");
    await rescheduleAppointment(db(), { appointmentId: id, newStartAt: irishTime(str(form, "when")), by: "CLINIC" });
    await audit(db(), { actorUserId: user.id, actorRole: user.role, action: "appointment.reschedule", entityType: "appointment", entityId: id, ip: await requestIp() });
    sendEmailsSoon();
    return "Appointment moved. The patient has been emailed.";
  });
}

export async function markPaidAction(form: FormData) {
  const id = str(form, "id");
  await go(`/admin/appointments/${id}`, async () => {
    const user = await requireCan("payments:markPaid");
    const method = str(form, "method");
    if (!["CASH", "TERMINAL", "OTHER"].includes(method)) throw new BookingError("POLICY", "Choose how it was paid.");
    await markPaidAtClinic(db(), { appointmentId: id, method: method as "CASH", userId: user.id });
    await audit(db(), { actorUserId: user.id, actorRole: user.role, action: "payment.mark_paid", entityType: "appointment", entityId: id, ip: await requestIp(), changes: { method } });
    return "Marked as paid.";
  });
}

export async function refundAction(form: FormData) {
  const id = str(form, "id");
  await go(`/admin/appointments/${id}`, async () => {
    const user = await requireCan("payments:refund");
    const amount = str(form, "amount") ? cents(form, "amount") : undefined;
    const r = await refundAppointment(db(), lazyGateway(), { appointmentId: id, amountCents: amount, reason: str(form, "reason") || "Refund by staff", createdBy: user.id });
    await audit(db(), { actorUserId: user.id, actorRole: user.role, action: "payment.refund", entityType: "appointment", entityId: id, ip: await requestIp(), changes: { refundedCents: r.refundedCents } });
    return r.refundedCents ? `Refunded €${(r.refundedCents / 100).toFixed(2)}.` : "Nothing left to refund.";
  });
}

export async function noteAction(form: FormData) {
  const id = str(form, "id");
  await go(`/admin/appointments/${id}`, async () => {
    const user = await requireCan("appointments:write");
    await setStaffNote(db(), { id, note: str(form, "note"), actor: await actorOf(user) });
    return "Note saved. (Notes are not medical records. Do not put clinical details here.)";
  });
}

export async function walkInAction(form: FormData) {
  await go("/admin/walk-in", async () => {
    const user = await requireCan("walkin:create");
    const r = await createStaffBooking(db(), {
      serviceId: str(form, "serviceId"), doctorId: str(form, "doctorId"), startAt: irishTime(str(form, "when")),
      source: str(form, "source") as "WALK_IN", paymentChoice: str(form, "paymentChoice") as "AT_CLINIC", checkIn: bool(form, "checkIn"),
      reason: opt(form, "reason"),
      patient: {
        firstName: str(form, "firstName"), lastName: str(form, "lastName"), dob: str(form, "dob"), email: str(form, "email"),
        phone: str(form, "phone"), medicalCard: bool(form, "medicalCard"),
      },
      actor: await actorOf(user),
    });
    revalidatePath("/admin");
    sendEmailsSoon();
    return {
      to: `/admin/appointments/${r.appointment.id}`,
      message: r.outsideNormalHours ? "Booked. Note: this time is outside the doctor's normal hours." : "Booked.",
    };
  });
}

// ------------------------------------------------------------------- services

export async function saveServiceAction(form: FormData) {
  await go("/admin/services", async () => {
    const user = await requireCan("services:write");
    await saveService(db(), {
      id: opt(form, "id"), name: str(form, "name"), slug: opt(form, "slug"), category: str(form, "category") || "General",
      shortDescription: opt(form, "shortDescription"), description: opt(form, "description"),
      priceCents: cents(form, "price"), durationMin: int(form, "durationMin", 15), bufferMin: int(form, "bufferMin"),
      payAtClinicAllowed: bool(form, "payAtClinicAllowed"), gmsEligible: bool(form, "gmsEligible"),
      minNoticeOverrideMin: str(form, "minNoticeOverrideMin") ? int(form, "minNoticeOverrideMin") : null,
      featured: bool(form, "featured"), active: bool(form, "active"), sortOrder: int(form, "sortOrder"),
      seoTitle: opt(form, "seoTitle"), seoDescription: opt(form, "seoDescription"),
      doctorIds: form.getAll("doctorIds").map(String),
    }, await actorOf(user));
    revalidatePath("/", "layout");
    return "Service saved. It is live on the website now.";
  });
}

// -------------------------------------------------------------------- doctors

export async function saveDoctorAction(form: FormData) {
  await go("/admin/doctors", async () => {
    const user = await requireCan("doctors:write");
    await saveDoctor(db(), {
      id: opt(form, "id"), displayName: str(form, "displayName"), title: opt(form, "title"), bio: opt(form, "bio"),
      qualifications: opt(form, "qualifications"), imcNumber: opt(form, "imcNumber"),
      languages: str(form, "languages").split(",").map((l) => l.trim()).filter(Boolean),
      isActive: bool(form, "isActive"), sortOrder: int(form, "sortOrder"), userId: opt(form, "userId") ?? null,
    }, await actorOf(user));
    revalidatePath("/", "layout");
    return "Doctor saved.";
  });
}

/** Allowed for staff who manage schedules, or for a doctor changing their own. */
async function scheduleUser(doctorId: string): Promise<SessionUser> {
  const user = await requireVerified();
  if (can(user, "schedules:write") || can(user, "schedules:writeOwn", { doctorId })) return user;
  redirect("/admin?error=" + encodeURIComponent("You do not have permission to do that."));
}

export async function weeklyHoursAction(form: FormData) {
  const doctorId = str(form, "doctorId");
  await go(`/admin/doctors/${doctorId}/schedule`, async () => {
    const user = await requireCan("schedules:write");
    const rules: { weekday: number; startTime: string; endTime: string }[] = [];
    for (let day = 0; day < 7; day++) {
      for (let n = 1; n <= 3; n++) {
        const s = str(form, `d${day}_s${n}`), e = str(form, `d${day}_e${n}`);
        if (s && e) rules.push({ weekday: day, startTime: s, endTime: e });
        else if (s || e) throw new BookingError("POLICY", "Each time range needs both a start and an end.");
      }
    }
    await saveWeeklyHours(db(), doctorId, rules, await actorOf(user));
    return "Weekly hours saved. Patients see the new times immediately.";
  });
}

export async function overrideAction(form: FormData) {
  const doctorId = str(form, "doctorId");
  await go(`/admin/doctors/${doctorId}/schedule`, async () => {
    const user = await scheduleUser(doctorId);
    const closed = str(form, "kind") === "closed";
    await addOverride(db(), { doctorId, date: str(form, "date"), isClosed: closed, startTime: opt(form, "startTime"), endTime: opt(form, "endTime"), note: opt(form, "note") }, await actorOf(user));
    return closed ? "Day marked closed for this doctor." : "Extra hours added.";
  });
}

export async function removeOverrideAction(form: FormData) {
  const doctorId = str(form, "doctorId");
  await go(`/admin/doctors/${doctorId}/schedule`, async () => {
    const user = await scheduleUser(doctorId);
    await removeOverride(db(), str(form, "id"), await actorOf(user));
    return "Removed.";
  });
}

export async function blockAction(form: FormData) {
  const doctorId = str(form, "doctorId");
  await go(`/admin/doctors/${doctorId}/schedule`, async () => {
    const user = await scheduleUser(doctorId);
    await addTimeBlock(db(), { doctorId, startAt: irishTime(str(form, "startAt")), endAt: irishTime(str(form, "endAt")), reason: opt(form, "reason") }, await actorOf(user));
    return "Time blocked. Patients can no longer book it.";
  });
}

export async function removeBlockAction(form: FormData) {
  const doctorId = str(form, "doctorId");
  await go(`/admin/doctors/${doctorId}/schedule`, async () => {
    const user = await scheduleUser(doctorId);
    await removeTimeBlock(db(), str(form, "id"), await actorOf(user));
    return "Removed.";
  });
}

export async function holidayAction(form: FormData) {
  await go("/admin/holidays", async () => {
    const user = await requireCan("schedules:write");
    await addHoliday(db(), { date: str(form, "date"), name: str(form, "name") || "Clinic closed" }, await actorOf(user));
    return "Closed day added for the whole clinic.";
  });
}

export async function removeHolidayAction(form: FormData) {
  await go("/admin/holidays", async () => {
    const user = await requireCan("schedules:write");
    await removeHoliday(db(), str(form, "id"), await actorOf(user));
    return "Removed. The clinic is open that day again.";
  });
}

// ------------------------------------------------------------------- settings

export async function settingsAction(form: FormData) {
  await go("/admin/settings", async () => {
    const user = await requireCan("settings:write");
    const values: Record<string, string | number | boolean> = {};
    for (const [key, def] of Object.entries(EDITABLE_SETTINGS)) {
      values[key] = def.kind === "boolean" ? bool(form, key) : str(form, key);
    }
    await saveSettings(db(), values, await actorOf(user));
    revalidatePath("/", "layout");
    return "Settings saved.";
  });
}

// -------------------------------------------------------------------- content

export async function faqAction(form: FormData) {
  await go("/admin/content", async () => {
    const user = await requireCan("content:write");
    await saveFaq(db(), { id: opt(form, "id"), category: str(form, "category") || "General", question: str(form, "question"), answer: str(form, "answer"), sortOrder: int(form, "sortOrder"), active: bool(form, "active") }, await actorOf(user));
    revalidatePath("/faqs");
    return "FAQ saved.";
  });
}

export async function deleteFaqAction(form: FormData) {
  await go("/admin/content", async () => {
    const user = await requireCan("content:write");
    await deleteFaq(db(), str(form, "id"), await actorOf(user));
    revalidatePath("/faqs");
    return "FAQ deleted.";
  });
}

export async function announcementAction(form: FormData) {
  await go("/admin/content", async () => {
    const user = await requireCan("content:write");
    await saveAnnouncement(db(), { text: str(form, "text"), active: bool(form, "active") }, await actorOf(user));
    revalidatePath("/", "layout");
    return "Banner saved.";
  });
}

export async function legalAction(form: FormData) {
  await go("/admin/content", async () => {
    const user = await requireCan("content:write");
    const v = await publishLegalPage(db(), { key: str(form, "key"), text: str(form, "text") }, await actorOf(user));
    return `Published as version ${v}. Patients who book from now on accept this version.`;
  });
}

// ------------------------------------------------------------------ enquiries

export async function enquiryAction(form: FormData) {
  await go("/admin/enquiries", async () => {
    const user = await requireCan("enquiries:write");
    const status = str(form, "status");
    if (!["NEW", "REPLIED", "CLOSED"].includes(status)) throw new BookingError("POLICY", "Unknown status.");
    await updateEnquiry(db(), { id: str(form, "id"), status: status as "NEW", notes: opt(form, "notes") }, await actorOf(user));
    return "Updated.";
  });
}

// ---------------------------------------------------------------------- staff

export async function createStaffAction(form: FormData) {
  await go("/admin/staff", async () => {
    const user = await requireCan("staff:write");
    const role = str(form, "role");
    if (!["ADMIN", "RECEPTIONIST", "DOCTOR"].includes(role)) throw new AuthError("Choose a role.");
    await createStaffUser(db(), { email: str(form, "email"), name: str(form, "name"), role: role as "ADMIN", password: String(form.get("password") ?? ""), createdBy: user.id });
    return "Staff account created. Give them the password in person; they will set up two-factor at first sign-in.";
  });
}

export async function resetTwoFactorAction(form: FormData) {
  await go("/admin/staff", async () => {
    const user = await requireCan("staff:write");
    await resetTwoFactor(db(), str(form, "id"), user.id);
    return "Two-factor reset. They set it up again at next sign-in.";
  });
}

export async function toggleStaffAction(form: FormData) {
  await go("/admin/staff", async () => {
    const user = await requireCan("staff:write");
    const id = str(form, "id");
    if (id === user.id) throw new AuthError("You cannot deactivate your own account.");
    await setStaffActive(db(), id, bool(form, "active"), user.id);
    return bool(form, "active") ? "Account activated." : "Account deactivated and signed out.";
  });
}


// --------------------------------------------------------------------- emails

export async function saveTemplateAction(form: FormData) {
  await go("/admin/email", async () => {
    const user = await requireCan("settings:write");
    await saveTemplate(db(), { id: str(form, "id"), subject: str(form, "subject"), body: String(form.get("body") ?? "") }, await actorOf(user));
    return "Saved. New emails use this wording.";
  });
}

export async function resetTemplateAction(form: FormData) {
  await go("/admin/email", async () => {
    const user = await requireCan("settings:write");
    await resetTemplate(db(), str(form, "id"), await actorOf(user));
    return "Back to the standard wording.";
  });
}

export async function testEmailAction(form: FormData) {
  await go("/admin/email", async () => {
    const user = await requireCan("settings:write");
    await sendTestEmail(db(), emailTransport(), { id: str(form, "id"), to: str(form, "to") }, await actorOf(user));
    return `Test email sent to ${str(form, "to")}.`;
  });
}
