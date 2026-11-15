#!/usr/bin/env bash
# ASTRYON — atualização sem downtime longo e com rollback automático.
#
#   sudo astryonctl update              # usa o clone registrado na instalação
#   sudo astryonctl update --git-pull   # faz "git pull --ff-only" no clone antes (como o dono do clone)
#   sudo astryonctl update --source /caminho/do/clone
#
# Passos: backup do SQLite -> build de uma NOVA release (venv + npm ci + next build) sem tocar na atual ->
# troca atômica do link /opt/astryon/current -> reinício -> verificação de saúde -> rollback se falhar.
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
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "opção desconhecida: $1" ;;
  esac
done
require_root
[[ -n "${SRC}" && -d "${SRC}" ]] || die "clone de origem não encontrado; use --source /caminho"

if [[ ${GIT_PULL} -eq 1 ]]; then
  step "Atualizando o clone ${SRC}"
  owner="$(stat -c %U "${SRC}")"
  runuser -u "${owner}" -- git -C "${SRC}" pull --ff-only
  ok "commit $(runuser -u "${owner}" -- git -C "${SRC}" rev-parse --short HEAD)"
fi

PREV="$(current_release)"
step "Backup do banco local"
if [[ -f "${OL_DATA}/astryon.sqlite3" ]]; then
  runuser -u "${OL_USER}" -- env ASTRYON_DATA_DIR="${OL_DATA}" "${OL_LIBEXEC}/backup.sh" | sed 's/^/    /'
else
  info "ainda não há banco"
fi

step "Construindo nova release (a atual continua no ar)"
NEW="$(build_release "${SRC}")"
ok "${NEW}"

# Scripts de implantação também podem ter mudado
install -m 0755 "${SRC}/deploy/linux/astryonctl" /usr/local/bin/astryonctl
install -m 0644 "${SRC}/deploy/linux/lib.sh" "${OL_LIBEXEC}/lib.sh"
install -m 0755 "${SRC}/deploy/linux/update.sh" "${OL_LIBEXEC}/update.sh"
install -m 0755 "${SRC}/deploy/linux/backup.sh" "${OL_LIBEXEC}/backup.sh"
changed=0
units_tmp="$(mktemp -d)"
for u in astryon-agent.service astryon-web.service astryon.target astryon-backup.service astryon-backup.timer; do
  render_unit "${SRC}/deploy/linux/systemd/${u}" "${units_tmp}/${u}"
  if ! cmp -s "${units_tmp}/${u}" "/etc/systemd/system/${u}"; then
    install -m 0644 "${units_tmp}/${u}" "/etc/systemd/system/${u}"; changed=1
  fi
done
rm -rf "${units_tmp}"
[[ ${changed} -eq 1 ]] && systemctl daemon-reload && info "unidades systemd atualizadas"

switch_release "${NEW}"
if [[ ${RESTART} -eq 0 ]]; then ok "release preparada; reinicie com: sudo astryonctl restart"; exit 0; fi

step "Reiniciando serviços"
systemctl restart astryon-agent.service astryon-web.service
if health_check 40; then
  ok "atualização concluída: $(basename "${NEW}")"
  prune_releases
else
  warn "nova release não ficou saudável — revertendo para $(basename "${PREV:-nenhuma}")"
  if [[ -n "${PREV}" && -d "${PREV}" ]]; then
    switch_release "${PREV}"
    systemctl restart astryon-agent.service astryon-web.service
    if health_check 40; then ok "rollback concluído"; else warn "rollback também não respondeu: sudo astryonctl doctor"; fi
  fi
  rm -f "${NEW}/.astryon-release-ok"
  die "atualização falhou; logs: journalctl -u astryon-agent -u astryon-web --since '10 min ago'"
fi
