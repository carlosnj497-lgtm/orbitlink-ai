"use client";

import { useEffect } from "react";
import { isChunkLoadError, reloadOnChunkError } from "@/lib/chunk-recovery";

/** Último recurso (erro no layout raiz). Não recebe o CSS global, por isso usa estilos inline. */
export default function GlobalError({ error }: { error: unknown; retry: () => void }) {
  const chunk = isChunkLoadError(error);
  useEffect(() => {
    reloadOnChunkError(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#000000", color: "#ffffff", fontFamily: "system-ui, sans-serif" }}>
        <title>ASTRYON</title>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>{chunk ? "O painel foi atualizado" : "Não foi possível carregar o painel"}</h1>
          <p style={{ fontSize: 14, color: "#a7a9ac", margin: "0 0 20px" }}>
            {chunk ? "Carregando a nova versão…" : "Ocorreu um erro inesperado. Recarregue a página para tentar novamente."}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ background: "#005288", color: "#fff", border: 0, borderRadius: 8, padding: "8px 16px", fontWeight: 600, cursor: "pointer" }}
          >
            Recarregar página
          </button>
        </div>
      </body>
    </html>
  );
}
