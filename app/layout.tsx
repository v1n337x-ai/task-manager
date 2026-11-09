import type { Metadata } from "next";
import "./globals.css";
import { getBrandingColors, lightTint } from "@/lib/services/branding-service";

export const metadata: Metadata = {
  title: {
    default: "Task Manager — VAPT",
    template: "%s — Task Manager",
  },
  description: "Internal VAPT management platform — Akasa Air program.",
  applicationName: "Task Manager",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const colors = await getBrandingColors().catch(() => ({ primary: "#ff8c42", secondary: "#9b7bb5" }));
  const primaryTint = lightTint(colors.primary);
  const secondaryTint = lightTint(colors.secondary);
  return (
    <html
      lang="en"
      className="font-[Calibri]"
      style={
        {
          "--color-accent": colors.primary,
          "--color-accent-deep": colors.primary,
          "--color-accent-soft": primaryTint,
          "--color-slate": colors.secondary,
          "--color-xlsx-band": secondaryTint,
          "--color-xlsx-green": secondaryTint,
          "--color-xlsx-data": primaryTint,
        } as React.CSSProperties
      }
    >
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
