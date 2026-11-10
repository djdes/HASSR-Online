#!/usr/bin/env sh
# Clean slate for the offline end-to-end run on the LOCAL demo database only:
# removes what earlier runs wrote (entries, QR audit, idempotency keys, this
# month's documents) so that setup-demo.mjs recreates the documents untouched.
set -eu
: "${PGPASSWORD:=postgres}"
export PGPASSWORD
psql -h localhost -U postgres haccp_online -v ON_ERROR_STOP=1 -Atc "
  delete from \"AuditLog\" where action = 'journal.qr_fill';
  delete from \"JournalExternalIdempotency\";
  delete from \"JournalDocument\";
  update \"Equipment\" set \"runningSince\" = null, \"runningUserId\" = null;
"
