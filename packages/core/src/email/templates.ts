/**
 * N-01 .. N-09. Default wording. Staff can edit subject and body in admin (AD-12); edits are stored in
 * ops.settings under `email.template.<id>`. Variables are written {{like_this}}.
 *
 * RULE (SEC-07): emails never contain health information. The only variables available are the ones listed
 * in VARIABLES below, and none of them can carry the questionnaire or the reason for the visit.
 */
export type TemplateId =
  | "booking_confirmation" | "clinic_alert" | "reminder" | "booking_rescheduled" | "booking_cancelled"
  | "refund_issued" | "booking_not_completed" | "contact_received" | "contact_autoreply";

export interface TemplateDef {
  label: string;
  audience: "patient" | "clinic";
  subject: string;
  body: string;
  variables: string[];
}

export const VARIABLES: Record<string, string> = {
  firstName: "Patient's first name",
  service: "Service name",
  doctor: "Doctor's name",
  date: "Date, for example Mon 24 Nov 2026",
  time: "Time, for example 10:30",
  ref: "Booking reference",
  manageLink: "Link to change or cancel",
  calendarLink: "Link to add to calendar",
  clinicName: "Clinic name",
  clinicPhone: "Clinic phone",
  clinicAddress: "Clinic address",
  amount: "Price, for example €60.00",
  paymentNote: "Whether it is paid or to be paid at the clinic",
  cancellationHours: "Free change window in hours",
  reminderLead: "How soon, for example tomorrow",
  refundNote: "Refund details, if any",
  reasonText: "Why the booking did not go ahead",
  eventLabel: "New booking, Booking cancelled or Booking moved",
  patientName: "Patient's full name (clinic emails only)",
  adminLink: "Link to the booking in admin (clinic emails only)",
  source: "How it was booked",
  senderName: "Name of the person who wrote to the clinic",
  senderEmail: "Their email (clinic emails only)",
  senderPhone: "Their phone (clinic emails only)",
  message: "Their message (clinic emails only)",
};

export const DEFAULT_TEMPLATES: Record<TemplateId, TemplateDef> = {
  booking_confirmation: {
    label: "Booking confirmation", audience: "patient",
    subject: "Your appointment at {{clinicName}} is confirmed ({{ref}})",
    body: `Hello {{firstName}},

Your appointment is confirmed.

{{service}} with {{doctor}}
{{date}} at {{time}} (Irish time)
{{clinicAddress}}

Reference: {{ref}}
{{paymentNote}}

Need to change it? You can move or cancel it free of charge up to {{cancellationHours}} hours before:
{{manageLink}}

Add it to your calendar: {{calendarLink}}

Please bring photo ID. If you have any questions, call {{clinicPhone}}.

This service is not for emergencies. In an emergency call 112 or 999.

{{clinicName}}`,
    variables: ["firstName", "service", "doctor", "date", "time", "ref", "manageLink", "calendarLink", "clinicName", "clinicPhone", "clinicAddress", "paymentNote", "cancellationHours"],
  },
  clinic_alert: {
    label: "Alert to the clinic about a booking", audience: "clinic",
    subject: "{{eventLabel}}: {{patientName}}, {{date}} {{time}}",
    body: `{{eventLabel}}

{{patientName}}
{{service}} with {{doctor}}
{{date}} at {{time}}
Booked via: {{source}}
Reference: {{ref}}

Open it in admin: {{adminLink}}`,
    variables: ["eventLabel", "patientName", "service", "doctor", "date", "time", "source", "ref", "adminLink"],
  },
  reminder: {
    label: "Appointment reminder", audience: "patient",
    subject: "Reminder: your appointment {{reminderLead}} at {{clinicName}}",
    body: `Hello {{firstName}},

This is a reminder of your appointment {{reminderLead}}.

{{service}} with {{doctor}}
{{date}} at {{time}} (Irish time)
{{clinicAddress}}

{{paymentNote}}

Need to change it? {{manageLink}}

If you cannot attend, please let us know so someone else can use the time. Call {{clinicPhone}}.

{{clinicName}}`,
    variables: ["firstName", "service", "doctor", "date", "time", "clinicAddress", "paymentNote", "manageLink", "clinicPhone", "clinicName", "reminderLead"],
  },
  booking_rescheduled: {
    label: "Appointment moved", audience: "patient",
    subject: "Your appointment has moved to {{date}} at {{time}}",
    body: `Hello {{firstName}},

Your appointment has been moved.

{{service}} with {{doctor}}
New time: {{date}} at {{time}} (Irish time)
{{clinicAddress}}

Reference: {{ref}}
Manage it: {{manageLink}}
Add to calendar: {{calendarLink}}

If this time does not suit you, please call {{clinicPhone}}.

{{clinicName}}`,
    variables: ["firstName", "service", "doctor", "date", "time", "clinicAddress", "ref", "manageLink", "calendarLink", "clinicPhone", "clinicName"],
  },
  booking_cancelled: {
    label: "Appointment cancelled", audience: "patient",
    subject: "Your appointment on {{date}} has been cancelled",
    body: `Hello {{firstName}},

Your appointment has been cancelled.

{{service}}
{{date}} at {{time}} (Irish time)
Reference: {{ref}}

{{refundNote}}

You can book a new appointment any time at {{manageLink}}
Questions? Call {{clinicPhone}}.

{{clinicName}}`,
    variables: ["firstName", "service", "date", "time", "ref", "refundNote", "manageLink", "clinicPhone", "clinicName"],
  },
  refund_issued: {
    label: "Refund issued", audience: "patient",
    subject: "Your refund from {{clinicName}}",
    body: `Hello {{firstName}},

We have refunded {{amount}} for booking {{ref}}.

Refunds usually reach your card within 5 to 10 working days, depending on your bank.

If you have questions, call {{clinicPhone}}.

{{clinicName}}`,
    variables: ["firstName", "amount", "ref", "clinicPhone", "clinicName"],
  },
  booking_not_completed: {
    label: "Booking did not go ahead", audience: "patient",
    subject: "Your booking with {{clinicName}} did not go ahead",
    body: `Hello {{firstName}},

{{reasonText}}

{{refundNote}}

You can choose a new time here: {{manageLink}}
Or call us on {{clinicPhone}}.

{{clinicName}}`,
    variables: ["firstName", "reasonText", "refundNote", "manageLink", "clinicPhone", "clinicName"],
  },
  contact_received: {
    label: "New message from the Contact page", audience: "clinic",
    subject: "New website enquiry from {{senderName}}",
    body: `A new message arrived through the website.

Name: {{senderName}}
Email: {{senderEmail}}
Phone: {{senderPhone}}

{{message}}

Reply from your own email, then mark it replied here: {{adminLink}}`,
    variables: ["senderName", "senderEmail", "senderPhone", "message", "adminLink"],
  },
  contact_autoreply: {
    label: "Automatic reply to the Contact form", audience: "patient",
    subject: "We received your message",
    body: `Hello {{senderName}},

Thank you for contacting {{clinicName}}. We have your message and will reply as soon as we can.

If you need to speak to someone urgently, please call {{clinicPhone}}. In an emergency call 112 or 999.

{{clinicName}}`,
    variables: ["senderName", "clinicName", "clinicPhone"],
  },
};

export const TEMPLATE_IDS = Object.keys(DEFAULT_TEMPLATES) as TemplateId[];
