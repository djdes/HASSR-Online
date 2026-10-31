#!/usr/bin/env bash
# Read-only prod probes after the deploy of stage «Недели 1–2» (AC1, AC3, AC6, AC8).
# Usage: bash post-deploy-check.sh <task-dir>
set -u
R="$1/raw"
{
  echo "checked $(date -u +%FT%TZ)"
  echo "build-info: $(curl -sS https://wesetup.ru/api/build-info)"
  PRICING="$(curl -sS https://wesetup.ru/pricing)"
  echo "/pricing mentions СБП: $(printf '%s' "$PRICING" | grep -c 'картой или через СБП')"
  echo "/pricing mentions 14-day refund: $(printf '%s' "$PRICING" | grep -c '14 дней с первой оплаты')"
  echo "/oferta has #refund anchor: $(curl -sS https://wesetup.ru/oferta | grep -c 'id="refund"')"
  echo "resend-completion without proof: $(curl -sS -X POST -o /dev/stdout -w ' [HTTP %{http_code}]' https://wesetup.ru/api/payments/robokassa/resend-completion)"
  echo "support-unanswered cron without secret: $(curl -sS -o /dev/null -w 'HTTP %{http_code}' https://wesetup.ru/api/cron/support-unanswered)"
} > "$R/after-prod-checks.txt" 2>&1
cat "$R/after-prod-checks.txt"
