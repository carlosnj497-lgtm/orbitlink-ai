#!/usr/bin/env bash
# ASTRYON — prepara um Raspberry Pi (Raspberry Pi OS Lite 64 bits) como "aparelho pronto".
#
#   git clone https://github.com/<você>/astryon.git ~/astryon && cd ~/astryon
#   sudo bash deploy/appliance/prepare-pi.sh --supabase-url https://xxxx.supabase.co --anon-key <chave anon>
#
# Depois disso, quem recebe o aparelho só precisa: ligar na tomada, conectar ao Wi-Fi/cabo da Starlink e abrir
# http://astryon.local/aparelho no celular para digitar o código da conta. Nada de terminal nem .env.
#
# O que o script faz:
#   1. Nome "astryon" na rede (mDNS: astryon.local) via avahi.
#   2. Instalação padrão do ASTRYON (deploy/linux/install.sh: systemd, Nginx com HTTPS, UFW).
#   3. Modo aparelho (ASTRYON_APPLIANCE=true) e o endereço da nuvem (público: URL e chave anon do Supabase).
#   4. Página de configuração em HTTP simples na rede local (http://astryon.local/aparelho), para o celular
#      abrir sem aviso de certificado. O resto do painel continua só em HTTPS.
#
# Requer Raspberry Pi 4/5 (2 GB+ de RAM) ou outro computador ARM64/x86-64 com Debian 12/13. NÃO testado em todo
# hardware: confira o fim da execução e o guia docs/APARELHO.md.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=deploy/linux/lib.sh
. "${ROOT}/deploy/linux/lib.sh"

URL=""; ANON=""; NAME="astryon"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --supabase-url) URL="${2:?}"; shift 2 ;;
    --anon-key) ANON="${2:?}"; shift 2 ;;
    --hostname) NAME="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "opção desconhecida: $1" ;;
  esac
done
require_root
[[ "${URL}" == https://* && -n "${ANON}" ]] || die "informe --supabase-url https://... e --anon-key (Supabase → Settings → API)"
[[ "${NAME}" =~ ^[a-z0-9-]{1,40}$ ]] || die "--hostname: só letras minúsculas, números e hífen"

step "Nome na rede: ${NAME}.local"
hostnamectl set-hostname "${NAME}"
grep -q "127.0.1.1 ${NAME}" /etc/hosts || sed -i "s/^127\.0\.1\.1 .*/127.0.1.1 ${NAME}/" /etc/hosts
apt-get update -qq && apt-get install -y -qq avahi-daemon >/dev/null
systemctl enable --now avahi-daemon >/dev/null
ok "anunciado como ${NAME}.local"

step "Instalação padrão do ASTRYON"
bash "${ROOT}/deploy/linux/install.sh" --force-os --yes --server-name "${NAME}.local"

step "Modo aparelho e nuvem"
env_set ASTRYON_APPLIANCE true
env_set ASTRYON_SUPABASE_URL "${URL}"
env_set ASTRYON_SUPABASE_ANON_KEY "${ANON}"
env_set ASTRYON_TERMINAL_NAME "Starlink"
ok "configurado em ${OL_ENV_FILE}"

step "Página de configuração em HTTP na rede local"
# Só /aparelho, a API dele e os arquivos estáticos; o resto continua redirecionando para HTTPS.
cat > /etc/nginx/snippets/astryon-appliance.conf <<'NGX'
location = /aparelho { include /etc/nginx/snippets/astryon-proxy.conf; }
location ^~ /api/appliance/ { limit_req zone=astryon_auth burst=5 nodelay; include /etc/nginx/snippets/astryon-proxy.conf; }
location ^~ /_next/static/ { include /etc/nginx/snippets/astryon-proxy.conf; }
location ~ ^/(astryon-logo\.webp|login-bg\.webp|icons/) { include /etc/nginx/snippets/astryon-proxy.conf; }
NGX
SITE=/etc/nginx/sites-available/astryon
if ! grep -q "astryon-appliance.conf" "${SITE}"; then
  # Insere o snippet no servidor da porta 80 que aceita os nomes deste aparelho (o primeiro após o catch-all).
  python3 - "${SITE}" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
marker = "location / { try_files /.astryon-inexistente @https; }"
if marker not in s:
    sys.exit("modelo do Nginx inesperado: não achei o redirecionamento da porta 80")
s = s.replace(marker, "include /etc/nginx/snippets/astryon-appliance.conf;\n    " + marker, 1)
open(p, "w").write(s)
PY
fi
nginx -t 2>&1 | sed 's/^/    /'
systemctl reload nginx
systemctl restart astryon-agent.service astryon-web.service
wait_http "http://127.0.0.1:3000/aparelho" 60 || warn "o painel demorou a responder; confira: journalctl -u astryon-web -n 50"
ok "http://${NAME}.local/aparelho"

step "Pronto"
info "Entregue o aparelho. Quem recebe:"
info "  1. liga na tomada e no Wi-Fi/cabo da Starlink;"
info "  2. abre http://${NAME}.local/aparelho no celular (na mesma rede);"
info "  3. digita o código gerado em Conta → Conectar a antena."
