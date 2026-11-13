import {
  Activity,
  BarChart3,
  BellRing,
  Bot,
  Cpu,
  FileText,
  Gauge,
  LayoutDashboard,
  MonitorSmartphone,
  Radar,
  Settings,
  SlidersHorizontal,
  Unplug,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: "Monitorar" | "Analisar" | "Operar" | "Sistema";
}

export const NAV: NavItem[] = [
  { href: "/", label: "Visão Geral", icon: LayoutDashboard, group: "Monitorar" },
  { href: "/ao-vivo", label: "Monitoramento ao Vivo", icon: Activity, group: "Monitorar" },
  { href: "/consumo", label: "Consumo de Internet", icon: BarChart3, group: "Analisar" },
  { href: "/qualidade", label: "Qualidade da Conexão", icon: Gauge, group: "Analisar" },
  { href: "/interrupcoes", label: "Interrupções", icon: Unplug, group: "Analisar" },
  { href: "/obstrucoes", label: "Obstruções", icon: Radar, group: "Analisar" },
  { href: "/dispositivos", label: "Dispositivos da Rede", icon: MonitorSmartphone, group: "Operar" },
  { href: "/controle", label: "Controle da Starlink", icon: SlidersHorizontal, group: "Operar" },
  { href: "/esp32", label: "Centro ESP32", icon: Cpu, group: "Operar" },
  { href: "/assistente", label: "Assistente Claude AI", icon: Bot, group: "Operar" },
  { href: "/alertas", label: "Alertas e Automações", icon: BellRing, group: "Sistema" },
  { href: "/relatorios", label: "Relatórios", icon: FileText, group: "Sistema" },
  { href: "/configuracoes", label: "Configurações", icon: Settings, group: "Sistema" },
  { href: "/instalacao", label: "Assistente de Instalação", icon: Wrench, group: "Sistema" },
];
