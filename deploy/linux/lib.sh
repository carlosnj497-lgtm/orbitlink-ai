#!/usr/bin/env bash
# ASTRYON — funções compartilhadas pelos scripts de implantação Linux (install.sh, update.sh, astryonctl).
# Este arquivo é "sourced"; não execute diretamente.
# shellcheck disable=SC2034  # variáveis usadas pelos scripts que carregam esta biblioteca

# ---------------------------------------------------------------- caminhos padrão (sobrescrevíveis por ambiente)
OL_USER="${OL_USER:-astryon}"
OL_PREFIX="${OL_PREFIX:-/opt/astryon}"
OL_RELEASES="${OL_PREFIX}/releases"
OL_CURRENT="${OL_PREFIX}/current"
OL_DATA="${OL_DATA:-/var/lib/astryon}"
OL_ETC="${OL_ETC:-/etc/astryon}"
OL_ENV_FILE="${OL_ETC}/astryon.env"
OL_LIBEXEC="/usr/local/lib/astryon"
# Código-fonte das releases: cópia de propriedade do root (nunca o clone do usuário, que outro processo pode alterar
# entre a checagem e o uso). src.git é um espelho "bare" usado por "update --git-pull".
OL_SRC="${OL_PREFIX}/src"
OL_SRC_GIT="${OL_PREFIX}/src.git"
OL_TLS="${OL_TLS:-${OL_ETC}/tls}"
OL_KEEP_RELEASES="${OL_KEEP_RELEASES:-3}"
OL_AGENT_URL="http://127.0.0.1:8787"
OL_WEB_URL="http://127.0.0.1:3000"
OL_NODE_MAJOR="${OL_NODE_MAJOR:-22}"
OL_SERVICES=(astryon-agent.service astryon-web.service)

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
  if [[ "$(basename "${src}")" == "astryon-web.service" ]]; then
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
  # nginx_acl LAN_CIDR [COM_TAILSCALE] -> conteúdo de /etc/nginx/snippets/astryon-acl.conf
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

