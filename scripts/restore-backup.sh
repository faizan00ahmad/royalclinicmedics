#!/usr/bin/env bash
# Restores an encrypted backup into an EMPTY database. Use it for the quarterly restore test and for real recoveries.
# Usage: ./scripts/restore-backup.sh backup.sql.gz.gpg "postgresql://user:pass@host/dbname"
# The target database must be a new, empty one. NEVER point this at the live database without reading docs/RUNBOOK.md.
set -euo pipefail
FILE="${1:?backup file}"; TARGET="${2:?target database url}"
read -r -s -p "Backup passphrase: " PASS; echo
gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" --decrypt "$FILE" | gunzip | psql "$TARGET" -v ON_ERROR_STOP=1 -q
echo "Restored. Check: psql \"$TARGET\" -c 'select count(*) from core.appointments;'"
