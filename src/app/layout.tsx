import type { Metadata } from "next";
import "./globals.css";
import FaviconAnimator from "@/components/FaviconAnimator";

export const metadata: Metadata = {
  title: "MixFix — Global Energy Grid",
  description: "Track and visualize the global electricity generation mix.",
  icons: {
    icon: "/icon.gif",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <FaviconAnimator />
        {children}
      </body>
    </html>
  );
}
