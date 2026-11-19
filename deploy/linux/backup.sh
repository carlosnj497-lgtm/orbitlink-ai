#!/usr/bin/env bash
# Backup online e consistente do SQLite (API de backup do SQLite; seguro com WAL e com o agente rodando).
# Mantém os N mais recentes (ASTRYON_BACKUP_KEEP, padrão 14). A chave de segredos (/etc/astryon/secrets.key)
# NÃO é incluída de propósito — guarde-a separadamente se quiser restaurar segredos de ESP32 em outra máquina.
set -euo pipefail
DATA="${ASTRYON_DATA_DIR:-/var/lib/astryon}"
DB="${DATA}/astryon.sqlite3"
DEST="${DATA}/backups"
KEEP="${ASTRYON_BACKUP_KEEP:-14}"

[[ -f "${DB}" ]] || { echo "sem banco em ${DB}; nada a fazer"; exit 0; }
mkdir -p "${DEST}"
chmod 0700 "${DEST}"
out="${DEST}/astryon-$(date -u +%Y%m%dT%H%M%SZ).sqlite3"
# Dois backups no mesmo segundo (ex.: "astryonctl backup" logo antes de "astryonctl update") colidiriam
# no nome e o gzip se recusaria a sobrescrever, derrubando o update — nesses casos, usa um sufixo.
n=1
while [[ -e "${out}" || -e "${out}.gz" ]]; do
  out="${DEST}/astryon-$(date -u +%Y%m%dT%H%M%SZ)-$((n++)).sqlite3"
done
sqlite3 "${DB}" ".timeout 10000" ".backup '${out}'"
sqlite3 "${out}" "PRAGMA integrity_check;" | grep -qx ok || { echo "integridade falhou em ${out}" >&2; rm -f "${out}"; exit 1; }
gzip -9 "${out}"
echo "backup: ${out}.gz ($(du -h "${out}.gz" | cut -f1))"
find "${DEST}" -maxdepth 1 -name 'astryon-*.sqlite3.gz' -printf '%T@ %p\n' | sort -rn | tail -n +"$((KEEP + 1))" |
  cut -d' ' -f2- | xargs -r rm -f --
