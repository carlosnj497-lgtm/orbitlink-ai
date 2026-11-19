#!/usr/bin/env bash
# Testes das funções puras de deploy/linux/lib.sh (rodam em qualquer bash; não exigem root nem Ubuntu).
#   bash deploy/linux/tests/test_lib.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
export OL_ETC="${TMP}/etc" OL_USER="${USER:-tester}"
mkdir -p "${OL_ETC}"
. "${HERE}/../lib.sh"

# stubs para ambientes sem root (install -o/-g) e sem "python3" no PATH (Windows/Git Bash)
install() { local src="" dst="" dir=0; while [[ $# -gt 0 ]]; do case "$1" in -m|-o|-g) shift 2 ;; -d) dir=1; shift ;; *) if [[ ${dir} -eq 1 ]]; then mkdir -p "$1"; shift; continue; fi; if [[ -z "${src}" ]]; then src="$1"; else dst="$1"; fi; shift ;; esac; done; [[ ${dir} -eq 1 ]] && return 0; cp "${src}" "${dst}"; }
if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'pass' >/dev/null 2>&1; then python3() { python "$@"; }; fi

fails=0
check() { if [[ "$2" == "$3" ]]; then echo "ok   - $1"; else echo "FAIL - $1: esperado [$3], obtido [$2]"; fails=$((fails + 1)); fi; }

cat > "${OL_ENV_FILE}" <<'EOF'
# comentário
ASTRYON_API_TOKEN=
ASTRYON_DATA_DIR=
ASTRYON_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.abc.def
EOF
env_set ASTRYON_API_TOKEN "tok-123_ABC"
env_set ASTRYON_DATA_DIR "/var/lib/astryon"
env_set ASTRYON_NOVA "valor novo"
check "env_set substitui valor vazio" "$(env_get ASTRYON_API_TOKEN)" "tok-123_ABC"
check "env_set substitui caminho" "$(env_get ASTRYON_DATA_DIR)" "/var/lib/astryon"
check "env_set acrescenta chave nova" "$(env_get ASTRYON_NOVA)" "valor novo"
check "valor com pontos preservado" "$(env_get ASTRYON_SUPABASE_ANON_KEY)" "eyJhbGciOiJIUzI1NiJ9.abc.def"
check "comentário preservado" "$(head -n1 "${OL_ENV_FILE}")" "# comentário"
check "sem chave duplicada" "$(grep -c '^ASTRYON_DATA_DIR=' "${OL_ENV_FILE}")" "1"
env_set ASTRYON_API_TOKEN "outro"
check "env_set idempotente" "$(grep -c '^ASTRYON_API_TOKEN=' "${OL_ENV_FILE}")" "1"

# public_env: lê só NEXT_PUBLIC_*, como o systemd, sem executar o arquivo (bug real do CI: "Mini: command not found")
PUB="${TMP}/pub.env"
# shellcheck disable=SC2016  # o $(...) literal é proposital: prova que o arquivo não é executado
printf '%s\n' '# x' 'ASTRYON_TERMINAL_NAME=Starlink Mini' 'NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co' \
  'NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ.a b.c"' "NEXT_PUBLIC_X='simples'" 'NEXT_PUBLIC_VAZIO=' \
  'NEXT_PUBLIC_CMD=$(touch '"${TMP}"'/pwned)' > "${PUB}"
printf 'NEXT_PUBLIC_CRLF=valor\r\n' >> "${PUB}"
out="$(public_env "${PUB}")"
check "public_env ignora variáveis não públicas" "$(grep -c '^ASTRYON_' <<<"${out}")" "0"
check "public_env mantém URL" "$(grep '^NEXT_PUBLIC_SUPABASE_URL=' <<<"${out}")" "NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co"
check "public_env tira aspas duplas e preserva espaço" "$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' <<<"${out}")" "NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ.a b.c"
check "public_env tira aspas simples" "$(grep '^NEXT_PUBLIC_X=' <<<"${out}")" "NEXT_PUBLIC_X=simples"
check "public_env aceita valor vazio" "$(grep -c '^NEXT_PUBLIC_VAZIO=$' <<<"${out}")" "1"
check "public_env remove CR de arquivo editado no Windows" "$(grep '^NEXT_PUBLIC_CRLF=' <<<"${out}" | od -c | grep -c '\\r')" "0"
check "public_env não executa nada" "$(test -e "${TMP}/pwned" && echo executou || echo nao)" "nao"
mapfile -t arr <<<"${out}"
# shellcheck disable=SC2016  # a variável é expandida pelo /bin/sh filho, não aqui
check "public_env vira argumentos de env sem quebrar em espaços" \
  "$(env -i "${arr[@]}" /bin/sh -c 'printf %s "$NEXT_PUBLIC_SUPABASE_ANON_KEY"')" "eyJ.a b.c"

if is_private_cidr 192.168.1.0/24; then r=sim; else r=nao; fi; check "192.168.1.0/24 é privada" "${r}" "sim"
if is_private_cidr 10.0.0.0/8; then r=sim; else r=nao; fi; check "10.0.0.0/8 é privada" "${r}" "sim"
if is_private_cidr 8.8.8.0/24; then r=sim; else r=nao; fi; check "8.8.8.0/24 NÃO é privada" "${r}" "nao"
if is_private_cidr 0.0.0.0/0; then r=sim; else r=nao; fi; check "0.0.0.0/0 recusada" "${r}" "nao"

if version_ge 22.11.0 20.9.0; then r=sim; else r=nao; fi; check "node 22.11 >= 20.9" "${r}" "sim"
if version_ge 20.8.1 20.9.0; then r=sim; else r=nao; fi; check "node 20.8.1 < 20.9" "${r}" "nao"
if version_ge 20.9.0 20.9.0; then r=sim; else r=nao; fi; check "igualdade de versão" "${r}" "sim"

tok="$(random_token)"
check "token aleatório com 48 caracteres url-safe" "$(printf '%s' "${tok}" | grep -cE '^[A-Za-z0-9_-]{48}$')" "1"

# --- detecção da rede (saída do "ip -j" simulada)
# shellcheck disable=SC2329  # stubs chamados indiretamente pelas funções da lib.sh
ip() {
  case "$*" in
    *"route show default"*) echo '[{"dst":"default","gateway":"192.168.1.1","dev":"eth0"}]' ;;
    *"addr show dev eth0"*) echo '[{"ifname":"eth0","addr_info":[{"family":"inet","local":"192.168.1.10","prefixlen":24},{"family":"inet6","local":"fe80::1","prefixlen":64}]}]' ;;
    *) return 1 ;;
  esac
}
check "interface da rota padrão" "$(default_iface | tr -d '\r')" "eth0"
check "CIDR da LAN detectado" "$(lan_cidr | tr -d '\r')" "192.168.1.0/24"
check "IP da LAN detectado" "$(lan_ip | tr -d '\r')" "192.168.1.10"
unset -f ip

