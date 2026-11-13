#!/usr/bin/env bash
# OrbitLink AI — instalação em Ubuntu Server 24.04 LTS (sem Docker, sem interface gráfica).
#
#   git clone <seu-repo> ~/orbitlink && cd ~/orbitlink
#   sudo deploy/linux/install.sh                 # instalação padrão (UFW + Nginx + systemd)
#   sudo deploy/linux/install.sh --help
#
# O script é idempotente: pode ser executado de novo para reparar a instalação. Ele NÃO altera rotas de rede,
# NÃO abre serviços para a internet e NÃO mexe no SSH sem --harden-ssh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/linux/lib.sh
. "${SCRIPT_DIR}/lib.sh"
SRC="$(cd "${SCRIPT_DIR}/../.." && pwd)"

LAN=""
SERVER_NAME=""
WITH_TAILSCALE=0
FIREWALL=1
HARDEN_SSH=0
ESP32=0
FORCE_OS=0

usage() {
  cat <<EOF
Uso: sudo $0 [opções]

  --lan-cidr CIDR      Rede local autorizada (padrão: detectada, ex. 192.168.1.0/24)
  --server-name NOME   Nome/IP no certificado e no Nginx (padrão: hostname). Outros nomes recebem 444
  --with-tailscale     Instala o Tailscale (repositório oficial) e libera o painel na interface tailscale0
  --esp32              Habilita o listener do ESP32 (porta 8788, somente LAN)
  --no-firewall        Não configura o UFW (NÃO recomendado)
  --harden-ssh         Desativa login por senha e root no SSH (exige chave em ~/.ssh/authorized_keys)
  --yes                Responde "sim" às confirmações
  --force-os           Permite executar fora do Ubuntu 24.04 (sem suporte)
  -h, --help           Esta ajuda
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lan-cidr) LAN="${2:?}"; shift 2 ;;
    --server-name) SERVER_NAME="${2:?}"; shift 2 ;;
    --with-tailscale) WITH_TAILSCALE=1; shift ;;
    --esp32) ESP32=1; shift ;;
    --no-firewall) FIREWALL=0; shift ;;
    --harden-ssh) HARDEN_SSH=1; shift ;;
    --yes|-y) export OL_ASSUME_YES=1; shift ;;
    --force-os) FORCE_OS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "opção desconhecida: $1" ;;
  esac
done

require_root

# ================================================================= 1. pré-verificação
step "Verificando o sistema"
. /etc/os-release
if [[ "${ID}" != "ubuntu" || "${VERSION_ID}" != "24.04" ]]; then
  [[ ${FORCE_OS} -eq 1 ]] || die "suportado: Ubuntu 24.04 LTS (encontrado: ${PRETTY_NAME}). Use --force-os por sua conta."
  warn "sistema não suportado oficialmente: ${PRETTY_NAME}"
fi
ok "${PRETTY_NAME}"
[[ -d /run/systemd/system ]] || die "systemd não está ativo"
[[ -f "${SRC}/apps/agent/pyproject.toml" ]] || die "execute a partir de um clone do repositório OrbitLink"
SERVER_NAME="${SERVER_NAME:-$(hostname -f 2>/dev/null || hostname)}"

# ================================================================= 2. pacotes
step "Instalando pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  python3 python3-venv python3-pip ca-certificates curl gnupg git rsync nginx ufw sqlite3 openssl iproute2 \
  >/dev/null
ok "python $(python3 -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])'), nginx, ufw, sqlite3"

