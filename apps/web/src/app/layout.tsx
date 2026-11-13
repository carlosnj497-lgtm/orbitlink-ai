import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "OrbitLink AI", template: "%s · OrbitLink AI" },
  description: "Monitoramento local, diagnóstico e telemetria da Starlink Mini. Projeto independente, sem afiliação com a Starlink/SpaceX.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#060a12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
