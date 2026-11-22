import type { Metadata } from "next";
import { ManageBooking } from "@/components/ManageBooking";

// Private page: keep it out of search results and never leak the link in a Referer header.
export const metadata: Metadata = { title: "Your appointment", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ManagePage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { ref } = await params;
  const { paid } = await searchParams;
  return <ManageBooking bookingRef={ref} paid={paid === "1"} />;
}
