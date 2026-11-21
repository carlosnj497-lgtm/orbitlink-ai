#!/usr/bin/env bash
# ASTRYON — atualização sem downtime longo e com rollback automático.
#
#   sudo astryonctl update              # último commit do clone registrado na instalação
#   sudo astryonctl update --source /caminho/do/clone
#   sudo astryonctl update --git-pull   # busca o branch padrão do remoto direto, num espelho do root
#
# O código NUNCA é usado direto do clone do usuário: o último commit é copiado (git archive, executado como o
# dono do clone) para /opt/astryon/src, de propriedade do root, e é de lá que saem a release e os scripts que
# rodam como root. Com --git-pull o clone do usuário nem é consultado; crie /etc/astryon/allowed-signers
# (formato do ssh-keygen) para só aceitar commits assinados.
#
# Passos: cópia do código -> backup do SQLite -> build de uma NOVA release (venv + npm ci + next build) sem tocar
# na atual -> backup da configuração -> instalação de scripts, Nginx e unidades -> troca atômica do link
# /opt/astryon/current -> reinício -> verificação de saúde -> rollback completo se falhar.
# Migrations do SQLite são aplicadas pelo próprio agente ao iniciar (são idempotentes e só adicionam).
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SELF_DIR}/lib.sh" ]]; then . "${SELF_DIR}/lib.sh"; else . /usr/local/lib/astryon/lib.sh; fi

SRC="$(cat "${OL_ETC}/source-dir" 2>/dev/null || true)"
GIT_PULL=0
RESTART=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SRC="${2:?}"; shift 2 ;;
    --git-pull) GIT_PULL=1; shift ;;
    --no-restart) RESTART=0; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "opção desconhecida: $1" ;;
  esac
done
require_root
install -d -o root -g root -m 0755 "${OL_PREFIX}"

if [[ ${GIT_PULL} -eq 1 ]]; then
  step "Buscando o remoto num espelho do root (${OL_SRC_GIT})"
  # instalações antigas não registravam o remoto: pega o "origin" do clone conhecido
  [[ -f "${OL_ETC}/git-remote" || -z "${SRC}" ]] || src_record_remote "${SRC}"
  src_git_pull
else
  [[ -n "${SRC}" && -d "${SRC}" ]] || die "clone de origem não encontrado; use --source /caminho ou --git-pull"
  step "Copiando o último commit de ${SRC} para ${OL_SRC}"
  src_import_dir "${SRC}"
  [[ -f "${OL_ETC}/git-remote" ]] || src_record_remote "${SRC}"
fi

PREV="$(current_release)"
step "Backup do banco local"
if [[ -f "${OL_DATA}/astryon.sqlite3" ]]; then
  runuser -u "${OL_USER}" -- env ASTRYON_DATA_DIR="${OL_DATA}" "${OL_LIBEXEC}/backup.sh" | sed 's/^/    /'
else
  info "ainda não há banco"
fi

step "Construindo nova release (a atual continua no ar)"
NEW="$(build_release "${OL_SRC}")"
ok "${NEW}"

# Capture também arquivos ausentes: no rollback eles precisam ser removidos, não deixados acoplados à release antiga.
D="${OL_SRC}/deploy/linux"
SCRIPT_FILES=(
  /usr/local/bin/astryonctl
  "${OL_LIBEXEC}/lib.sh"
  "${OL_LIBEXEC}/update.sh"
  "${OL_LIBEXEC}/backup.sh"
)
NGINX_FILES=(
  /etc/nginx/sites-available/astryon
  /etc/nginx/snippets/astryon-proxy.conf
  /etc/nginx/snippets/astryon-headers.conf
)
UNIT_FILES=(
  /etc/systemd/system/astryon-agent.service
  /etc/systemd/system/astryon-web.service
  /etc/systemd/system/astryon.target
  /etc/systemd/system/astryon-backup.service
  /etc/systemd/system/astryon-backup.timer
)
UPDATE_FILES=("${SCRIPT_FILES[@]}" "${NGINX_FILES[@]}" "${UNIT_FILES[@]}")
rollback_dir="$(mktemp -d)"
trap 'rm -rf --one-file-system "${rollback_dir}"' EXIT
backup_files "${rollback_dir}" "${UPDATE_FILES[@]}"

# Scripts de implantação também podem ter mudado (sempre da cópia do root, nunca do clone do usuário)
install -m 0755 "${D}/astryonctl" /usr/local/bin/astryonctl
install -m 0644 "${D}/lib.sh" "${OL_LIBEXEC}/lib.sh"
install -m 0755 "${D}/update.sh" "${OL_LIBEXEC}/update.sh"
install -m 0755 "${D}/backup.sh" "${OL_LIBEXEC}/backup.sh"

# Nginx: snippets e site com os nomes gravados na instalação (instalações antigas: só os snippets)
nginx_changed=0
if [[ -d /etc/nginx/snippets && -f /etc/nginx/sites-available/astryon ]]; then
  nginx_changed=1
  install -m 0644 "${D}/nginx/astryon-proxy.conf" /etc/nginx/snippets/astryon-proxy.conf
  install -m 0644 "${D}/nginx/astryon-headers.conf" /etc/nginx/snippets/astryon-headers.conf
  if [[ -s "${OL_ETC}/server-names" ]]; then
    sed "s|__SERVER_NAME__|$(cat "${OL_ETC}/server-names")|" "${D}/nginx/astryon.conf" > /etc/nginx/sites-available/astryon
  fi
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx && info "configuração do Nginx atualizada"
  else
    warn "nginx -t falhou com a configuração nova; restaurando site e snippets anteriores"
    restore_files "${rollback_dir}" "${NGINX_FILES[@]}" || die "não foi possível restaurar a configuração do Nginx"
  fi
fi

changed=0
units_tmp="${rollback_dir}/units"
mkdir -p "${units_tmp}"
for unit_path in "${UNIT_FILES[@]}"; do
  u="$(basename "${unit_path}")"
  render_unit "${D}/systemd/${u}" "${units_tmp}/${u}"
  if ! cmp -s "${units_tmp}/${u}" "${unit_path}"; then
    install -m 0644 "${units_tmp}/${u}" "${unit_path}"; changed=1
  fi
done
[[ ${changed} -eq 1 ]] && systemctl daemon-reload && info "unidades systemd atualizadas"

switch_release "${NEW}"
if [[ ${RESTART} -eq 0 ]]; then ok "release preparada; reinicie com: sudo astryonctl restart"; exit 0; fi

step "Reiniciando serviços"
systemctl restart astryon-agent.service astryon-web.service
if health_check 40; then
  ok "atualização concluída: $(basename "${NEW}") (commit $(src_commit | cut -c1-12))"
  prune_releases
  /usr/local/bin/astryonctl renew-cert || warn "não foi possível conferir/renovar o certificado HTTPS"
else
  warn "nova release não ficou saudável — revertendo release e configuração para $(basename "${PREV:-nenhuma}")"
  rollback_update "${rollback_dir}" "${PREV}" "${changed}" "${nginx_changed}" "${UPDATE_FILES[@]}" || true
  rm -f "${NEW}/.astryon-release-ok"
  die "atualização falhou; logs: journalctl -u astryon-agent -u astryon-web --since '10 min ago'"
fi
