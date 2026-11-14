/**
 * Destino seguro para depois do login. Só aceita caminhos do próprio painel.
 *
 * Checar `startsWith("/") && !startsWith("//")` não basta: o navegador trata `\` como `/`, então
 * `/\evil.com` vira `//evil.com` (outro site). Aqui o valor é resolvido como URL de verdade e a origem
 * precisa continuar a mesma; caracteres de controle e barras invertidas são recusados de cara.
 */
export function safeNext(next: string | null | undefined, origin: string): string {
  if (!next || !next.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return "/";
  }
  if (url.origin !== new URL(origin).origin) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
