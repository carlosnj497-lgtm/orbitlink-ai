import type { Metadata } from "next";
import { Suspense } from "react";
import { cloudEnabled } from "@/lib/server/cloud";
import { CloudLoginForm } from "./cloud-login-form";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <Suspense>
      {cloudEnabled() ? <CloudLoginForm /> : <LoginForm />}
    </Suspense>
  );
}
