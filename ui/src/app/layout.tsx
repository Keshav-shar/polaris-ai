import type { ReactNode } from "react";

import "./globals.css";
import { SiteHeader } from "../components/site-header";

export const metadata = {
  title: "Polaris: learn any topic step by step",
  description: "Type a topic and Polaris builds you a learning map of short lessons, each with a quick check.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* Fonts of the parchment theme (docs/uimockcode.txt). A <link> rather than next/font keeps
          `next build` free of a network fetch; preconnect first so headings do not arrive late. */}
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-parchment text-ink-soft">
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6">{children}</main>
          <footer className="mt-auto border-t border-rule py-8 text-center text-xs text-faint">
            <p>&copy; 2026 Polaris. Learn anything, one branch at a time.</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
