import type { Metadata, Viewport } from "next";
import { Inter_Tight, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * The interface face.
 *
 * A tight grotesque rather than a neutral one: the register is a professional
 * tool, and a dense face with short extenders lets a panel carry real
 * information without becoming a wall. It sets everything — headings included.
 */
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});

/**
 * Every numeral in the product. Indices, counters, durations, credits.
 *
 * A drafting-table mono rather than a decorative one, and always tabular:
 * these numbers update every couple of seconds for minutes at a time, and
 * digits that change width as they tick read as an unstable instrument.
 */
const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

/**
 * The luxury accent, and nothing else.
 *
 * It used to set every heading, which put the product in the register of a
 * printed brochure. Now it appears once or twice a screen — an italic phrase
 * in a headline — where it reads as deliberate rather than as a theme.
 */
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

/**
 * `metadataBase` resolves the OG image to an absolute URL, which every social
 * and messaging preview requires. Agencies send these links over WhatsApp, so
 * the card is often the first thing anyone sees of the product.
 */
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.APP_URL?.trim() || "http://localhost:3000"
  ),
  title: {
    default: "houseaimage · Estudio de vídeo inmobiliario",
    template: "%s · houseaimage",
  },
  description:
    "Convierte las fotos de un anuncio en un vídeo de presentación del inmueble: un plano con movimiento de cámara por fotografía, montados en un solo recorrido.",
  applicationName: "houseaimage",
  openGraph: {
    type: "website",
    siteName: "houseaimage",
    locale: "es_ES",
    title: "houseaimage · Estudio de vídeo inmobiliario",
    description:
      "Cada fotografía se convierte en un plano con movimiento de cámara. Los planos se montan en un único recorrido.",
  },
  robots: {
    // An operator tool with an access gate has nothing to gain from indexing.
    index: false,
    follow: false,
  },
};

/** Matches the canvas token in both themes, so the browser chrome blends in. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f2ee" },
    { media: "(prefers-color-scheme: dark)", color: "#08080a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${interTight.variable} ${jetBrainsMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas font-sans text-body text-ink">
        {children}
      </body>
    </html>
  );
}
