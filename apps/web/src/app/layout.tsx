import type { ReactNode } from "react";

export const metadata = {
  title: "Royal Medics Clinic",
  description: "GP clinic in Dublin. Book an appointment online.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IE">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
