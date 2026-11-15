#!/usr/bin/env bash
# ASTRYON — HTTPS + firewall para a instalação que roda a partir da pasta do projeto (serviços
# orbitlink-agent/orbitlink-web apontando para o checkout, sem o /opt do install.sh).
#
#   sudo bash deploy/linux/https-local.sh            # aplica
#   sudo bash deploy/linux/https-local.sh --undo     # desfaz (volta o painel para a porta 3000)
#
# O que faz:
#   1. Nginx com HTTPS na rede de casa (certificado autoassinado: o navegador avisa uma vez).
#   2. Endereço do Tailscale (*.ts.net) com certificado VÁLIDO via `tailscale cert`, renovado toda semana.
#      Com ele o celular abre sem aviso e oferece "instalar app". Requer "HTTPS Certificates" ligado em
#      https://login.tailscale.com/admin/dns (uma vez).
#   3. O painel passa a escutar só em 127.0.0.1:3000 (o Nginx publica) e o cookie de sessão vira "Secure".
#   4. UFW: nega entrada por padrão; libera SSH e o painel (80/443) para a LAN e o Tailscale. As sessões SSH
#      abertas agora continuam liberadas. --no-firewall pula esta parte.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/linux/lib.sh
. "${SCRIPT_DIR}/lib.sh"

UNDO=0
FIREWALL=1
LAN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --undo) UNDO=1; shift ;;
    --no-firewall) FIREWALL=0; shift ;;
    --lan-cidr) LAN="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "opção desconhecida: $1" ;;
  esac
done
require_root

TLS_DIR=/etc/orbitlink/tls
DROPIN=/etc/systemd/system/orbitlink-web.service.d/20-https.conf
SITE=/etc/nginx/sites-available/orbitlink
WEB_UNIT=/etc/systemd/system/orbitlink-web.service
REPO_ENV="$(cd "${SCRIPT_DIR}/../.." && pwd)/.env"

repo_env_set() {
  # repo_env_set CHAVE VALOR -> grava no .env da raiz do projeto (o painel também o lê na inicialização)
  [[ -f "${REPO_ENV}" ]] || return 0
  local owner mode
  owner="$(stat -c '%u:%g' "${REPO_ENV}")"; mode="$(stat -c '%a' "${REPO_ENV}")"
  if grep -qE "^$1=" "${REPO_ENV}"; then sed -i -E "s|^$1=.*|$1=$2|" "${REPO_ENV}"
  else printf '%s=%s\n' "$1" "$2" >> "${REPO_ENV}"; fi
  chown "${owner}" "${REPO_ENV}"; chmod "${mode}" "${REPO_ENV}"  # o sed -i recria o arquivo como root
}

if [[ ${UNDO} -eq 1 ]]; then
  step "Desfazendo o HTTPS local"
  rm -f "${DROPIN}" /etc/nginx/sites-enabled/orbitlink
  repo_env_set ORBITLINK_COOKIE_SECURE false
  systemctl disable --now orbitlink-tscert.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/orbitlink-tscert.service /etc/systemd/system/orbitlink-tscert.timer
  systemctl daemon-reload
  systemctl restart orbitlink-web.service
  if systemctl is-active --quiet nginx; then systemctl reload nginx; fi
  ok "painel de volta em http://<IP>:3000 (o Nginx e o UFW continuam instalados; 'sudo ufw disable' desliga o firewall)"
  exit 0
fi

[[ -f "${WEB_UNIT}" ]] || die "não encontrei ${WEB_UNIT}; esta instalação usa outro layout (veja deploy/linux/install.sh)"

# ================================================================= 1. Nginx e certificado da LAN
step "Nginx"
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq nginx >/dev/null
fi
ok "Nginx $(nginx -v 2>&1 | sed 's/.*\///')"

install -d -o root -g root -m 0755 /etc/orbitlink "${TLS_DIR}"
if [[ ! -f "${TLS_DIR}/orbitlink.crt" ]]; then
  ip_now="$(lan_ip)"
  san="DNS:$(hostname),DNS:$(hostname).local,DNS:localhost,IP:127.0.0.1"
  [[ -n "${ip_now}" ]] && san="${san},IP:${ip_now}"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 825 \
    -subj "/CN=$(hostname)/O=ASTRYON (autoassinado)" -addext "subjectAltName=${san}" \
    -keyout "${TLS_DIR}/orbitlink.key" -out "${TLS_DIR}/orbitlink.crt" 2>/dev/null
  chmod 0600 "${TLS_DIR}/orbitlink.key"; chmod 0644 "${TLS_DIR}/orbitlink.crt"
  ok "certificado autoassinado da LAN (${san})"
