import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms and conditions" };
export default function Page() { return <LegalPage pageKey="terms" />; }
