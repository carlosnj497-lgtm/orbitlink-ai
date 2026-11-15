import type { Metadata } from "next";
import { ApplianceSetup } from "./setup";

export const metadata: Metadata = { title: "Configurar aparelho" };

export default function AparelhoPage() {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 py-10">
      <div aria-hidden className="fixed inset-0 -z-10 bg-black bg-cover bg-center" style={{ backgroundImage: "url(/login-bg.webp)" }} />
      <div aria-hidden className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.6),rgb(0_0_0/0.25)_75%)]" />
      <ApplianceSetup />
    </main>
  );
}
