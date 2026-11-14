import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 py-10">
      {/* Fundo: estação terrena, Terra à noite e satélite (imagem enviada pelo dono). Fixo, cobrindo a tela;
          o véu escuro no centro garante contraste do cartão em qualquer tela. */}
      <div aria-hidden className="fixed inset-0 -z-10 bg-black bg-cover bg-center" style={{ backgroundImage: "url(/login-bg.webp)" }} />
      <div aria-hidden className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.55),rgb(0_0_0/0.2)_75%)]" />
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
