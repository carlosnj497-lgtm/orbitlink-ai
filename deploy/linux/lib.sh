#!/usr/bin/env bash
# OrbitLink AI — funções compartilhadas pelos scripts de implantação Linux (install.sh, update.sh, orbitlinkctl).
# Este arquivo é "sourced"; não execute diretamente.
# shellcheck disable=SC2034  # variáveis usadas pelos scripts que carregam esta biblioteca

# ---------------------------------------------------------------- caminhos padrão (sobrescrevíveis por ambiente)
OL_USER="${OL_USER:-orbitlink}"
OL_PREFIX="${OL_PREFIX:-/opt/orbitlink}"
OL_RELEASES="${OL_PREFIX}/releases"
OL_CURRENT="${OL_PREFIX}/current"
OL_DATA="${OL_DATA:-/var/lib/orbitlink}"
OL_ETC="${OL_ETC:-/etc/orbitlink}"
OL_ENV_FILE="${OL_ETC}/orbitlink.env"
OL_LIBEXEC="/usr/local/lib/orbitlink"
OL_KEEP_RELEASES="${OL_KEEP_RELEASES:-3}"
OL_AGENT_URL="http://127.0.0.1:8787"
OL_WEB_URL="http://127.0.0.1:3000"
OL_NODE_MAJOR="${OL_NODE_MAJOR:-22}"
OL_SERVICES=(orbitlink-agent.service orbitlink-web.service)