# --- unidades systemd: o serviço do painel usa o Node detectado (ex.: /usr/local/bin), não um caminho fixo
UNITS="${HERE}/../systemd"
# shellcheck disable=SC2329
node_bin() { echo "/usr/local/bin/node"; }
render_unit "${UNITS}/astryon-web.service" "${TMP}/web.service"
check "unidade do painel usa o Node detectado" \
  "$(grep -c '^ExecStart=/usr/local/bin/node /opt/astryon/current/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000$' "${TMP}/web.service")" "1"
check "resto da unidade do painel intacto" "$(diff <(grep -v '^ExecStart=' "${UNITS}/astryon-web.service") <(grep -v '^ExecStart=' "${TMP}/web.service") && echo igual)" "igual"
render_unit "${UNITS}/astryon-agent.service" "${TMP}/agent.service"
check "unidade do agente copiada sem alteração" "$(cmp -s "${UNITS}/astryon-agent.service" "${TMP}/agent.service" && echo igual)" "igual"
# shellcheck disable=SC2329
if (node_bin() { return 1; }; render_unit "${UNITS}/astryon-web.service" "${TMP}/x.service") >/dev/null 2>&1; then r=sim; else r=nao; fi
check "sem Node acessível, a instalação da unidade falha (não grava caminho errado)" "${r}" "nao"
unset -f node_bin
. "${HERE}/../lib.sh"  # restaura node_bin original

# --- Nginx: nenhuma diretiva de valor único repetida entre o snippet do proxy e o location que o inclui
dups="$(python3 - "${HERE}/../nginx/astryon.conf" "${HERE}/../nginx/astryon-proxy.conf" <<'PY' | tr -d '\r'
import re, sys
REPEATABLE = {"proxy_set_header", "add_header", "limit_req", "include"}
def names(text):
    text = re.sub(r"#[^\n]*", "", text)
    return [s.split()[0] for s in text.split(";") if s.split()]
conf = open(sys.argv[1], encoding="utf-8").read()
snippet = names(open(sys.argv[2], encoding="utf-8").read())
found = set()
for body in re.findall(r"location[^{]*\{([^}]*)\}", conf):
    own = names(body)
    every = own + (snippet if "astryon-proxy.conf" in body else [])
    found |= {n for n in every if n not in REPEATABLE and every.count(n) > 1}
print(" ".join(sorted(found)))
PY
)"
check "sem diretiva duplicada nos locations (nginx -t recusaria)" "${dups}" ""

