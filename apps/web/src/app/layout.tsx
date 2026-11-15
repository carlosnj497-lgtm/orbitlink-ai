import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa";
import { Providers } from "./providers";

// Baixadas no build e servidas pelo próprio painel (nenhuma requisição ao Google em tempo de execução).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap", weight: ["400", "500", "600", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "ASTRYON", template: "%s · ASTRYON" },
  description: "Monitoramento local, diagnóstico e telemetria da Starlink Mini. Projeto independente, sem afiliação com a Starlink/SpaceX.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "ASTRYON", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#05080f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`dark ${inter.variable} ${grotesk.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