env_lines() {
  # env_lines ARQUIVO [PREFIXO] -> linhas CHAVE=valor lidas como o systemd lê o EnvironmentFile (aspas externas
  # removidas, CR do Windows removido, comentários ignorados). Nunca faz "source": um valor com espaço
  # (ASTRYON_TERMINAL_NAME=Starlink Mini) ou com $(...) viraria comando no bash.
  local prefix="${2:-}" line k v
  [[ -r "$1" ]] || return 0
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ "${line}" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"
    [[ -z "${prefix}" || "${k}" == "${prefix}"* ]] || continue
    if [[ "${v}" =~ ^\"(.*)\"$ ]] || [[ "${v}" =~ ^\'(.*)\'$ ]]; then v="${BASH_REMATCH[1]}"; fi
    printf '%s=%s\n' "${k}" "${v}"
  done < "$1"
}

public_env() {
  # public_env ARQUIVO -> só as linhas NEXT_PUBLIC_*=valor (embutidas no build do painel)
  env_lines "$1" NEXT_PUBLIC_
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

# ---------------------------------------------------------------- arquivos de configuração (rollback)
backup_files() {
  # backup_files DIR ARQUIVO... -> copia arquivos absolutos e registra também os que não existiam.
  local dir="$1" path saved
  shift
  for path in "$@"; do
    [[ "${path}" == /* ]] || { warn "backup exige caminho absoluto: ${path}"; return 1; }
    saved="${dir}/files${path}"
    mkdir -p "$(dirname "${saved}")"
    if [[ -e "${path}" || -L "${path}" ]]; then
      cp -a -- "${path}" "${saved}"
    else
      : > "${saved}.absent"
    fi
  done
}

restore_files() {
  # restore_files DIR ARQUIVO... -> restaura o backup e remove arquivos que não existiam antes.
  local dir="$1" path saved
  shift
  for path in "$@"; do
    saved="${dir}/files${path}"
    if [[ -e "${saved}" || -L "${saved}" ]]; then
      mkdir -p "$(dirname "${path}")"
      rm -f -- "${path}"
      cp -a -- "${saved}" "${path}"
    elif [[ -f "${saved}.absent" ]]; then
      rm -f -- "${path}"
    else
      warn "backup ausente para ${path}"
      return 1
    fi
  done
}

# ---------------------------------------------------------------- código-fonte (cópia do root)
src_replace_from_tar() {
  # Lê um tar da entrada padrão e troca ${OL_SRC} de uma vez. Extrai como root numa pasta nova e vazia,
  # sem donos/permissões do arquivo; o GNU tar recusa caminhos absolutos e "..".
  local new="${OL_SRC}.new"
  rm -rf --one-file-system "${new}" "${OL_SRC}.old"
  install -d -o root -g root -m 0755 "${new}"
  tar -x -C "${new}" --no-same-owner --no-same-permissions -f - || { rm -rf --one-file-system "${new}"; return 1; }
  chmod -R go-w "${new}"
  [[ -f "${new}/apps/agent/pyproject.toml" && -f "${new}/package.json" ]] \
    || { rm -rf --one-file-system "${new}"; die "o código importado não parece o ASTRYON (falta package.json/pyproject.toml)"; }
  if [[ -d "${OL_SRC}" ]]; then mv -T "${OL_SRC}" "${OL_SRC}.old"; fi
  mv -T "${new}" "${OL_SRC}"
  rm -rf --one-file-system "${OL_SRC}.old"
}

src_commit() { cat "${OL_SRC}/.astryon-commit" 2>/dev/null || true; }

src_import_dir() {
  # src_import_dir DIR -> copia o último COMMIT de DIR (um clone de usuário) para ${OL_SRC}.
  # Todo comando dentro de DIR roda como o DONO de DIR, nunca como root: hooks e config do repositório (que o
  # dono controla) não ganham privilégio. Alterações não commitadas ficam de fora.
  local dir="$1" owner commit
  [[ -d "${dir}" ]] || die "pasta de origem não encontrada: ${dir}"
  owner="$(stat -c %U "${dir}")"
  if commit="$(runuser -u "${owner}" -- git -C "${dir}" rev-parse --verify -q 'HEAD^{commit}' 2>/dev/null)"; then
    if [[ -n "$(runuser -u "${owner}" -- git -C "${dir}" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
      warn "há alterações não commitadas em ${dir}: elas NÃO entram na release (só o commit ${commit:0:12})"
    fi
    runuser -u "${owner}" -- git -C "${dir}" archive --format=tar "${commit}" | src_replace_from_tar \
      || die "não foi possível copiar o commit ${commit:0:12} de ${dir}"
  else
    warn "${dir} não é um clone git: copiando os arquivos como estão (sem commit para auditar)"
    commit="sem-git-$(date -u +%Y%m%d%H%M%S)"
    runuser -u "${owner}" -- tar -C "${dir}" -c -f - --exclude-vcs --exclude=node_modules --exclude=.venv \
      --exclude=.next --exclude=data --exclude=tools-venv --exclude=.pio --exclude='*.sqlite3*' --exclude=.env . \
      | src_replace_from_tar || die "não foi possível copiar ${dir}"
  fi
  printf '%s\n' "${commit}" > "${OL_SRC}/.astryon-commit"
  ok "código copiado para ${OL_SRC} (commit ${commit:0:12})"
}

src_record_remote() {
  # src_record_remote DIR -> guarda o "origin" do clone do usuário para o "update --git-pull" buscar direto dele
  local dir="$1" owner url
  owner="$(stat -c %U "${dir}" 2>/dev/null)" || return 0
  url="$(runuser -u "${owner}" -- git -C "${dir}" remote get-url origin 2>/dev/null || true)"
  case "${url}" in
    https://*|ssh://*|git@*) printf '%s\n' "${url}" > "${OL_ETC}/git-remote"; info "remoto registrado: ${url}" ;;
    *) : ;;
  esac
}

src_git_pull() {
  # Atualiza ${OL_SRC} buscando o branch padrão do remoto num espelho bare de propriedade do root.
  # Só avança (fast-forward) em relação ao commit instalado. Com ${OL_ETC}/allowed-signers presente, exige
  # commit assinado (SSH) por uma das chaves listadas.
  local url target prev signers="${OL_ETC}/allowed-signers"
  url="$(cat "${OL_ETC}/git-remote" 2>/dev/null || true)"
  [[ -n "${url}" ]] || die "nenhum remoto registrado em ${OL_ETC}/git-remote. Use: git pull no seu clone e depois sudo astryonctl update"
  if [[ ! -d "${OL_SRC_GIT}" ]]; then
    git clone --bare --quiet "${url}" "${OL_SRC_GIT}" \
      || die "não foi possível clonar ${url} como root (repositório privado?). Use: git pull no seu clone e depois sudo astryonctl update"
  else
    git --git-dir="${OL_SRC_GIT}" fetch --quiet --prune --tags "${url}" '+refs/heads/*:refs/heads/*' \
      || die "git fetch falhou (${url})"
  fi
  target="$(git --git-dir="${OL_SRC_GIT}" rev-parse --verify -q 'HEAD^{commit}')" || die "o remoto não tem branch padrão"
  prev="$(src_commit)"
  if [[ -n "${prev}" ]] && git --git-dir="${OL_SRC_GIT}" cat-file -e "${prev}^{commit}" 2>/dev/null; then
    git --git-dir="${OL_SRC_GIT}" merge-base --is-ancestor "${prev}" "${target}" \
      || die "o remoto não descende do commit instalado (${prev:0:12}): histórico reescrito? Recusando."
  fi
  if [[ -f "${signers}" ]]; then
    git --git-dir="${OL_SRC_GIT}" -c gpg.ssh.allowedSignersFile="${signers}" verify-commit "${target}" >/dev/null 2>&1 \
      || die "o commit ${target:0:12} não tem assinatura válida de ${signers}"
    ok "assinatura do commit ${target:0:12} conferida"
  else
    warn "commit ${target:0:12} não verificado (crie ${signers} para exigir commits assinados)"
  fi
  git --git-dir="${OL_SRC_GIT}" archive --format=tar "${target}" | src_replace_from_tar || die "falha ao extrair ${target:0:12}"
  printf '%s\n' "${target}" > "${OL_SRC}/.astryon-commit"
  ok "código em ${OL_SRC}: commit ${target:0:12}"
}

# ---------------------------------------------------------------- certificado TLS autoassinado
cert_create() {
  # cert_create CN SAN -> (re)gera o certificado autoassinado em ${OL_TLS}, trocando os arquivos de uma vez
  local cn="$1" san="$2" tmp
  [[ -d "${OL_TLS}" ]] || install -d -o root -g root -m 0755 "${OL_TLS}"
  tmp="$(mktemp -d "${OL_TLS}/.novo.XXXXXX")"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 825 \
    -subj "/CN=${cn}/O=ASTRYON (autoassinado)" -addext "subjectAltName=${san}" \
    -keyout "${tmp}/astryon.key" -out "${tmp}/astryon.crt" 2>/dev/null || { rm -rf "${tmp}"; return 1; }
  chmod 0600 "${tmp}/astryon.key"; chmod 0644 "${tmp}/astryon.crt"
  mv -f "${tmp}/astryon.key" "${OL_TLS}/astryon.key"
  mv -f "${tmp}/astryon.crt" "${OL_TLS}/astryon.crt"
  rmdir "${tmp}"
}

cert_san() {
  # cert_san [NOME] -> SAN padrão: nome informado, hostname, hostname.local, localhost e os IPs (loopback e LAN)
  local name="${1:-}" ip_now san
  ip_now="$(lan_ip)"
  san="$(nginx_server_names "${name}" "$(hostname)" "$(hostname).local" localhost | sed 's/\([^ ][^ ]*\)/DNS:\1/g; s/ /,/g')"
  san="${san},IP:127.0.0.1"
  [[ -n "${ip_now}" ]] && san="${san},IP:${ip_now}"
  echo "${san}"
}

cert_days_left() {
  # cert_days_left ARQUIVO -> dias até expirar (negativo se já expirou); vazio se ilegível
  local end
  end="$(openssl x509 -enddate -noout -in "$1" 2>/dev/null | cut -d= -f2)" || return 0
  [[ -n "${end}" ]] || return 0
  echo $(( ( $(date -d "${end}" +%s) - $(date +%s) ) / 86400 ))
}

# ---------------------------------------------------------------- releases
current_release() { readlink -f "${OL_CURRENT}" 2>/dev/null || true; }

previous_release() {
  local cur; cur="$(current_release)"
  find "${OL_RELEASES}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -r | while read -r r; do
    if [[ "${OL_RELEASES}/${r}" != "${cur}" && -f "${OL_RELEASES}/${r}/.astryon-release-ok" ]]; then echo "${OL_RELEASES}/${r}"; break; fi
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
  as_user "${vpy}" -c "import astryon_agent, grpc, fastapi, httpx, cryptography" >&2

  info "Dependências Node e build do painel…" >&2
  # As variáveis NEXT_PUBLIC_* são embutidas no build: passa só elas, sem executar o arquivo de ambiente.
  mapfile -t pub < <(public_env "${OL_ENV_FILE}")
  as_user env "${pub[@]}" NEXT_TELEMETRY_DISABLED=1 bash -c "set -euo pipefail; cd '${dest}'; \
    npm ci --no-audit --no-fund --loglevel=error; npm run build -w apps/web" >&2 \
    || die "build do painel falhou (mensagens do npm acima)"
  [[ -d "${dest}/apps/web/.next" ]] || die "build do painel não gerou .next"
  install -d -o "${OL_USER}" -g "${OL_USER}" "${dest}/apps/web/.next/cache"
  touch "${dest}/.astryon-release-ok"
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

install_health_check() {
  # Instalação só pode anunciar sucesso depois que agente e painel responderem.
  if health_check "${1:-40}"; then
    ok "instalação concluída"
    return 0
  fi
  warn "algum serviço não respondeu — diagnóstico: sudo astryonctl doctor"
  return 1
}

rollback_update() {
  # rollback_update BACKUP RELEASE_ANTERIOR UNITS_ALTERADAS NGINX_ALTERADO ARQUIVO...
  # Restaura configuração e release como um conjunto; o chamador sempre termina com erro.
  local backup="$1" prev="$2" units_changed="$3" nginx_changed="$4"
  shift 4
  restore_files "${backup}" "$@" || return 1
  if [[ "${units_changed}" -eq 1 ]]; then
    systemctl daemon-reload || { warn "systemd não recarregou as unidades restauradas"; return 1; }
  fi
  if [[ "${nginx_changed}" -eq 1 ]]; then
    systemctl reload nginx || { warn "Nginx não recarregou a configuração restaurada"; return 1; }
  fi
  if [[ -z "${prev}" || ! -d "${prev}" ]]; then
    warn "release anterior não encontrada; configuração restaurada, mas não há release para ativar"
    return 1
  fi
  switch_release "${prev}"
  systemctl restart astryon-agent.service astryon-web.service || { warn "serviços não reiniciaram no rollback"; return 1; }
  if health_check 40; then
    ok "rollback concluído"
    return 0
  fi
  warn "rollback também não respondeu: sudo astryonctl doctor"
  return 1
}