# --- Nginx: ACL
acl="$(nginx_acl 192.168.1.0/24 0)"
check "ACL sem Tailscale não libera a CGNAT (100.64.0.0/10)" "$(grep -c '100\.64\|fd7a' <<<"${acl}" || true)" "0"
check "ACL libera a LAN" "$(grep -c '^allow 192\.168\.1\.0/24;$' <<<"${acl}")" "1"
check "ACL termina em deny all" "$(tail -n1 <<<"${acl}")" "deny all;"
acl="$(nginx_acl 192.168.1.0/24 1)"
check "ACL com Tailscale libera a Tailnet (IPv4 e IPv6)" "$(grep -c '^allow \(100\.64\.0\.0/10\|fd7a:115c:a1e0::/48\);' <<<"${acl}")" "2"
check "ACL com Tailscale termina em deny all" "$(tail -n1 <<<"${acl}")" "deny all;"

# --- Nginx: nomes aceitos no Host
CONF="${HERE}/../nginx/astryon.conf"
check "nomes do servidor sem repetição" "$(nginx_server_names srv srv srv.local "")" "srv srv.local"
rendered="$(sed "s|__SERVER_NAME__|$(nginx_server_names srv srv srv.local)|" "${CONF}")"
check "modelo renderizado sem marcador" "$(grep -c '__SERVER_NAME__' <<<"${rendered}" || true)" "0"
check "nomes nos servidores 80 e 443" "$(grep -c 'server_name srv srv\.local localhost$' <<<"${rendered}")" "2"
check "catch-all é o único default_server e devolve 444" \
  "$(grep -c 'default_server' <<<"${rendered}")/$(grep -c '^    return 444;$' <<<"${rendered}")" "4/1"
check "nenhum server_name curinga fora do catch-all" "$(grep -c 'server_name .* _' <<<"${rendered}" || true)" "0"

host_matches() {
  # 0 se o Host casa com algum server_name em regex do modelo (as linhas que começam com "~")
  python3 - "$1" "${CONF}" <<'PY'
import re, sys
host = sys.argv[1]
with open(sys.argv[2], encoding="utf-8") as fh:
    patterns = set(re.findall(r"^\s+~(\S+?);?$", fh.read(), re.M))
assert len(patterns) == 3, patterns
sys.exit(0 if any(re.search(p, host) for p in patterns) else 1)
PY
}
for h in 192.168.1.10 100.101.102.103 127.0.0.1 "[fd7a:115c:a1e0::1]" orbit.tail1234.ts.net; do
  if host_matches "${h}"; then r=sim; else r=nao; fi; check "Host ${h} aceito" "${r}" "sim"
done
for h in atacante.com 192.168.1.10.atacante.com ts.net orbit.tail1234.ts.net.atacante.com a.b.c.ts.net; do
  if host_matches "${h}"; then r=sim; else r=nao; fi; check "Host ${h} recusado (444)" "${r}" "nao"
done

# --- Nginx: cabeçalhos de segurança valem também nos locations com add_header próprio (o Nginx não herda)
missing="$(python3 - "${CONF}" <<'PY' | tr -d '\r'
import re, sys
conf = re.sub(r"#[^\n]*", "", open(sys.argv[1], encoding="utf-8").read())
bad = [m.group(1).strip() for m in re.finditer(r"location([^{]*)\{([^}]*)\}", conf)
       if "add_header" in m.group(2) and "astryon-headers.conf" not in m.group(2)]
print(" ".join(bad))
PY
)"
check "location com add_header inclui astryon-headers.conf" "${missing}" ""
check "server 443 inclui os cabeçalhos" "$(grep -c 'include /etc/nginx/snippets/astryon-headers.conf;' "${CONF}")" "2"
check "snippet de cabeçalhos tem nosniff e DENY" \
  "$(grep -cE 'X-Content-Type-Options "nosniff"|X-Frame-Options "DENY"' "${HERE}/../nginx/astryon-headers.conf")" "2"

# --- env_lines: arquivo de ambiente lido como dado, nunca executado (astryonctl não faz mais "source")
ENVF="${TMP}/full.env"
# shellcheck disable=SC2016  # $(...) e crases literais: provam que nada é executado
printf '%s\n' '# c' 'ASTRYON_MQTT_PASSWORD=$(touch '"${TMP}"'/pwned2)`id`' 'ASTRYON_NOME="Starlink Mini"' 'linha inválida' \
  'NEXT_PUBLIC_A=1' > "${ENVF}"
out="$(env_lines "${ENVF}")"
# shellcheck disable=SC2016  # valor esperado literal
check "env_lines preserva \$() e crases como texto" "$(grep '^ASTRYON_MQTT_PASSWORD=' <<<"${out}" | cut -d= -f2-)" \
  '$(touch '"${TMP}"'/pwned2)`id`'
