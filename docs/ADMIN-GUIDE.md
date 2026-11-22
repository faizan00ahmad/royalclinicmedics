# Admin guide (reception and doctors)

Open `https://www.royalclinicmedics.ie/admin`. You will only see the menu items your role allows.

## Signing in

1. Email and password.
2. The six digit code from your authenticator app (Google Authenticator, Microsoft Authenticator, Authy or 1Password).
   The very first time you will see a QR code to scan: do it once on your phone.
3. You are signed out after **30 minutes without activity**, so lock the screen when you leave the desk.

Five wrong passwords or codes lock your account for 15 minutes. Lost your phone? Ask another administrator to reset your two-factor.

| Role | Can do |
|---|---|
| Administrator | Everything, including settings, prices, staff, refunds, exports, privacy requests |
| Receptionist | Appointments, walk-in bookings, enquiries, doctors' hours and closed days, website text, mark payments received |
| Doctor | Their own appointments (including the health answers), their own time off |

## A normal day

**Dashboard.** Today's appointments in time order, with status and payment. Counts of today, this week, new bookings
in the last 24 hours, bookings still to be paid at the clinic, and new enquiries.

**When a patient arrives.** Appointments > open the booking > **Check in**. After the visit: **Mark completed**.
If they did not come: **No-show** (only for confirmed bookings).

**Patient pays at the clinic.** On the booking: choose Card terminal, Cash or Other > **Mark as paid**. This creates a receipt number.

**Walk-in or phone booking.** Walk-in / phone booking > pick service, doctor and time > patient details > Book. It uses the
same rules as online booking, so the same time can never be booked twice. If the time is outside the doctor's normal hours
you will see a warning (it is still allowed). An email address is optional; if you give one the patient gets the confirmation.

**Search.** Appointments > the search box finds a name, phone number, email or booking reference.

**Move or cancel a booking.** On the booking page. Moving needs a time that is free. **Cancelling by the clinic always refunds
an online payment in full**, and emails the patient. Patients cannot change a booking inside the free-change window
(24 hours by default): that is when they phone you, and you do it here.

**Health answers.** The booking page shows "Show answers". Opening them is recorded (who and when). They are never sent by
email and never appear in exports.

## Weekly and occasional jobs

**Prices and services** (administrators). Services and prices > Edit. Changes are live on the website at once. "Shown on the
website and bookable" off hides a service without deleting it. "Gap after" is clean-up time that is not offered to the next patient.

**Hours and time off.** Doctors and hours > a doctor > Weekly hours (up to three ranges a day). Block time off for a
meeting or holiday (from, until). "One-off changes" closes a single day for that doctor or adds extra hours.
**Closed days** closes the whole clinic. Irish public holidays are already in. If a bank holiday falls at a weekend the
substitute Monday is **not** added automatically: add it.

**Website text.** Website content: the banner across the top (for example holiday opening), FAQs, and the four legal pages.
Each legal page edit creates a new version; patients accept the version live when they book.

**Emails.** Emails: change the wording of any automatic email. Only the listed placeholders work. "Send test" sends it to you.

**Enquiries.** Messages from the Contact page also arrive in the clinic inbox. Reply from your normal email, then mark it
Replied here.

**Staff** (administrators). Add people, choose their role, give them a starting password in person. Link a doctor's login to
their doctor profile (Doctors > Edit > Staff login) so they see only their own appointments.

**Export** (administrators). Patients, appointments, payments, enquiries, consents as CSV. These files contain personal
information: store them securely and delete them when finished. Every download is recorded.

**Privacy requests** (administrators). When someone asks what the clinic holds about them, or asks to be erased: search them,
download their data, or anonymise them (type ANONYMISE to confirm). See RUNBOOK section 11.

## Things the system will not do

- It does not keep medical records, write certificates or referrals, or run video consultations (planned for Phase 2).
- It does not connect to Socrates Cloud. Treat the dashboard as the booking and payment record, not the medical record.
- Please do not type clinical details in staff notes or the contact form replies.

## If something looks wrong

Note the time, what you did and the booking reference, then tell the person who looks after the site. Do not try to fix a
double charge or a missing booking by creating a second booking: ask first.
