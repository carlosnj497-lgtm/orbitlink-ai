import "server-only";

/**
 * IP do cliente para o limitador de tentativas do agente. O primeiro item de X-Forwarded-For é escolhido pelo
 * próprio cliente; o proxy confiável (Nginx, `proxy_add_x_forwarded_for`) acrescenta o IP real no FIM da lista.
 * Por isso vale o último item (ou X-Real-IP, que o Nginx define), nunca o primeiro. Sem proxy na frente, os
 * dois cabeçalhos são do cliente: aí a defesa é o limite por usuário no próprio agente.
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return (hops.at(-1) ?? "local").slice(0, 64);
}
