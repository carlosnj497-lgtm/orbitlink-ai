"use client";

/*
 * Recuperação de "version skew": depois de recompilar/atualizar o painel, uma aba aberta antes da atualização
 * ainda referencia arquivos JS da versão antiga, que já não existem. Ao navegar para uma tela cujo código
 * mudou, o carregamento falha com ChunkLoadError. A correção é recarregar a página para buscar a nova versão.
 */

const KEY = "astryon:chunk-reloads";
const MAX_ATTEMPTS = 3;
const WINDOW_MS = 5 * 60 * 1000; // 5 min

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ChunkLoadError" ||
    /Failed to load chunk|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(error.message)
  );
}

function getHistory(): number[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((t) => typeof t === "number" && now - t <= WINDOW_MS);
  } catch {
    return [];
  }
}

function setHistory(times: number[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(times));
  } catch {
    /* ignore */
  }
}

/** Permite até N recargas automáticas numa janela; evita laço, mas não bloqueia após uma única recarga recente. */
export function shouldAutoReload(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  return getHistory().length < MAX_ATTEMPTS;
}

export function markAndReload(): void {
  const history = getHistory();
  history.push(Date.now());
  setHistory(history);
  window.location.reload();
}

/** Limpa o histórico de recargas automáticas (útil para recarga manual forçada). */
export function clearChunkReloadHistory(): void {
  setHistory([]);
}

/** Recarrega a página se o erro for de chunk, respeitando a janela de tentativas. */
export function reloadOnChunkError(error: unknown): boolean {
  if (!shouldAutoReload(error)) return false;
  markAndReload();
  return true;
}
