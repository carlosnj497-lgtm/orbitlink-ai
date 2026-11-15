"use client";

/**
 * Navegação com recarga completa da página. Só para trocas de sessão (logout, sessão expirada, senha trocada,
 * conta excluída, login concluído): a recarga descarta o cache do React Query e qualquer estado em memória da
 * sessão anterior, o que `router.push()` não faz. Para navegação comum, use `<Link>` ou `useRouter()`.
 */
export function reloadTo(path: string): void {
  window.location.assign(new URL(path, window.location.origin));
}

/** Vai para o login guardando a tela atual em `?next=` (sessão ausente ou expirada). */
export function reloadToLogin(extra = ""): void {
  const next = encodeURIComponent(window.location.pathname);
  reloadTo(`/login?next=${next}${extra}`);
}