NODE_OK=0
if NODE_BIN="$(node_bin)" && version_ge "$("${NODE_BIN}" -v | tr -d v)" "20.9.0"; then NODE_OK=1; fi
if [[ ${NODE_OK} -eq 0 ]]; then
  info "Node.js ${OL_NODE_MAJOR} (repositório oficial NodeSource, assinado)…"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${OL_NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_BIN="$(node_bin)" || die "Node.js não encontrado em /usr/local/bin ou /usr/bin"
version_ge "$("${NODE_BIN}" -v | tr -d v)" "20.9.0" || die "Node.js >= 20.9 é necessário (encontrado $("${NODE_BIN}" -v))"
ok "node $("${NODE_BIN}" -v) (${NODE_BIN}), npm $(PATH="/usr/local/bin:/usr/bin:/bin" npm -v)"

# ================================================================= 3. usuário e diretórios
step "Usuário de serviço e diretórios"
if ! id -u "${OL_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${OL_DATA}" --no-create-home --shell /usr/sbin/nologin "${OL_USER}"
  ok "usuário ${OL_USER} criado (sem login)"
else
  ok "usuário ${OL_USER} já existe"
fi
install -d -o root -g root -m 0755 "${OL_PREFIX}"
install -d -o "${OL_USER}" -g "${OL_USER}" -m 0755 "${OL_RELEASES}"
install -d -o "${OL_USER}" -g "${OL_USER}" -m 0750 "${OL_DATA}" "${OL_DATA}/backups"
install -d -o root -g "${OL_USER}" -m 0750 "${OL_ETC}" "${OL_ETC}/tls"
install -d -o root -g root -m 0755 "${OL_LIBEXEC}"

# ================================================================= 4. configuração e segredos
step "Configuração (${OL_ENV_FILE})"
if [[ ! -f "${OL_ENV_FILE}" ]]; then
  tmp="$(mktemp)"
  sed -e "s|^ORBITLINK_API_TOKEN=.*|ORBITLINK_API_TOKEN=$(random_token)|" \
      -e "s|^ORBITLINK_COOKIE_SECURE=.*|ORBITLINK_COOKIE_SECURE=true|" \
      "${SRC}/.env.example" > "${tmp}"
  printf '\n# Gerado por install.sh em %s\n' "$(date -u +%FT%TZ)" >> "${tmp}"
  install -m 0640 -o root -g "${OL_USER}" "${tmp}" "${OL_ENV_FILE}"
  rm -f "${tmp}"
  ok "arquivo criado com token de serviço aleatório e cookies Secure (somente root:${OL_USER} leem)"
else
  ok "arquivo existente preservado"
  chown root:"${OL_USER}" "${OL_ENV_FILE}"; chmod 0640 "${OL_ENV_FILE}"
fi
[[ -n "$(env_get ORBITLINK_API_TOKEN)" ]] || env_set ORBITLINK_API_TOKEN "$(random_token)"
[[ -n "$(env_get ORBITLINK_SETUP_CODE)" ]] || env_set ORBITLINK_SETUP_CODE "$(openssl rand -hex 4)-$(openssl rand -hex 4)"
env_set ORBITLINK_DATA_DIR "${OL_DATA}"
env_set ORBITLINK_HOST 127.0.0.1
env_set ORBITLINK_ALLOW_LAN false
env_set ORBITLINK_FIXTURE_FILE ""
if [[ ${ESP32} -eq 1 ]]; then env_set ORBITLINK_ESP32_ENABLED true; fi
install -m 0600 -o root -g root /dev/null "${OL_ETC}/setup-code"
printf '%s\n' "$(env_get ORBITLINK_SETUP_CODE)" > "${OL_ETC}/setup-code"

if [[ ! -f "${OL_ETC}/secrets.key" ]]; then
  # chave Fernet (32 bytes, base64 url-safe) — separada do diretório de dados/backup
  openssl rand -base64 32 | tr '+/' '-_' > "${OL_ETC}/secrets.key"
  ok "chave de segredos criada em ${OL_ETC}/secrets.key"
fi
chown root:"${OL_USER}" "${OL_ETC}/secrets.key"; chmod 0640 "${OL_ETC}/secrets.key"

if [[ ! -f "${OL_ETC}/tls/orbitlink.crt" ]]; then
  ip_now="$(lan_ip)"
  san="DNS:${SERVER_NAME},DNS:$(hostname),DNS:$(hostname).local,DNS:localhost,IP:127.0.0.1"
  [[ -n "${ip_now}" ]] && san="${san},IP:${ip_now}"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 825 \
    -subj "/CN=${SERVER_NAME}/O=OrbitLink AI (autoassinado)" -addext "subjectAltName=${san}" \
    -keyout "${OL_ETC}/tls/orbitlink.key" -out "${OL_ETC}/tls/orbitlink.crt" 2>/dev/null
  chmod 0600 "${OL_ETC}/tls/orbitlink.key"; chmod 0644 "${OL_ETC}/tls/orbitlink.crt"
  ok "certificado TLS autoassinado (${san})"
fi

# ================================================================= 5. build e release
step "Construindo a release a partir de ${SRC}"
NEW="$(build_release "${SRC}")"
switch_release "${NEW}"
ok "release ativa: ${NEW}"

# ================================================================= 6. systemd, CLI e backup
step "Serviços systemd"
for u in orbitlink-agent.service orbitlink-web.service orbitlink.target orbitlink-backup.service orbitlink-backup.timer; do
  render_unit "${SCRIPT_DIR}/systemd/${u}" "/etc/systemd/system/${u}"
done
install -m 0755 "${SCRIPT_DIR}/backup.sh" "${OL_LIBEXEC}/backup.sh"
install -m 0644 "${SCRIPT_DIR}/lib.sh" "${OL_LIBEXEC}/lib.sh"
install -m 0755 "${SCRIPT_DIR}/update.sh" "${OL_LIBEXEC}/update.sh"
install -m 0755 "${SCRIPT_DIR}/orbitlinkctl" /usr/local/bin/orbitlinkctl
printf '%s\n' "${SRC}" > "${OL_ETC}/source-dir"
systemctl daemon-reload
systemctl enable --now orbitlink.target orbitlink-agent.service orbitlink-web.service orbitlink-backup.timer >/dev/null
systemctl restart orbitlink-agent.service orbitlink-web.service
ok "orbitlink-agent, orbitlink-web e orbitlink-backup.timer habilitados (reinício automático em falhas)"

# ================================================================= 7. Nginx
step "Nginx (proxy reverso, somente LAN/Tailnet)"
LAN="${LAN:-$(lan_cidr)}"
[[ -n "${LAN}" ]] || die "não foi possível detectar a rede local; informe --lan-cidr 192.168.x.0/24"
is_private_cidr "${LAN}" || die "--lan-cidr precisa ser uma faixa privada (RFC 1918), recebido: ${LAN}"
# A faixa do Tailscale (100.64.0.0/10) é a mesma da CGNAT da Starlink: só entra na ACL se o Tailscale existir.
TAILNET=0
if [[ ${WITH_TAILSCALE} -eq 1 ]] || tailscale_present; then TAILNET=1; fi
nginx_acl "${LAN}" "${TAILNET}" > /etc/nginx/snippets/orbitlink-acl.conf
install -m 0644 "${SCRIPT_DIR}/nginx/orbitlink-proxy.conf" /etc/nginx/snippets/orbitlink-proxy.conf
# Só estes nomes (mais IPs literais e *.ts.net, já no modelo) são aceitos no "Host"; o resto recebe 444.
NAMES="$(nginx_server_names "${SERVER_NAME}" "$(hostname)" "$(hostname).local")"
sed "s|__SERVER_NAME__|${NAMES}|" "${SCRIPT_DIR}/nginx/orbitlink.conf" > /etc/nginx/sites-available/orbitlink
ln -sfn /etc/nginx/sites-available/orbitlink /etc/nginx/sites-enabled/orbitlink
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
  info "site 'default' do Nginx desabilitado (o arquivo original permanece em sites-available)"
fi
nginx -t 2>&1 | sed 's/^/    /'
systemctl enable --now nginx >/dev/null
systemctl reload nginx
if [[ ${TAILNET} -eq 1 ]]; then ok "Nginx ativo; ACL: LAN ${LAN} + Tailscale"
else ok "Nginx ativo; ACL: somente LAN ${LAN} (Tailscale ausente; a faixa 100.64.0.0/10 não foi liberada)"; fi
info "nomes aceitos no Host: ${NAMES}, IPs literais e *.ts.net"

# ================================================================= 8. Tailscale (opcional)
if [[ ${WITH_TAILSCALE} -eq 1 ]]; then
  step "Tailscale (opcional)"
  if ! command -v tailscale >/dev/null 2>&1; then
    curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${VERSION_CODENAME}.noarmor.gpg" \
      -o /usr/share/keyrings/tailscale-archive-keyring.gpg
    curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${VERSION_CODENAME}.tailscale-keyring.list" \
      -o /etc/apt/sources.list.d/tailscale.list
    apt-get update -qq && apt-get install -y -qq tailscale >/dev/null
  fi
  systemctl enable --now tailscaled >/dev/null
  if tailscale status >/dev/null 2>&1; then
    ok "Tailscale conectado: $(tailscale ip -4 2>/dev/null | head -n1)"
  else
    warn "Tailscale instalado, mas não autenticado. Execute:  sudo tailscale up"
  fi
fi

# ================================================================= 9. UFW
if [[ ${FIREWALL} -eq 1 ]]; then
  step "Firewall (UFW): negar entrada por padrão"
  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  # SSH primeiro, para não perder o acesso
  ufw limit from "${LAN}" to any port 22 proto tcp comment 'orbitlink: ssh lan' >/dev/null
  # Sessões SSH ativas vindas de fora da LAN são liberadas explicitamente para não trancar você fora.
  # (o sudo descarta SSH_CONNECTION; por isso consultamos as conexões estabelecidas na porta 22)
  while read -r peer; do
    [[ -n "${peer}" ]] || continue
    if ! python3 - "${peer}" "${LAN}" <<'PY' 2>/dev/null; then
import ipaddress, sys
a = ipaddress.ip_address(sys.argv[1])
inside = a.is_loopback or a in ipaddress.ip_network(sys.argv[2]) or a in ipaddress.ip_network("100.64.0.0/10")
sys.exit(0 if inside else 1)
PY
      ufw limit from "${peer}" to any port 22 proto tcp comment 'orbitlink: ssh sessao atual' >/dev/null
      warn "sessão SSH ativa de ${peer} (fora de ${LAN}) liberada explicitamente"
    fi
  done < <(ss -Htn state established '( sport = :22 )' 2>/dev/null | awk '{print $4}' \
             | sed -E 's/^\[?(.*[^]])\]?:[0-9]+$/\1/' | sort -u)
  ufw allow from "${LAN}" to any port 80,443 proto tcp comment 'orbitlink: painel lan' >/dev/null
  if [[ "$(env_get ORBITLINK_ESP32_ENABLED)" == "true" ]]; then
    ufw allow from "${LAN}" to any port 8788 proto tcp comment 'orbitlink: esp32 lan' >/dev/null
  fi
  if [[ ${TAILNET} -eq 1 ]]; then
    ufw allow in on tailscale0 to any port 22 proto tcp comment 'orbitlink: ssh tailnet' >/dev/null
    ufw allow in on tailscale0 to any port 80,443 proto tcp comment 'orbitlink: painel tailnet' >/dev/null
  fi
  ufw --force enable >/dev/null
  ok "UFW ativo. Regras:"
  ufw status | sed 's/^/    /'
else
  warn "UFW não configurado (--no-firewall). O Nginx ainda restringe por IP, mas o firewall é recomendado."
fi

# ================================================================= 10. SSH (opcional)
if [[ ${HARDEN_SSH} -eq 1 ]]; then
  step "Endurecimento do SSH"
  admin_user="${SUDO_USER:-}"
  keys="$(getent passwd "${admin_user}" | cut -d: -f6)/.ssh/authorized_keys"
  if [[ -z "${admin_user}" || ! -s "${keys}" ]]; then
    warn "nenhuma chave em ${keys:-~/.ssh/authorized_keys} do usuário que executou o sudo — endurecimento NÃO aplicado"
  elif confirm "Desativar login por senha e root via SSH (chave de ${admin_user} encontrada)?"; then
    install -m 0644 "${SCRIPT_DIR}/ssh/50-orbitlink-hardening.conf" /etc/ssh/sshd_config.d/50-orbitlink-hardening.conf
    if sshd -t; then
      systemctl reload ssh
      ok "SSH endurecido (mantenha esta sessão aberta e teste um novo login antes de sair)"
    else
      rm -f /etc/ssh/sshd_config.d/50-orbitlink-hardening.conf
      warn "configuração inválida; alteração revertida"
    fi
  fi
fi

# ================================================================= 11. verificação
step "Verificação"
if health_check 40; then
  ok "instalação concluída"
else
  warn "algum serviço não respondeu — veja: sudo orbitlinkctl doctor"
fi
ss -ltn '( sport = :8787 or sport = :3000 )' | awk 'NR>1 {print "    escutando em " $4}'

IP_SHOW="$(lan_ip)"
cat <<EOF

${C_BOLD}Pronto.${C_RESET}
  Painel:            https://${IP_SHOW:-<ip-do-servidor>}/   (certificado autoassinado: aceite o aviso do navegador)
  Código de setup:   sudo cat ${OL_ETC}/setup-code     (pedido ao criar o primeiro administrador)
  Diagnóstico:       sudo orbitlinkctl diagnose
  Estado/logs:       sudo orbitlinkctl status | sudo orbitlinkctl logs agent -f
  Configuração:      sudo nano ${OL_ENV_FILE}  &&  sudo orbitlinkctl restart
  Guia completo:     ${SRC}/docs/LINUX_SERVER.md
EOF
