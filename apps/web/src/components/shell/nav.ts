import {
  Activity,
  BellRing,
  ChartColumn,
  House,
  MonitorSmartphone,
  SatelliteDish,
  ScrollText,
  Settings,
  Sparkles,
  TriangleAlert,
  UserRound,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { CLOUD, CLOUD_SLUGS } from "@/lib/cloud-flag";
import type { Slug } from "@/views/slugs";

export interface NavPage {
  slug: Slug;
  /** Rótulo da aba dentro da seção. */
  label: string;
}

/** Seção da barra lateral. A primeira página é a de entrada; as demais viram abas no topo da tela. */
export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  pages: NavPage[];
  /** Mostra o contador de alertas ativos. */
  alerts?: boolean;
}

const ALL_SECTIONS: NavSection[] = [
  { id: "dashboard", label: "Dashboard", icon: House, pages: [{ slug: "", label: "Dashboard" }] },
  { id: "ia", label: "Central de IA", icon: Sparkles, pages: [{ slug: "assistente", label: "Central de IA" }] },
  {
    id: "conexao",
    label: "Conexão e Internet",
    icon: Wifi,
    pages: [
      { slug: "ao-vivo", label: "Ao vivo" },
      { slug: "consumo", label: "Consumo" },
      { slug: "qualidade", label: "Qualidade" },
    ],
  },
  {
    id: "antena",
    label: "Antena e Sinal",
    icon: SatelliteDish,
    pages: [
      { slug: "antena", label: "Estado" },
      { slug: "controle", label: "Controle" },
    ],
  },
  {
    id: "dispositivos",
    label: "Dispositivos",
    icon: MonitorSmartphone,
    pages: [
      { slug: "dispositivos", label: "Rede" },
      { slug: "esp32", label: "ESP32" },
    ],
  },
  {
    id: "diagnosticos",
    label: "Diagnósticos",
    icon: Activity,
    pages: [
      { slug: "diagnosticos", label: "Resumo" },
      { slug: "instalacao", label: "Teste de conexão" },
    ],
  },
  { id: "obstrucoes", label: "Obstruções", icon: TriangleAlert, pages: [{ slug: "obstrucoes", label: "Obstruções" }] },
  { id: "logs", label: "Eventos", icon: ScrollText, pages: [{ slug: "interrupcoes", label: "Eventos" }] },
  { id: "relatorios", label: "Relatórios", icon: ChartColumn, pages: [{ slug: "relatorios", label: "Relatórios" }] },
  { id: "automacao", label: "Alertas", icon: BellRing, pages: [{ slug: "alertas", label: "Alertas" }], alerts: true },
  { id: "configuracoes", label: "Configurações", icon: Settings, pages: [{ slug: "configuracoes", label: "Configurações" }] },
];

const CLOUD_SECTION: NavSection = { id: "conta", label: "Conta", icon: UserRound, pages: [{ slug: "conta", label: "Conta" }] };

/** Na nuvem, só as telas que funcionam com os dados sincronizados, mais a página Conta. */
export const SECTIONS: NavSection[] = CLOUD
  ? [
      ...ALL_SECTIONS.map((s) => ({ ...s, pages: s.pages.filter((p) => (CLOUD_SLUGS as readonly string[]).includes(p.slug)) })).filter((s) => s.pages.length),
      CLOUD_SECTION,
    ]
  : ALL_SECTIONS;

/** Caminho (sem o prefixo /demo) → slug da tela. */
export function slugOf(pathname: string, base: string): string {
  const rest = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return rest.replace(/^\/+|\/+$/g, "");
}

export function sectionOf(slug: string): NavSection | undefined {
  return SECTIONS.find((s) => s.pages.some((p) => p.slug === slug));
}

export const hrefOf = (base: string, slug: string) => `${base}/${slug}`.replace(/\/$/, "") || "/";
