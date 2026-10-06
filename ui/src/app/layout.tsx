import type { ReactNode } from "react";

import "./globals.css";
import { SiteHeader } from "../components/site-header";
import { StarField } from "../components/star-field";

export const metadata = {
  title: "Polaris — Guided Knowledge Arcana",
  description: "Turn a topic into a navigable knowledge tree.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* Fonts the astral theme is built on (ui/uireference.html). preconnect first so the serif
          headings do not arrive a beat after the layout. */}
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Fira+Code:wght@400;500&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-astral-950 text-slate-200">
        <StarField />
        <div className="relative z-10 flex min-h-screen flex-col">
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">{children}</main>
          <footer className="mt-auto border-t border-astral-gold/20 bg-astral-950 py-6 text-center font-serif text-xs text-slate-500">
            <p>Polaris — Guided Knowledge Arcana. Guided by the Ancient Stars.</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
