import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MixFix — Global Energy Grid",
  description: "Track and visualize the global electricity generation mix.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
