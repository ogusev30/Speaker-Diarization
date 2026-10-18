import { Archivo } from "next/font/google";
import "./globals.css";

// Font build sırasında indirilip siteyle birlikte sunulur (COEP altında Google'dan yüklenemezdi)
const archivo = Archivo({ subsets: ["latin", "latin-ext"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata = {
  title: "Sıra Kimde?",
  description: "Konuş, seni tanıyayım. Cem, Elif, Onur ve Zehra'nın sesini tarayıcıda tanıyan uygulama.",
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0E7A47" };

export default function RootLayout({ children }) {
  return (
    <html lang="tr" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
