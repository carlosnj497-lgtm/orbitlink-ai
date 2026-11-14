"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { isChunkLoadError, markAndReload, shouldAutoReload } from "@/lib/chunk-recovery";

/** Texto do erro para o bloco "Detalhes técnicos" (erros de servidor já chegam sem detalhes, só com o digest). */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const digest = (error as Error & { digest?: string }).digest;
  const stack = (error.stack ?? "").split("\n").slice(1, 6).join("\n");
  return [`${error.name}: ${error.message}`, digest ? `digest: ${digest}` : "", stack].filter(Boolean).join("\n");
}

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const chunk = isChunkLoadError(error);
  // Decidido uma única vez na montagem; o efeito só executa a recarga.
  const [reloading] = useState(() => shouldAutoReload(error));

  useEffect(() => {
    if (reloading) markAndReload();
    else if (!chunk) console.error(error);
  }, [error, chunk, reloading]);

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <Card className="w-full max-w-md p-6 text-center">
        <TriangleAlert className="mx-auto size-8 text-warn" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">
          {reloading ? "Atualizando o painel…" : chunk ? "O painel foi atualizado" : "Não foi possível exibir esta tela"}
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          {reloading
            ? "Uma nova versão foi instalada; carregando os arquivos atualizados."
            : chunk
              ? "Recarregue a página para carregar a nova versão."
              : "Ocorreu um erro inesperado no navegador. Tente novamente; se persistir, recarregue a página."}
        </p>
        {!reloading && (
          <div className="mt-5 flex justify-center gap-2">
            {!chunk && <Button onClick={() => retry()}>Tentar novamente</Button>}
            <Button variant="primary" onClick={() => window.location.reload()}>
              <RefreshCw /> Recarregar página
            </Button>
          </div>
        )}
        {!reloading && !chunk && (
          <details className="mt-5 text-left text-xs text-fg-subtle">
            <summary className="cursor-pointer select-none">Detalhes técnicos</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg p-2 font-mono text-[11px] text-fg-muted">
              {describeError(error)}
            </pre>
          </details>
        )}
      </Card>
    </main>
  );
}
