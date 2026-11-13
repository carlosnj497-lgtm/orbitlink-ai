"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { Skeleton } from "@/components/ui/primitives";

const loading = () => (
  <div className="space-y-4">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-64 w-full" />
  </div>
);

/** slug da rota → tela. As mesmas telas são usadas em /demo (com dados de demonstração). */
export const VIEWS: Record<string, ComponentType> = {
  "": dynamic(() => import("./overview"), { loading }),
  "ao-vivo": dynamic(() => import("./live"), { loading }),
  consumo: dynamic(() => import("./usage"), { loading }),
  qualidade: dynamic(() => import("./quality"), { loading }),
  interrupcoes: dynamic(() => import("./outages"), { loading }),
  obstrucoes: dynamic(() => import("./obstructions"), { loading }),
  dispositivos: dynamic(() => import("./devices"), { loading }),
  controle: dynamic(() => import("./control"), { loading }),
  esp32: dynamic(() => import("./esp32"), { loading }),
  assistente: dynamic(() => import("./assistant"), { loading }),
  alertas: dynamic(() => import("./alerts"), { loading }),
  relatorios: dynamic(() => import("./reports"), { loading }),
  configuracoes: dynamic(() => import("./settings"), { loading }),
  instalacao: dynamic(() => import("./setup"), { loading }),
};

export function ViewRouter({ slug }: { slug: string }) {
  const View = VIEWS[slug];
  return View ? <View /> : null;
}
