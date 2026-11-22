import { listServices } from "@rmc/core";
import type { MetadataRoute } from "next";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed = ["", "/about", "/services", "/prices", "/faqs", "/contact", "/book", "/privacy", "/terms", "/cookies", "/cancellation-policy"];
  const services = await listServices(db());
  return [
    ...fixed.map((p) => ({ url: `${SITE}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.7 })),
    ...services.map((s) => ({ url: `${SITE}/services/${s.slug}`, lastModified: s.updatedAt, priority: 0.8 })),
  ];
}
