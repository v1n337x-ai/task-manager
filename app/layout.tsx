import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Task Manager — VAPT",
    template: "%s — Task Manager",
  },
  description: "Internal VAPT management platform — Akasa Air program.",
  applicationName: "Task Manager",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="font-[Calibri]">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
