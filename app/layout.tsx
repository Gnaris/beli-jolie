import type { Metadata } from "next";
import { Poppins, Roboto } from "next/font/google";
import SessionProvider from "@/components/providers/SessionProvider";
import "./globals.css";

/* ─────────────────────────────────────────────
   Fonts Google
   - Poppins : titres modernes et élégants
   - Roboto  : corps de texte lisible et neutre
───────────────────────────────────────────── */
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "700"],
});

/* ─────────────────────────────────────────────
   Métadonnées SEO globales
───────────────────────────────────────────── */
export const metadata: Metadata = {
  title: {
    default: "Beli & Jolie — Bijoux Acier Inoxydable BtoB",
    template: "%s | Beli & Jolie",
  },
  description:
    "Beli & Jolie, grossiste BtoB en bijoux acier inoxydable. Collections tendance pour revendeurs, boutiques et créateurs. Qualité premium, tarifs professionnels.",
  keywords: [
    "bijoux acier inoxydable",
    "grossiste bijoux",
    "BtoB bijoux",
    "revendeur bijoux",
    "colliers acier",
    "bracelets acier",
    "bagues inoxydable",
  ],
  authors: [{ name: "Beli & Jolie" }],
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "Beli & Jolie",
    title: "Beli & Jolie — Bijoux Acier Inoxydable BtoB",
    description:
      "Grossiste BtoB spécialisé dans les bijoux en acier inoxydable. Collections élégantes pour professionnels.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Beli & Jolie — Bijoux BtoB",
    description: "Collections de bijoux acier inoxydable pour professionnels.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${poppins.variable} ${roboto.variable}`}>
      <body className="antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
