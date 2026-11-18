#!/usr/bin/env bash
set -euo pipefail
root="$(pwd)"
scratch="$(mktemp -d)"
trap 'rm -f "$scratch"/bin/{crontab,curl} "$scratch"/app/scripts/cron-gogetlinks.sh "$scratch"/{crontab,header,writes}; rmdir "$scratch"/{bin,app/scripts,app} "$scratch"' EXIT
mkdir -p "$scratch/bin" "$scratch/app/scripts"
export CRON_TEST_DIR="$scratch"
export PATH="$scratch/bin:$PATH"

cp "$root/scripts/cron-gogetlinks.sh" "$scratch/app/scripts/"
cat > "$scratch/bin/crontab" <<'CRONTAB'
#!/usr/bin/env bash
if [[ "$1" == "-l" ]]; then
  cat "$CRON_TEST_DIR/crontab"
else
  echo updated >> "$CRON_TEST_DIR/writes"
  cat > "$CRON_TEST_DIR/crontab"
fi
CRONTAB
cat > "$scratch/bin/curl" <<'CURL'
#!/usr/bin/env bash
printf '%s\n' "$@" | grep -Fx 'http://127.0.0.1:3002/api/cron/gogetlinks'
printf '%s\n' "$@" | grep -Fx 'POST'
printf '%s\n' "$@" | grep -Fx '@-'
cat > "$CRON_TEST_DIR/header"
CURL
chmod +x "$scratch/bin/crontab" "$scratch/bin/curl"
cat > "$scratch/crontab" <<'JOBS'
MAILTO=ops@example.test
*/10 * * * * curl 'http://127.0.0.1:3002/api/cron/gogetlinks'
2-59/5 * * * * /bin/bash /app/scripts/cron-crm.sh
JOBS
bash -n "$scratch/app/scripts/cron-gogetlinks.sh"
bash "$scratch/app/scripts/cron-gogetlinks.sh"
bash "$scratch/app/scripts/cron-gogetlinks.sh"
[[ "$(wc -l < "$scratch/writes")" -eq 1 ]]
[[ "$(grep -c 'wesetup-gogetlinks-cron' "$scratch/crontab")" -eq 1 ]]
grep -Fx 'MAILTO=ops@example.test' "$scratch/crontab"
grep -Fx '2-59/5 * * * * /bin/bash /app/scripts/cron-crm.sh' "$scratch/crontab"
if grep -F '/api/cron/gogetlinks' "$scratch/crontab"; then
  exit 1
fi
if env -u CRON_SECRET bash "$scratch/app/scripts/cron-gogetlinks.sh" --run; then
  exit 1
fi
test ! -f "$scratch/header"
CRON_SECRET=fixture bash "$scratch/app/scripts/cron-gogetlinks.sh" --run
grep -qFx 'Authorization: Bearer fixture' "$scratch/header"
echo 'PASS: idempotent schedule, existing jobs preserved, authenticated local POST'
