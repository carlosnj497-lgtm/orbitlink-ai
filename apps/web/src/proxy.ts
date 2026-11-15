import { type NextRequest, NextResponse } from "next/server";

/**
 * Portão de navegação: sem cookie de sessão, redireciona para /login.
 * A validação real da sessão acontece no agente a cada chamada (via /api/agent).
 */
const PUBLIC = ["/login", "/demo", "/api/auth", "/favicon.ico", "/sw.js", "/offline.html", "/manifest.webmanifest", "/termos", "/privacidade", "/aparelho"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.next(); // a rota responde 401 por conta própria
  if (!request.cookies.get("astryon_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpe?g|webp|ico|webmanifest)$).*)"],
};
