import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaperPal — Voice Research Companion",
  description: "Upload a PDF, start talking. Your paper responds.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
