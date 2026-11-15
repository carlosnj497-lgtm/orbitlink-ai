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

/*
 * Telas carregadas só no cliente (ssr: false). No servidor elas nunca têm dados — renderizariam apenas o
 * esqueleto — e hidratá-las depois da casca causava erro de hidratação: quando o chunk da tela chegava, as
 * consultas compartilhadas com a casca (status/agente) já estavam em cache e o HTML não batia mais.
 */

/** slug da rota → tela. As mesmas telas são usadas em /demo (com dados de demonstração). */
export const VIEWS: Record<string, ComponentType> = {
  "": dynamic(() => import("./overview"), { loading, ssr: false }),
  "ao-vivo": dynamic(() => import("./live"), { loading, ssr: false }),
  consumo: dynamic(() => import("./usage"), { loading, ssr: false }),
  qualidade: dynamic(() => import("./quality"), { loading, ssr: false }),
  interrupcoes: dynamic(() => import("./outages"), { loading, ssr: false }),
  obstrucoes: dynamic(() => import("./obstructions"), { loading, ssr: false }),
  dispositivos: dynamic(() => import("./devices"), { loading, ssr: false }),
  controle: dynamic(() => import("./control"), { loading, ssr: false }),
  esp32: dynamic(() => import("./esp32"), { loading, ssr: false }),
  assistente: dynamic(() => import("./assistant"), { loading, ssr: false }),
  alertas: dynamic(() => import("./alerts"), { loading, ssr: false }),
  relatorios: dynamic(() => import("./reports"), { loading, ssr: false }),
  configuracoes: dynamic(() => import("./settings"), { loading, ssr: false }),
  antena: dynamic(() => import("./antenna"), { loading, ssr: false }),
  diagnosticos: dynamic(() => import("./diagnostics"), { loading, ssr: false }),
  instalacao: dynamic(() => import("./setup"), { loading, ssr: false }),
  conta: dynamic(() => import("./account"), { loading, ssr: false }),
};

export function ViewRouter({ slug }: { slug: string }) {
  const View = VIEWS[slug];
  return View ? <View /> : null;
}