# ---------------------------------------------------------------- saída
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_BOLD=$'\e[1m'; C_CYAN=$'\e[36m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_RED=$'\e[31m'
else
  C_RESET=""; C_BOLD=""; C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""
fi
step() { printf '\n%s==> %s%s\n' "${C_CYAN}${C_BOLD}" "$*" "${C_RESET}"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s✔%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
warn() { printf '    %s⚠ %s%s\n' "${C_YELLOW}" "$*" "${C_RESET}" >&2; }
die()  { printf '%sERRO:%s %s\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$*" >&2; exit 1; }

require_root() {
  [[ ${EUID} -eq 0 ]] || die "execute com sudo (ex.: sudo $0)"
}

confirm() {
  # confirm "pergunta" -> 0 se sim. Com OL_ASSUME_YES=1 responde sim automaticamente.
  local q="$1" ans
  if [[ "${OL_ASSUME_YES:-0}" == "1" ]]; then return 0; fi
  if [[ ! -t 0 ]]; then return 1; fi
  read -r -p "    ${q} [s/N] " ans
  [[ "${ans}" =~ ^([sS]|[sS][iI][mM]|[yY])$ ]]
}

as_user() {
  # Executa como o usuário de serviço, com HOME e cache do npm próprios.
  runuser -u "${OL_USER}" -- env HOME="${OL_DATA}" npm_config_cache="${OL_DATA}/.npm" \
    PATH="/usr/local/bin:/usr/bin:/bin" "$@"
}

version_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]; }

node_bin() {
  # Node que o build (as_user) e o serviço do painel usam: o mesmo PATH do as_user, nunca um Node em /home ou /root
  # (nvm etc.), que o serviço não enxerga por causa do ProtectHome=yes. Imprime o caminho absoluto.
  local p
  p="$(PATH="/usr/local/bin:/usr/bin:/bin" command -v node 2>/dev/null)" || return 1
  p="$(readlink -f "${p}")"
  case "${p}" in /home/*|/root/*|/tmp/*|/run/user/*) return 1 ;; esac
  printf '%s\n' "${p}"
}

render_unit() {
  # render_unit ORIGEM DESTINO — instala a unidade systemd trocando o Node pelo caminho detectado
  local src="$1" dst="$2" node
  if [[ "$(basename "${src}")" == "orbitlink-web.service" ]]; then
    node="$(node_bin)" || die "Node.js não encontrado em /usr/local/bin ou /usr/bin"
    sed "s|^ExecStart=/usr/bin/node |ExecStart=${node} |" "${src}" > "${dst}.tmp"
  else
    cp "${src}" "${dst}.tmp"
  fi
  chmod 0644 "${dst}.tmp"
  mv -f "${dst}.tmp" "${dst}"
}

# ---------------------------------------------------------------- rede
default_iface() { ip -j route show default 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["dev"] if d else "")' 2>/dev/null || true; }

lan_cidr() {
  # CIDR da interface da rota padrão (ex.: 192.168.1.0/24)
  local dev; dev="$(default_iface)"
  [[ -n "${dev}" ]] || return 0
  ip -j -4 addr show dev "${dev}" 2>/dev/null | python3 -c '
import ipaddress, json, sys
d = json.load(sys.stdin)
for i in d:
    for a in i.get("addr_info", []):
        if a.get("family") == "inet":
            print(ipaddress.ip_interface("%s/%s" % (a["local"], a["prefixlen"])).network); raise SystemExit
' 2>/dev/null || true
}

lan_ip() {
  local dev; dev="$(default_iface)"
  [[ -n "${dev}" ]] || return 0
  ip -j -4 addr show dev "${dev}" 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next((a["local"] for i in d for a in i.get("addr_info",[]) if a.get("family")=="inet"), ""))' 2>/dev/null || true
}

is_private_cidr() {
  python3 - "$1" <<'PY' 2>/dev/null
import ipaddress, sys
n = ipaddress.ip_network(sys.argv[1], strict=False)
sys.exit(0 if (n.is_private and not n.is_loopback and n.prefixlen >= 8) else 1)
PY
}

tailscale_present() { command -v tailscale >/dev/null 2>&1 || ip link show tailscale0 >/dev/null 2>&1; }

nginx_acl() {
  # nginx_acl LAN_CIDR [COM_TAILSCALE] -> conteúdo de /etc/nginx/snippets/orbitlink-acl.conf
  # 100.64.0.0/10 é a faixa do Tailscale, mas também a CGNAT da Starlink: só é liberada quando o Tailscale existe.
  local lan="$1" ts="${2:-0}"
  echo "# Gerado por install.sh — quem pode acessar o painel"
  echo "allow 127.0.0.1;"
  echo "allow ::1;"
  echo "allow ${lan};"
  if [[ "${ts}" == "1" ]]; then
    echo "allow 100.64.0.0/10;           # Tailscale (CGNAT)"
    echo "allow fd7a:115c:a1e0::/48;     # Tailscale IPv6"
  fi
  echo "deny all;"
}

nginx_server_names() {
  # nginx_server_names NOME... -> nomes sem repetição, na ordem recebida, separados por espaço (server_name)
  local out="" n
  for n in "$@"; do
    if [[ -n "${n}" && " ${out} " != *" ${n} "* ]]; then out="${out:+${out} }${n}"; fi
  done
  echo "${out}"
}

env_get() {
  # env_get CHAVE -> valor no arquivo de ambiente (sem expandir nada)
  [[ -r "${OL_ENV_FILE}" ]] || return 0
  sed -n "s/^$1=//p" "${OL_ENV_FILE}" | tail -n1
}

public_env() {
  # public_env ARQUIVO -> linhas NEXT_PUBLIC_*=valor, lidas como o systemd lê o EnvironmentFile.
  # Nunca faz "source": um valor com espaço (ORBITLINK_TERMINAL_NAME=Starlink Mini) viraria comando no bash.
  local line k v
  [[ -r "$1" ]] || return 0
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ "${line}" =~ ^[[:space:]]*(NEXT_PUBLIC_[A-Z0-9_]+)=(.*)$ ]] || continue
    k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"
    if [[ "${v}" =~ ^\"(.*)\"$ ]] || [[ "${v}" =~ ^\'(.*)\'$ ]]; then v="${BASH_REMATCH[1]}"; fi
    printf '%s=%s\n' "${k}" "${v}"
  done < "$1"
}

env_set() {
  # env_set CHAVE VALOR -> grava/atualiza a chave no arquivo de ambiente, preservando o resto
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" "${OL_ENV_FILE}"; then
    awk -v k="${key}" -v v="${val}" 'BEGIN{FS=OFS="="} $1==k {print k"="v; next} {print}' "${OL_ENV_FILE}" > "${tmp}"
  else
    cat "${OL_ENV_FILE}" > "${tmp}"; printf '%s=%s\n' "${key}" "${val}" >> "${tmp}"
  fi
  install -m 0640 -o root -g "${OL_USER}" "${tmp}" "${OL_ENV_FILE}"
  rm -f "${tmp}"
}

random_token() { openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n' | cut -c1-48; }

# ---------------------------------------------------------------- releases
current_release() { readlink -f "${OL_CURRENT}" 2>/dev/null || true; }

previous_release() {
  local cur; cur="$(current_release)"
  find "${OL_RELEASES}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -r | while read -r r; do
    if [[ "${OL_RELEASES}/${r}" != "${cur}" && -f "${OL_RELEASES}/${r}/.orbitlink-release-ok" ]]; then echo "${OL_RELEASES}/${r}"; break; fi
  done
}

switch_release() {
  local target="$1"
  ln -sfn "${target}" "${OL_CURRENT}.tmp"
  mv -Tf "${OL_CURRENT}.tmp" "${OL_CURRENT}"
}

build_release() {
  # build_release ORIGEM -> imprime o caminho da nova release (código + venv + node_modules + build)
  # Chamada como NEW="$(build_release ...)": dentro de $(...) o bash desliga o set -e, então religamos aqui
  # para que qualquer passo que falhe interrompa a release em vez de seguir adiante.
  set -e
  local src="$1" stamp dest
  local -a pub=()
  [[ -f "${src}/apps/agent/pyproject.toml" && -f "${src}/package.json" ]] || die "origem inválida: ${src}"
  stamp="$(date -u +%Y%m%d%H%M%S)"
  dest="${OL_RELEASES}/${stamp}"
  install -d -o "${OL_USER}" -g "${OL_USER}" -m 0755 "${dest}"
  rsync -a --delete \
    --exclude '.git/' --exclude 'node_modules/' --exclude '.venv/' --exclude '.next/' --exclude 'data/' \
    --exclude '.env' --exclude 'tools-venv/' --exclude 'apps/esp32-firmware/.pio/' --exclude 'test-results/' \
    --exclude 'playwright-report/' --exclude '*.sqlite3*' --exclude '/apps/agent/build/' \
    "${src}/" "${dest}/" >&2
  chown -R "${OL_USER}:${OL_USER}" "${dest}"

  info "Ambiente virtual Python (versões travadas em requirements.lock, com hash)…" >&2
  [[ -f "${dest}/apps/agent/requirements.lock" ]] || die "apps/agent/requirements.lock ausente (rode: npm run lock:agent)"
  local vpy="${dest}/apps/agent/.venv/bin/python"
  as_user python3 -m venv "${dest}/apps/agent/.venv" >&2
  as_user "${vpy}" -m pip install --quiet --upgrade pip >&2
  # Dependências: exatamente as versões testadas, e o pip recusa qualquer arquivo cujo hash não confira
  as_user "${vpy}" -m pip install --quiet --no-cache-dir --require-hashes -r "${dest}/apps/agent/requirements.lock" >&2
  # O próprio agente, sem resolver dependências de novo
  as_user "${vpy}" -m pip install --quiet --no-cache-dir --no-deps "${dest}/apps/agent" >&2
  as_user "${vpy}" -m pip check >&2 || die "dependências Python inconsistentes (pip check)"
  as_user "${vpy}" -c "import orbitlink_agent, grpc, fastapi, httpx, cryptography" >&2

  info "Dependências Node e build do painel…" >&2
  # As variáveis NEXT_PUBLIC_* são embutidas no build: passa só elas, sem executar o arquivo de ambiente.
  mapfile -t pub < <(public_env "${OL_ENV_FILE}")
  as_user env "${pub[@]}" NEXT_TELEMETRY_DISABLED=1 bash -c "set -euo pipefail; cd '${dest}'; \
    npm ci --no-audit --no-fund --loglevel=error; npm run build -w apps/web" >&2 \
    || die "build do painel falhou (mensagens do npm acima)"
  [[ -d "${dest}/apps/web/.next" ]] || die "build do painel não gerou .next"
  install -d -o "${OL_USER}" -g "${OL_USER}" "${dest}/apps/web/.next/cache"
  touch "${dest}/.orbitlink-release-ok"
  echo "${dest}"
}

prune_releases() {
  local cur prev
  cur="$(current_release)"; prev="$(previous_release)"
  find "${OL_RELEASES}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +"$((OL_KEEP_RELEASES + 1))" |
    while read -r r; do
      local path="${OL_RELEASES}/${r}"
      [[ "${path}" == "${cur}" || "${path}" == "${prev}" ]] && continue
      rm -rf --one-file-system "${path}"
      info "release antiga removida: ${r}"
    done
}

# ---------------------------------------------------------------- saúde
wait_http() {
  # wait_http URL [tentativas] -> 0 quando responde 2xx/3xx
  local url="$1" tries="${2:-40}" code
  for _ in $(seq 1 "${tries}"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${url}" || true)"
    [[ "${code}" =~ ^[23] ]] && return 0
    sleep 1.5
  done
  return 1
}

health_check() {
  local okall=0
  if wait_http "${OL_AGENT_URL}/v1/health" "${1:-40}"; then ok "agente responde em ${OL_AGENT_URL}"; else warn "agente não respondeu"; okall=1; fi
  if wait_http "${OL_WEB_URL}/login" "${1:-40}"; then ok "painel responde em ${OL_WEB_URL}"; else warn "painel não respondeu"; okall=1; fi
  return "${okall}"
}