check "env_lines tira aspas" "$(grep '^ASTRYON_NOME=' <<<"${out}")" "ASTRYON_NOME=Starlink Mini"
check "env_lines ignora comentário e lixo" "$(wc -l <<<"${out}" | tr -d ' ')" "3"
check "env_lines com prefixo" "$(env_lines "${ENVF}" NEXT_PUBLIC_)" "NEXT_PUBLIC_A=1"
check "env_lines não executa nada" "$(test -e "${TMP}/pwned2" && echo executou || echo nao)" "nao"
# shellcheck disable=SC2016  # regex literal
check "astryonctl não executa o arquivo de ambiente" \
  "$(grep -cE '(^|[;[:space:]])(\.|source)[[:space:]]+"?\$(0|\{?OL_ENV_FILE)' "${HERE}/../astryonctl" || true)" "0"

# --- código-fonte: cópia do root a partir do ÚLTIMO COMMIT do clone (sem alterações locais nem .git)
# shellcheck disable=SC2329  # stub: no teste não há root; executa direto como o usuário atual
runuser() { shift 2; [[ "$1" == "--" ]] && shift; "$@"; }
if command -v git >/dev/null 2>&1; then
  OL_PREFIX="${TMP}/opt"; OL_SRC="${OL_PREFIX}/src"; mkdir -p "${OL_PREFIX}"
  REPO="${TMP}/clone"; mkdir -p "${REPO}/apps/agent"
  echo '{}' > "${REPO}/package.json"; echo '[project]' > "${REPO}/apps/agent/pyproject.toml"; echo v1 > "${REPO}/arquivo"
  git -C "${REPO}" init -q && git -C "${REPO}" -c user.email=t@t -c user.name=t add -A \
    && git -C "${REPO}" -c user.email=t@t -c user.name=t commit -qm um
  echo "não commitado" > "${REPO}/arquivo"; echo lixo > "${REPO}/novo-nao-rastreado"
  (src_import_dir "${REPO}") >/dev/null 2>&1 || true
  check "src: copia o conteúdo do commit" "$(cat "${OL_SRC}/arquivo")" "v1"
  check "src: arquivo não rastreado fica de fora" "$(test -e "${OL_SRC}/novo-nao-rastreado" && echo sim || echo nao)" "nao"
  check "src: sem .git na cópia" "$(test -e "${OL_SRC}/.git" && echo sim || echo nao)" "nao"
  check "src: commit registrado" "$(src_commit)" "$(git -C "${REPO}" rev-parse HEAD)"
  (printf 'x' | src_replace_from_tar) >/dev/null 2>&1 || true
  check "src: tar inválido não destrói a cópia atual" "$(cat "${OL_SRC}/arquivo")" "v1"
  mkdir -p "${TMP}/vazio"; tar -C "${TMP}/vazio" -cf "${TMP}/vazio.tar" .
  (src_replace_from_tar < "${TMP}/vazio.tar") >/dev/null 2>&1 || true
  check "src: conteúdo que não é o ASTRYON é recusado" "$(cat "${OL_SRC}/arquivo")" "v1"
  # tar malicioso com caminho "../": o GNU tar recusa sair da pasta
  printf 'fuga' > "${TMP}/fuga"; tar -C "${TMP}" -cf "${TMP}/mal.tar" --transform 's|^|../|' fuga 2>/dev/null
  rm -f "${TMP}/fuga"
  check "src: o tar malicioso de teste contém ../fuga" "$(tar -tf "${TMP}/mal.tar")" "../fuga"
  (src_replace_from_tar < "${TMP}/mal.tar") >/dev/null 2>&1 || true
  check "src: tar com ../ não escreve fora da pasta" "$(test -e "${OL_PREFIX}/fuga" && echo sim || echo nao)" "nao"
else
  echo "skip - git ausente: testes de src_import_dir"
fi
unset -f runuser

# --- certificado autoassinado: geração atômica e dias restantes
if command -v openssl >/dev/null 2>&1; then
  OL_TLS="${TMP}/tls"
  (cert_create srv "DNS:srv,IP:127.0.0.1") >/dev/null 2>&1 || true
  check "cert: chave com permissão 600" "$(stat -c %a "${OL_TLS}/astryon.key")" "600"
  left="$(cert_days_left "${OL_TLS}/astryon.crt")"
  if (( left >= 823 && left <= 825 )); then r=sim; else r="nao(${left})"; fi
  check "cert: validade de ~825 dias" "${r}" "sim"
  check "cert: sem arquivos temporários" "$(find "${OL_TLS}" -name '.novo.*' | wc -l | tr -d ' ')" "0"
  check "cert: arquivo ilegível -> vazio" "$(cert_days_left "${TMP}/nao-existe.crt")" ""
fi

echo
if [[ ${fails} -eq 0 ]]; then echo "todos os testes passaram"; else echo "${fails} falha(s)"; exit 1; fi
