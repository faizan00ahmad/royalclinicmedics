import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Cookie policy" };
export default function Page() { return <LegalPage pageKey="cookies" />; }
