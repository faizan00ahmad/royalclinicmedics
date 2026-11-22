import { listServices, loadBookingSettings } from "@rmc/core";
import type { Metadata } from "next";
import { BookingWizard } from "@/components/BookingWizard";
import { db } from "@/lib/server";
import { clean, hasPhone, loadChrome, telHref } from "@/lib/site";

export const metadata: Metadata = { title: "Book an appointment", description: "Choose a service, pick a free time and book online." };

export default async function BookPage({ searchParams }: { searchParams: Promise<{ service?: string }> }) {
  const { service } = await searchParams;
  const { clinic } = await loadChrome();
  const [services, settings] = await Promise.all([listServices(db()), loadBookingSettings(db())]);
  return (
    <BookingWizard
      services={services.map((s) => ({
        id: s.id, slug: s.slug, name: s.name, shortDescription: s.shortDescription,
        priceCents: s.priceCents, durationMin: s.durationMin, payAtClinicAllowed: s.payAtClinicAllowed,
      }))}
      initialSlug={service}
      stripeKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
      windowDays={settings.bookingWindowDays}
      phone={hasPhone(clinic) ? clean(clinic.phone) : ""}
      phoneHref={hasPhone(clinic) ? telHref(clinic.phone) : "/contact"}
      cancellationHours={settings.cancellationWindowHours}
    />
  );
}
