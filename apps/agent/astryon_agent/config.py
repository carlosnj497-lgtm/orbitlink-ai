"""Configuração do agente (variáveis `ASTRYON_*` ou arquivo `.env` na raiz do repositório)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


def _env_files() -> tuple[str, ...]:
    explicit = os.environ.get("ASTRYON_ENV_FILE")
    if explicit:
        return (explicit,)
    return (str(REPO_ROOT / ".env"),)


class Settings(BaseSettings):
    # env_ignore_empty: "ASTRYON_FIXTURE_FILE=" no .env significa "não definido", não Path(".")
    model_config = SettingsConfigDict(env_prefix="ASTRYON_", env_file=_env_files(), extra="ignore",
                                      env_ignore_empty=True, env_file_encoding="utf-8-sig")

    # Rede Starlink
    dish_target: str = "192.168.100.1:9200"
    router_target: str = "192.168.1.1:9000"
    router_enabled: bool = True
    grpc_timeout_s: float = 5.0
    connect_timeout_s: float = 3.0

    # Coleta (segundos)
    status_interval_s: float = 10.0
    history_interval_s: float = 30.0
    obstruction_interval_s: float = 300.0
    heartbeat_interval_s: float = 30.0
    capability_refresh_s: float = 3600.0
    degraded_drop_rate: float = 0.05

    # Persistência
    data_dir: Path = Field(default=REPO_ROOT / "data")
    retention_raw_days: int = 7  # amostras de 1 s
    retention_minute_days: int = 400  # agregados por minuto, eventos de conexão, lacunas e auditoria de controle
    retention_sensor_days: int = 30  # leituras brutas dos sensores ESP32 (~43 mil linhas/dia com 5 sensores)
    retention_log_days: int = 90  # notificações já entregues/abandonadas e alertas resolvidos

    # API do agente
    host: str = "127.0.0.1"
    port: int = 8787
    api_token: SecretStr | None = None  # token compartilhado com o servidor Next (nunca com o navegador)
    allowed_origins: list[str] = ["http://127.0.0.1:3000", "http://localhost:3000"]
    allow_lan: bool = False  # True só com pareamento explícito
    # Código exigido para criar o primeiro administrador. Obrigatório quando o painel é acessível pela LAN
    # (servidor Linux atrás do Nginx); o instalador gera e grava em /etc/astryon/setup-code.
    setup_code: SecretStr | None = None

    # Modo fixture (testes/demonstração) — nunca ativado silenciosamente
    fixture_file: Path | None = None

    # Supabase (opcional)
    supabase_url: str | None = None
    supabase_anon_key: SecretStr | None = None
    supabase_agent_token: SecretStr | None = None
    sync_interval_s: float = 60.0

    # Alertas
    alert_webhook_url: str | None = None  # https://... (opcional; payload sem dados privados)
    # Telegram (opcional): token do @BotFather e chat que recebe os alertas
    telegram_bot_token: SecretStr | None = None
    telegram_chat_id: str | None = None
    # Se telegram_chat_id for um grupo, só estas pessoas (user id do Telegram) usam o bot. Ex.: [123456789]
    telegram_allowed_user_ids: list[int] = []
    # O bot responde perguntas (copiloto) vindas SÓ de telegram_chat_id. Long polling: nenhuma porta aberta.
    telegram_chat_enabled: bool = True
    telegram_chat_per_minute: int = Field(default=6, ge=1, le=60)
    notification_max_age_h: int = 24  # notificação que não sai em N h (ex.: internet fora) é descartada
    # Resumo semanal pelo Telegram (consumo, disponibilidade, quedas, franquia). Também ajustável em Alertas.
    weekly_digest_enabled: bool = True
    weekly_digest_weekday: int = Field(default=0, ge=0, le=6)  # 0 = segunda ... 6 = domingo
    weekly_digest_hour: int = Field(default=8, ge=0, le=23)  # hora local (ASTRYON_TIMEZONE)
    # Relatório do ciclo em PDF pelo Telegram, no dia seguinte ao fim do ciclo de cobrança (às 9h).
    monthly_report_enabled: bool = True

    # Franquia do plano (também ajustável em Configurações). Estimativa local, não a fatura oficial.
    usage_monthly_limit_gb: float | None = None
    usage_cycle_start_day: int = Field(default=1, ge=1, le=28)

    # ESP32 (opcional) — listener separado só com rotas de ingestão autenticada por HMAC
    esp32_enabled: bool = False
    esp32_listen_host: str = "0.0.0.0"  # noqa: S104 - precisa aceitar o ESP32 na LAN; rotas exigem HMAC
    esp32_listen_port: int = 8788
    esp32_clock_skew_s: int = 300

    # Dispositivos
    show_mac_addresses: bool = False

    # Groq (opcional) — o limite inclui os tokens de raciocínio dos modelos gpt-oss
    groq_api_key: SecretStr | None = None
    ai_model: str = "openai/gpt-oss-120b"
    ai_max_tokens: int = 4096
    ai_daily_request_limit: int = 100
    ai_conversation_retention_days: int = 30
    # Áudio (nota de voz): Whisper na Groq, com a MESMA chave do copiloto. Cota e custo próprios.
    ai_transcribe_enabled: bool = True
    telegram_voice_replies: bool = True
    ai_tts_voice: str = "pt-BR-FranciscaNeural"
    ai_tts_timeout_s: float = Field(default=45, ge=5, le=120)
    ai_tts_max_chars: int = Field(default=3000, ge=100, le=10000)
    ai_transcribe_model: str = "whisper-large-v3-turbo"
    ai_transcribe_language: str = "pt"
    ai_transcribe_timeout_s: float = 60.0
    ai_audio_daily_request_limit: int = Field(default=50, ge=0, le=500)
    # Tamanho máximo aceito por nota de voz (o Telegram envia Opus em .ogg).
    ai_audio_max_bytes: int = Field(default=20 * 1024 * 1024, ge=1024)

    # Clima (opcional, Open-Meteo, sem chave). Só para correlacionar com a conexão: é estimativa regional.
    # A localização também pode ser definida em Configurações (tem prioridade). Sem localização, nada é buscado.
    weather_enabled: bool = True
    weather_location_name: str | None = None
    weather_latitude: float | None = Field(default=None, ge=-90, le=90)
    weather_longitude: float | None = Field(default=None, ge=-180, le=180)
    weather_interval_s: float = Field(default=1800, ge=600, le=21600)

    # Saúde do servidor e vigias
    downtime_notice_min: int = Field(default=10, ge=1, le=1440)  # avisa no Telegram se o agente ficou parado mais que isso
    # Vigia externo (ex.: https://hc-ping.com/<uuid> do healthchecks.io): avisa se os sinais pararem, até com o
    # servidor desligado. Só um GET periódico, sem dados.
    healthcheck_url: str | None = Field(default=None, pattern=r"^https://")
    healthcheck_interval_s: float = Field(default=300, ge=60, le=3600)
    # Backup do banco: cópia diária em <data>/backups (mantém N) e cópia semanal no chat do Telegram.
    backup_enabled: bool = True
    backup_keep: int = Field(default=7, ge=1, le=90)
    # Desligado por padrão: o arquivo vai para fora da máquina. Quando ligado, segue uma cópia sem sessões, hashes
    # de senha nem segredos cifrados, e nunca para chat de grupo.
    backup_telegram: bool = False
    backup_telegram_every_days: int = Field(default=7, ge=1, le=90)

    # Aparelho pronto (ex.: Raspberry Pi vendido já instalado): enquanto NÃO estiver pareado, a página
    # http://astryon.local/aparelho aceita o código da conta sem login de administrador (só na rede local).
    appliance: bool = False

    # MQTT (opcional, ex.: Home Assistant). Sem host, nada é publicado.
    mqtt_host: str | None = None
    mqtt_port: int = Field(default=1883, ge=1, le=65535)
    mqtt_username: str | None = None
    mqtt_password: SecretStr | None = None
    mqtt_tls: bool = False
    mqtt_topic_prefix: str = Field(default="astryon", pattern=r"^[A-Za-z0-9_\-/]{1,40}$")
    mqtt_discovery: bool = True  # descoberta automática do Home Assistant
    mqtt_interval_s: float = Field(default=30, ge=5, le=3600)

    # Exibição
    timezone: str = "America/Fortaleza"
    terminal_name: str = "Starlink Mini"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "astryon.sqlite3"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
