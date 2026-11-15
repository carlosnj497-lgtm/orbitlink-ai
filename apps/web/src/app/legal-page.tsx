import Link from "next/link";
import type { ReactNode } from "react";

/** Moldura simples das páginas públicas de termos e privacidade. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-sm leading-relaxed text-fg-muted [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-fg [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
      <Link href="/login" className="text-xs text-accent hover:underline">← Voltar</Link>
      <h1 className="mt-4 text-2xl font-semibold text-fg">{title}</h1>
      <p className="text-xs text-fg-subtle">Atualizado em {updated}</p>
      {children}
    </main>
  );
}
