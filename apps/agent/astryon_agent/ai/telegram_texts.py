"""Textos visíveis do bot do Telegram, reunidos num só lugar.

Hoje existe só pt-BR. Para oferecer outro idioma, duplique este módulo e escolha qual importar
pela configuração do agente — nenhum texto de interação fica mais espalhado pelo telegram_bot.
Os relatórios (telegram_views) e a apresentação publicada no Telegram (telegram_setup) ainda
guardam os próprios textos; migram para cá quando um segundo idioma for adicionado.
"""

from __future__ import annotations

HELP = (
    "🛰️ <b>ASTRYON · Central da sua Starlink</b>\n"
    "Consulte os dados pelos botões ou converse comigo em português.\n\n"
    "Exemplos:\n"
    "- Como está a conexão agora?\n"
    "- Quanto consumi este mês? Vou passar da franquia?\n"
    "- Teve queda hoje? Por quê?\n"
    "- A queda de ontem foi por causa da chuva?\n\n"
    "Comandos:\n"
    "/menu: abrir a central de consultas\n"
    "/status: diagnóstico rápido por regras (não usa IA)\n"
    "/consumo: download e upload estimados\n"
    "/franquia: saldo e projeção do ciclo\n"
    "/qualidade: latência, perda e disponibilidade\n"
    "/quedas: interrupções recentes\n"
    "/alertas: alertas ativos\n"
    "/clima: clima agora e próximas horas\n"
    "/horario: melhores horários para downloads e chamadas\n"
    "/resumo: consumo, quedas e qualidade dos últimos 7 dias\n"
    "/relatorio: PDF dos últimos 30 dias (com comparação e clima)\n"
    "/bot: recursos, cotas e notificações\n"
    "/nova: começa uma conversa nova\n"
    "/audio ligar ou /audio desligar: respostas faladas do assistente\n"
    "/ajuda: esta mensagem\n\n"
    "Períodos: /consumo 7d, /qualidade 1h ou /quedas 24h.\n"
    "Opções: 1h, 6h, 24h, 7d e 30d. Padrão: 24h.\n\n"
    "As consultas por comando não gastam IA.\n"
    "Você pode mandar sua pergunta por áudio (nota de voz), quando a transcrição estiver ativada.\n"
    "Ações como reiniciar a antena só são confirmadas no painel."
)

BUTTON_EXPIRED = "Este botão expirou. Abra /menu."
TRY_AGAIN_LATER = "Não consegui concluir esta consulta agora. Tente novamente em instantes."
ONLY_TEXT_OR_AUDIO = "Só entendo texto ou áudio. Escreva a sua pergunta ou mande uma nota de voz."
AUDIO_USAGE = "Use /audio ligar ou /audio desligar."
NEW_CONVERSATION = ("💬 Conversa nova. Pode perguntar.\n"
                    "O contexto anterior foi desvinculado; o histórico continua disponível no painel.")
REPORT_GENERATING = "📄 Gerando o relatório dos últimos 30 dias..."
REPORT_FAILED = "Não consegui enviar o PDF agora. Tente de novo em instantes."
DIGEST_EMPTY = "Ainda não há dados observados nos últimos 7 dias."
UNKNOWN_COMMAND = "Comando desconhecido.\n\n" + HELP
RATE_LIMITED = "Muitas perguntas em sequência. Espere um minuto e tente de novo."
TRANSCRIBE_DISABLED = ("O reconhecimento de áudio está desativado neste agente. "
                       "Escreva a sua pergunta e eu respondo.")
AUDIO_DOWNLOAD_FAILED = "Não consegui baixar o seu áudio. Mande de novo ou escreva a pergunta."
AUDIO_DOWNLOAD_RETRY = "Não consegui baixar o seu áudio agora. Tente de novo em instantes."
TRANSCRIBE_FAILED = ("Não consegui transcrever o seu áudio. "
                     "Escreva a pergunta ou mande a nota de voz de novo.")
TRANSCRIBE_UNAVAILABLE = ("O serviço de transcrição está indisponível agora. "
                          "Use /status para o diagnóstico por regras.")
TRANSCRIBE_EMPTY = "Não ouvi nada de útil no áudio. Tente de novo, mais perto do microfone."
NO_ADMIN = "Crie primeiro o administrador no painel do ASTRYON; depois pergunte aqui."
VOICE_DELIVERY_UNCONFIRMED = "Não consegui confirmar a entrega da voz agora. A resposta completa está no texto acima."
VOICE_UNAVAILABLE = "Não consegui enviar a voz agora. A resposta completa está no texto acima."


def audio_replies(state: str) -> str:
    return (f"🔊 Respostas em áudio {state}.\n"
            "O assistente envia texto e voz. Consultas por comando continuam em texto.\n"
            "Use /audio ligar ou /audio desligar. Voz online: Microsoft Edge.")


def invalid_period(command: str, accepts_period: bool) -> str:
    hint = f"Exemplo: /{command} 7d" if accepts_period else f"Use /{command} sem argumentos."
    return f"Período inválido. Use 1h, 6h, 24h, 7d ou 30d.\n{hint}"


def stale_notice(when: str) -> str:
    return (f"Recebi agora a sua mensagem de {when} (o agente estava fora do ar). "
            "Pergunte de novo se ainda precisar: a resposta seria sobre o estado atual.")


def transcribed(question: str) -> str:
    return f"🎙 «{question}»"


def quota_exceeded(exc: Exception) -> str:
    return f"{exc} Use /status para o diagnóstico por regras."


def ai_unavailable(kind: str) -> str:
    return f"Assistente indisponível agora ({kind}). Use /status para o diagnóstico por regras."


def proposal(description: str) -> str:
    return (f"\n\n⚠️ **Proposta: {description}.** Nada foi executado. "
            "Para confirmar, abra o painel em Controle da Starlink.")