else
  ok "certificado da LAN já existe"
fi

# ================================================================= 2. Certificado válido do Tailscale
TS_NAME=""
if tailscale_present && tailscale status >/dev/null 2>&1; then
  TS_NAME="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
  if tailscale cert --cert-file "${TLS_DIR}/ts.crt" --key-file "${TLS_DIR}/ts.key" "${TS_NAME}" >/dev/null 2>&1; then
    chmod 0600 "${TLS_DIR}/ts.key"; chmod 0644 "${TLS_DIR}/ts.crt"
    ok "certificado válido para https://${TS_NAME}"
    cat > /etc/systemd/system/orbitlink-tscert.service <<EOF
[Unit]
Description=ASTRYON - renova o certificado HTTPS do Tailscale
After=tailscaled.service

[Service]
Type=oneshot
ExecStart=/usr/bin/tailscale cert --cert-file ${TLS_DIR}/ts.crt --key-file ${TLS_DIR}/ts.key ${TS_NAME}
ExecStartPost=/bin/systemctl reload nginx
EOF
    cat > /etc/systemd/system/orbitlink-tscert.timer <<'EOF'
[Unit]
Description=ASTRYON - renovação semanal do certificado do Tailscale

[Timer]
OnCalendar=weekly
Persistent=true
RandomizedDelaySec=6h

[Install]
WantedBy=timers.target
EOF
  else
    warn "o Tailscale não emitiu certificado para ${TS_NAME}."
    warn "Ligue 'HTTPS Certificates' em https://login.tailscale.com/admin/dns e rode este script de novo."
    warn "Até lá, o endereço do Tailscale usa o certificado autoassinado (o navegador avisa)."
    TS_NAME=""
  fi
else
  info "Tailscale ausente ou desconectado: só a LAN recebe HTTPS"
fi

# ================================================================= 3. Site do Nginx
step "Site do Nginx (somente LAN e Tailscale)"
LAN="${LAN:-$(lan_cidr)}"
[[ -n "${LAN}" ]] || die "não foi possível detectar a rede local; informe --lan-cidr 192.168.x.0/24"
is_private_cidr "${LAN}" || die "--lan-cidr precisa ser uma faixa privada (RFC 1918), recebido: ${LAN}"
TAILNET=0
if tailscale_present; then TAILNET=1; fi
install -d -m 0755 /etc/nginx/snippets
nginx_acl "${LAN}" "${TAILNET}" > /etc/nginx/snippets/orbitlink-acl.conf
install -m 0644 "${SCRIPT_DIR}/nginx/orbitlink-proxy.conf" /etc/nginx/snippets/orbitlink-proxy.conf
NAMES="$(nginx_server_names "$(hostname)" "$(hostname).local")"
sed "s|__SERVER_NAME__|${NAMES}|" "${SCRIPT_DIR}/nginx/orbitlink.conf" > "${SITE}"
if [[ -n "${TS_NAME}" ]]; then
  # Mesmo conteúdo do servidor 443 do modelo, com o certificado do Tailscale e o nome exato (que vence o
  # padrão *.ts.net do bloco principal na escolha pelo SNI).
  awk -v name="${TS_NAME}" -v crt="${TLS_DIR}/ts.crt" -v key="${TLS_DIR}/ts.key" '
    { lines[NR] = $0 }
    END {
      # localiza o último bloco "server {" que contém "listen 443 ssl http2;" sem default_server
      start = 0
      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ /^server \{/) cand = i
        if (lines[i] ~ /listen 443 ssl http2;/ && lines[i] !~ /default_server/) start = cand
      }
      print "\n# Endereço do Tailscale com certificado válido (gerado por https-local.sh)"
      for (i = start; i <= NR; i++) {
        l = lines[i]
        if (l ~ /server_name /) { print "    server_name " name ";"; skip = 1; continue }
        if (skip && l ~ /^ +~/) continue
        skip = 0
        sub(/\/etc\/orbitlink\/tls\/orbitlink\.crt/, crt, l)
        sub(/\/etc\/orbitlink\/tls\/orbitlink\.key/, key, l)
        print l
      }
    }' "${SITE}" > "${SITE}.ts"
  cat "${SITE}.ts" >> "${SITE}"
  rm -f "${SITE}.ts"
