import type { Metadata } from "next";
import { Suspense } from "react";
import { cloudEnabled } from "@/lib/server/cloud";
import { ResetPasswordForm } from "./reset-form";
import { LocalResetInfo } from "./local-reset-info";

export const metadata: Metadata = { title: "Redefinir senha" };

/** Destino do link "Esqueci a senha" enviado por e-mail (painel na nuvem). */
export default function ResetPasswordPage() {
  return (
    <Suspense>
      {cloudEnabled() ? <ResetPasswordForm /> : <LocalResetInfo />}
    </Suspense>
  );
}
