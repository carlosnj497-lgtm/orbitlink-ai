import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cloudEnabled } from "@/lib/server/cloud";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "Criar senha nova" };

/** Destino do link "Esqueci a senha" enviado por e-mail (painel na nuvem). */
export default function ResetPasswordPage() {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 py-10">
      <div aria-hidden className="fixed inset-0 -z-10 bg-black bg-cover bg-center" style={{ backgroundImage: "url(/login-bg.webp)" }} />
      <div aria-hidden className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.55),rgb(0_0_0/0.2)_75%)]" />
      <Suspense>
        {cloudEnabled() ? (
          <ResetPasswordForm />
        ) : (
          <p className="max-w-sm text-center text-sm text-fg-muted">
            No painel local a senha é trocada em Configurações → Conta, ou no servidor com <span className="font-mono">astryonctl</span>.{" "}
            <Link href="/login" className="text-accent hover:underline">Voltar para o login</Link>
          </p>
        )}
      </Suspense>
    </main>
  );
}
