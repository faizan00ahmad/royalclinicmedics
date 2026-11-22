import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Cancellation policy" };
export default function Page() { return <LegalPage pageKey="cancellation" />; }
