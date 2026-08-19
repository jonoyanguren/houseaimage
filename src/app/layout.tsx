import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * The interface face.
 *
 * A grotesque with authority rather than a neutral one. The previous face was
 * competent and anonymous — the default of half the software on the internet —
 * and this design asks the type to carry the register on its own now that
 * there is no serif to lean on.
 *
 * The variable axis matters: the same family sets a 10px engraved label and a
 * 60px headline, and the contrast between those two is the design.
 */
const archivo = Archivo({
  variable: "--font-archivo",
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
 * Apply the saved theme before the browser paints.
 *
 * Dark is the default and needs no attribute, so this only ever *adds* the
 * light opt-in. Run from a `useEffect` it would show a black flash to the
 * handful of people who chose light; run inline during parsing, it is
 * invisible. See the Next guide on preventing flash before hydration.
 */
const THEME_SCRIPT = `
try {
  if (localStorage.getItem("hai-theme") === "light") {
    document.documentElement.dataset.theme = "light";
  }
} catch {}
`;

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

/** Black, because the product is black. Light is an opt-in, not a peer default. */
export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      // The inline script sets `data-theme` before React arrives, which is a
      // mismatch by construction and an intentional one.
      suppressHydrationWarning
      className={`${archivo.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-canvas font-sans text-body text-ink">
        {children}
      </body>
    </html>
  );
}