fi
ln -sfn "${SITE}" /etc/nginx/sites-enabled/orbitlink
if [[ -L /etc/nginx/sites-enabled/default ]]; then rm -f /etc/nginx/sites-enabled/default; fi
nginx -t 2>&1 | sed 's/^/    /'
systemctl enable --now nginx >/dev/null
systemctl reload nginx
ok "Nginx publicando o painel para ${LAN}$([[ ${TAILNET} -eq 1 ]] && echo ' e o Tailscale')"

# ================================================================= 4. Painel só em loopback, cookie Secure
step "Painel atrás do Nginx"
exec_line="$(grep -m1 '^ExecStart=' "${WEB_UNIT}")"
[[ "${exec_line}" == *"-H 0.0.0.0"* || "${exec_line}" == *"-H 127.0.0.1"* ]] \
  || die "não reconheci o ExecStart de ${WEB_UNIT}; ajuste manualmente para escutar em 127.0.0.1"
install -d -m 0755 "$(dirname "${DROPIN}")"
cat > "${DROPIN}" <<EOF
# Gerado por deploy/linux/https-local.sh — remova com: sudo bash deploy/linux/https-local.sh --undo
[Service]
Environment=ORBITLINK_COOKIE_SECURE=true
ExecStart=
${exec_line/-H 0.0.0.0/-H 127.0.0.1}
EOF
repo_env_set ORBITLINK_COOKIE_SECURE true
systemctl daemon-reload
systemctl restart orbitlink-web.service
if [[ -n "${TS_NAME}" ]]; then systemctl enable --now orbitlink-tscert.timer >/dev/null; fi
wait_http "http://127.0.0.1:3000/login" 60 || warn "o painel demorou a responder; confira: journalctl -u orbitlink-web -n 50"
ok "painel em 127.0.0.1:3000 (não acessível direto pela rede) e cookie de sessão Secure"

# ================================================================= 5. Firewall
if [[ ${FIREWALL} -eq 1 ]]; then
  step "Firewall (UFW)"
  command -v ufw >/dev/null 2>&1 || apt-get install -y -qq ufw >/dev/null
  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  ufw limit from "${LAN}" to any port 22 proto tcp comment 'astryon: ssh lan' >/dev/null
  while read -r peer; do
    [[ -n "${peer}" ]] || continue
    ufw limit from "${peer}" to any port 22 proto tcp comment 'astryon: ssh sessao atual' >/dev/null
  done < <(ss -Htn state established '( sport = :22 )' 2>/dev/null | awk '{print $4}' \
             | sed -E 's/^\[?(.*[^]])\]?:[0-9]+$/\1/' | sort -u)
  ufw allow from "${LAN}" to any port 80,443 proto tcp comment 'astryon: painel lan' >/dev/null
  if [[ ${TAILNET} -eq 1 ]]; then
    ufw allow in on tailscale0 to any port 22 proto tcp comment 'astryon: ssh tailnet' >/dev/null
    ufw allow in on tailscale0 to any port 80,443 proto tcp comment 'astryon: painel tailnet' >/dev/null
  fi
  if grep -qE '^ORBITLINK_ESP32_ENABLED=true' "${SCRIPT_DIR}/../../.env" 2>/dev/null; then
    ufw allow from "${LAN}" to any port 8788 proto tcp comment 'astryon: esp32 lan' >/dev/null
  fi
  ufw --force enable >/dev/null
  ok "UFW ativo:"
  ufw status | sed 's/^/    /'
fi

step "Pronto"
info "Rede de casa:  https://$(lan_ip)/   (o navegador avisa uma vez sobre o certificado próprio)"
[[ -n "${TS_NAME}" ]] && info "Qualquer lugar (Tailscale):  https://${TS_NAME}/   (certificado válido; dá para instalar como app)"
info "Desfazer:  sudo bash deploy/linux/https-local.sh --undo"
