import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DScott OS", template: "%s · DScott OS" },
  description: "Devon Scott's operating system: Collective AI, basketball, family and everything else.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#050a18" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
