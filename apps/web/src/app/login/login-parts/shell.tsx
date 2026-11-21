import { Eye } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

interface LoginShellProps {
  children: ReactNode;
  className?: string;
  /** Status do agente/painel mostrado no topo do card. */
  status?: { tone: "ok" | "warn" | "crit" | "info"; label: string } | null;
  /** Badge do modo (ex: "local" / "nuvem"). */
  mode?: string;

  /** Mostrar link para demonstração. */
  showDemo?: boolean;
  /** Versão do painel/agente exibida no rodapé (ex: "0.2.0"). */
  version?: string | null;
  title?: string;
  subtitle?: string;
}

const DOT_BASE: Record<NonNullable<LoginShellProps["status"]>["tone"], string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  info: "bg-accent",
};

const DOT_GLOW: Record<NonNullable<LoginShellProps["status"]>["tone"], string> = {
  ok: "shadow-[0_0_8px_rgba(0_214_143,0.55)]",
  warn: "shadow-[0_0_8px_rgba(232_185_49,0.55)]",
  crit: "shadow-[0_0_8px_rgba(255_70_85,0.55)]",
  info: "shadow-[0_0_8px_rgba(56_189_248,0.55)]",
};

/** Ponto de estado operacional: pisca suavemente quando o sistema está pronto. */
function StatusDot({ tone }: { tone: NonNullable<LoginShellProps["status"]>["tone"] }) {
  return (
    <span className="relative inline-flex size-1.5">
      {tone === "ok" && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full opacity-55 motion-reduce:animate-none",
            DOT_BASE[tone],
            "animate-[ping_2.2s_cubic-bezier(0,0,0.2,1)_infinite]",
          )}
        />
      )}
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT_BASE[tone], DOT_GLOW[tone])} />
    </span>
  );
}

/** Wrapper visual das telas de autenticação: card centralizado em painel de missão. */
export function LoginShell({
  children,
  className,
  status,
  mode = "local",
  showDemo = true,
  version = null,
  title = "Acessar o console",
  subtitle = "Autentique-se para monitorar a conexão.",
}: LoginShellProps) {
  return (
    <main
      className={cn(
        "relative isolate grid min-h-dvh place-items-center overflow-hidden bg-bg",
        "pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(2rem,env(safe-area-inset-top))]",
        className,
      )}
    >
      <div aria-hidden className="fixed inset-0 -z-20 bg-black bg-cover bg-center" style={{ backgroundImage: "url(/login-bg.webp)" }} />
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.70)_0%,rgba(0,0,0,0.50)_45%,rgba(0,0,0,0.85)_100%)]"
      />

      <div className="relative w-full max-w-[22rem]">
        {/* Marca visual */}
        <div className="mb-5 flex flex-col items-center text-center">
          <Image
            src="/dish-login.webp"
            alt=""
            width={338}
            height={420}
            unoptimized
            priority
            className="h-24 w-auto drop-shadow-[0_10px_28px_rgba(0,0,0,0.8)] sm:h-28"
          />
          <Image
            src="/astryon-logo.webp"
            alt="ASTRYON"
            width={800}
            height={298}
            unoptimized
            priority
            className="h-auto w-48 sm:w-56"
          />
          <p className="mt-1 max-w-xs text-sm text-fg-muted">Painel local da sua Starlink</p>
        </div>

        <Card className="ol-card ol-glow ol-hud relative overflow-hidden p-5 sm:p-6">
          <div className="relative z-10">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="font-display text-[21px] font-semibold leading-tight tracking-[-0.02em] text-fg">
                  {title}
                </h1>
                {subtitle && <p className="mt-1 text-sm leading-relaxed text-fg-muted">{subtitle}</p>}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <Badge tone="info">{mode}</Badge>
                {status && (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-fg-subtle">
                    <StatusDot tone={status.tone} />
                    {status.label}
                  </span>
                )}
              </div>
            </div>

            {children}
          </div>
        </Card>

        <footer className="mt-5 text-center text-[11px] leading-relaxed text-fg-subtle">
          {showDemo && (
            <p className="mt-2">
              <Link href="/demo" className="inline-flex min-h-10 items-center gap-1 text-accent hover:text-accent-strong hover:underline">
                <Eye className="size-3.5" aria-hidden /> Ver demonstração (dados fictícios)
              </Link>
            </p>
          )}
          {version && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-subtle/70">v{version}</p>
          )}
        </footer>
      </div>
    </main>
  );
}
