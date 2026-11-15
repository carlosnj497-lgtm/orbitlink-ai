"use client";

/*
 * Recuperação de "version skew": depois de recompilar/atualizar o painel, uma aba aberta antes da atualização
 * ainda referencia arquivos JS da versão antiga, que já não existem. Ao navegar para uma tela cujo código
 * mudou, o carregamento falha com ChunkLoadError. A correção é simplesmente recarregar a página (uma vez).
 */

const KEY = "astryon:chunk-reload-at";
const MIN_INTERVAL_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ChunkLoadError" ||
    /Failed to load chunk|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(error.message)
  );
}

/** True se o erro é de chunk e não houve recarga automática nos últimos 30 s (evita laço de recarga). */
export function shouldAutoReload(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    /* armazenamento indisponível: ainda tenta uma recarga */
  }
  return Date.now() - last >= MIN_INTERVAL_MS;
}

export function markAndReload(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/** Recarrega a página se o erro for de chunk, no máximo uma vez a cada 30 s. */
export function reloadOnChunkError(error: unknown): boolean {
  if (!shouldAutoReload(error)) return false;
  markAndReload();
  return true;
}
