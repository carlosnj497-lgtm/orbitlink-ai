"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { catchError, type ErrorInfo } from "next/error";
import { useEffect } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { clearChunkReloadHistory, isChunkLoadError, markAndReload, shouldAutoReload } from "@/lib/chunk-recovery";

function Fallback(_props: unknown, { error }: ErrorInfo) {
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    if (chunk && shouldAutoReload(error)) {
      markAndReload();
    } else if (!chunk) {
      // Erros não relacionados a chunk sobem para o error.tsx do segmento.
      throw error;
    }
  }, [chunk, error]);

  if (!chunk) {
    // Esse ponto nunca é atingido (o erro é relançado), mas satisfaz o tipo.
    throw error;
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <Card className="w-full max-w-md p-6 text-center">
        <TriangleAlert className="mx-auto size-8 text-warn" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">O painel foi atualizado</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Recarregue a página para carregar a nova versão.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button
            variant="primary"
            onClick={() => {
              clearChunkReloadHistory();
              window.location.reload();
            }}
          >
            <RefreshCw /> Recarregar página
          </Button>
        </div>
      </Card>
    </main>
  );
}

export const ViewErrorBoundary = catchError(Fallback);
