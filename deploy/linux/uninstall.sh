#!/usr/bin/env bash
# OrbitLink AI — remoção. Por padrão MANTÉM dados (/var/lib/orbitlink) e configuração (/etc/orbitlink).
#   sudo deploy/linux/uninstall.sh            # remove serviços, Nginx site, CLI e releases
#   sudo deploy/linux/uninstall.sh --purge    # também apaga dados, backups, segredos e o usuário (pede confirmação)
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
PURGE=0
[[ "${1:-}" == "--purge" ]] && PURGE=1
require_root

step "Parando e removendo serviços"
systemctl disable --now orbitlink-backup.timer orbitlink.target orbitlink-web.service orbitlink-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/orbitlink-{agent,web,backup}.service /etc/systemd/system/orbitlink.target \
      /etc/systemd/system/orbitlink-backup.timer
systemctl daemon-reload

step "Removendo site do Nginx"
rm -f /etc/nginx/sites-enabled/orbitlink /etc/nginx/sites-available/orbitlink \
      /etc/nginx/snippets/orbitlink-acl.conf /etc/nginx/snippets/orbitlink-proxy.conf
if nginx -t >/dev/null 2>&1; then systemctl reload nginx || true; fi
info "o site 'default' não é restaurado automaticamente (ln -s ../sites-available/default /etc/nginx/sites-enabled/ se quiser)"

step "Removendo CLI e releases"
rm -f /usr/local/bin/orbitlinkctl
rm -rf --one-file-system "${OL_LIBEXEC}" "${OL_PREFIX}"

info "Regras do UFW com comentário 'orbitlink:' permanecem. Para remover: sudo ufw status numbered && sudo ufw delete <n>"
info "O endurecimento do SSH (se aplicado) permanece em /etc/ssh/sshd_config.d/50-orbitlink-hardening.conf"

if [[ ${PURGE} -eq 1 ]] && confirm "APAGAR definitivamente dados, backups, segredos e o usuário ${OL_USER}?"; then
  rm -rf --one-file-system "${OL_DATA}" "${OL_ETC}"
  userdel "${OL_USER}" 2>/dev/null || true
  ok "dados e configuração apagados"
else
  ok "dados preservados em ${OL_DATA} e configuração em ${OL_ETC}"
fi
