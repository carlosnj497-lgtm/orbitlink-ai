#!/usr/bin/env bash
# Backup online e consistente do SQLite (API de backup do SQLite; seguro com WAL e com o agente rodando).
# Mantém os N mais recentes (ORBITLINK_BACKUP_KEEP, padrão 14). A chave de segredos (/etc/orbitlink/secrets.key)
# NÃO é incluída de propósito — guarde-a separadamente se quiser restaurar segredos de ESP32 em outra máquina.
set -euo pipefail
DATA="${ORBITLINK_DATA_DIR:-/var/lib/orbitlink}"
DB="${DATA}/orbitlink.sqlite3"
DEST="${DATA}/backups"
KEEP="${ORBITLINK_BACKUP_KEEP:-14}"

[[ -f "${DB}" ]] || { echo "sem banco em ${DB}; nada a fazer"; exit 0; }
mkdir -p "${DEST}"
chmod 0700 "${DEST}"
out="${DEST}/orbitlink-$(date -u +%Y%m%dT%H%M%SZ).sqlite3"
sqlite3 "${DB}" ".timeout 10000" ".backup '${out}'"
sqlite3 "${out}" "PRAGMA integrity_check;" | grep -qx ok || { echo "integridade falhou em ${out}" >&2; rm -f "${out}"; exit 1; }
gzip -9 "${out}"
echo "backup: ${out}.gz ($(du -h "${out}.gz" | cut -f1))"
find "${DEST}" -maxdepth 1 -name 'orbitlink-*.sqlite3.gz' -printf '%T@ %p\n' | sort -rn | tail -n +"$((KEEP + 1))" |
  cut -d' ' -f2- | xargs -r rm -f --
