import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Título de seção das telas do equipamento (Agora, Tendência, Detalhes…): mesmo idioma de Alertas e Configurações. */
export function SectionHead({ id, title, children, actions, className }: { id: string; title: string; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id={id} className="font-display text-[17px] font-semibold text-fg">
          {title}
        </h2>
        {children && <p className="text-xs text-fg-subtle">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
