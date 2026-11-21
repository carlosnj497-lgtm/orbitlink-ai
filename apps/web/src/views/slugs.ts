export const SLUGS = [
  "",
  "ao-vivo",
  "consumo",
  "qualidade",
  "antena",
  "controle",
  "dispositivos",
  "esp32",
  "diagnosticos",
  "instalacao",
  "assistente",
  "obstrucoes",
  "interrupcoes",
  "relatorios",
  "alertas",
  "configuracoes",
  "conta",
] as const;

export type Slug = (typeof SLUGS)[number];

/** Título (h1 do cabeçalho e <title>) de cada tela. */
export const TITLES: Record<string, string> = {
  "": "Dashboard",
  "ao-vivo": "Monitoramento ao Vivo",
  consumo: "Consumo de Internet",
  qualidade: "Qualidade da Conexão",
  antena: "Antena e Sinal",
  controle: "Controle da Starlink",
  dispositivos: "Dispositivos da Rede",
  esp32: "Centro ESP32",
  diagnosticos: "Diagnósticos",
  instalacao: "Teste de Conexão",
  assistente: "Central de IA",
  obstrucoes: "Obstruções",
  interrupcoes: "Eventos",
  relatorios: "Relatórios",
  alertas: "Alertas e Automações",
  configuracoes: "Configurações",
  conta: "Conta",
};

/** Linha curta de contexto exibida ao lado do título no cabeçalho. */
export const TAGLINES: Record<string, string> = {
  "": "Visão geral da sua Starlink em tempo real",
  "ao-vivo": "Tráfego, latência e perda conforme a antena reporta",
  consumo: "Estimativa local a partir do tráfego da antena",
  qualidade: "Latência, perda e disponibilidade observadas",
  antena: "Estado do equipamento, sinal e energia",
  controle: "Capacidades do firmware e ações com confirmação",
  dispositivos: "Clientes informados pelo roteador Starlink",
  esp32: "Telemetria física opcional via ESP32",
  diagnosticos: "Achados por regras a partir dos dados registrados",
  instalacao: "Verificação do ambiente, da rede e da antena",
  assistente: "Pergunte sobre conexão, consumo e alertas. Respostas só leem dados; ações precisam da sua confirmação.",
  obstrucoes: "Céu visto pela antena e tendência de obstrução",
  interrupcoes: "Interrupções e eventos de conexão registrados",
  relatorios: "Exportações geradas a partir dos dados locais",
  alertas: "Regras, notificações e resumo semanal",
  configuracoes: "Preferências do painel e configuração efetiva",
};
