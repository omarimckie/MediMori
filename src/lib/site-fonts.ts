import localFont from "next/font/local";

/**
 * Site typography is self-hosted so production/Preview builds never depend on
 * live Google Fonts fetches (next/font/google can fail when CSS or file URLs are malformed).
 * Font files: SIL Open Font License 1.1 (Cormorant Garamond, Nunito Sans via Fontsource).
 */
export const nunitoSans = localFont({
  variable: "--font-nunito-sans",
  display: "swap",
  src: [
    {
      path: "../assets/fonts/nunito-sans-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../assets/fonts/nunito-sans-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../assets/fonts/nunito-sans-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../assets/fonts/nunito-sans-latin-800-normal.woff2",
      weight: "800",
      style: "normal",
    },
  ],
});

export const cormorant = localFont({
  variable: "--font-cormorant",
  display: "swap",
  src: [
    {
      path: "../assets/fonts/cormorant-garamond-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../assets/fonts/cormorant-garamond-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../assets/fonts/cormorant-garamond-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
});