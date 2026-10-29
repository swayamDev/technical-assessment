import type { Metadata } from "next";
import { Geist_Mono, Outfit, Oxanium } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import "./globals.css";

const oxaniumHeading = Oxanium({
  subsets: ["latin"],
  variable: "--font-heading",
});
const outfit = Outfit({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Rent Collection",
  description: "Leases, invoices and payments for Malaysian property managers",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-MY"
      className={cn(
        "h-full antialiased",
        outfit.variable,
        oxaniumHeading.variable,
        geistMono.variable,
      )}
    >
      <body className="bg-muted/30 flex min-h-full flex-col font-sans">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
