#!/usr/bin/env bash
# Manual deploy from the developer machine. Mirrors .github/workflows/deploy.yml
# but runs locally via plink/pscp — useful when GitHub Actions is stuck
# (minutes exhausted, workflow paused, runner outage).
# Only from a clean checkout of the current origin/master — the script refuses
# anything else (AGENTS.md → "Production deploy rules").
#
# Requirements:
#   - plink + pscp on PATH (ship with PuTTY / choco install putty)
#   - SSH creds exported in env OR read from ~/.wesetup-deploy.env
#
# Usage:
#   ./scripts/deploy.sh            # builds HEAD and deploys
#   ./scripts/deploy.sh --dry-run  # print commands without executing
#
# Environment (set in shell or in ~/.wesetup-deploy.env):
#   DEPLOY_SSH_HOST=wesetup.ru
#   DEPLOY_SSH_USER=wesetupru
#   DEPLOY_SSH_PASS=...
#   DEPLOY_SSH_PORT=22
#   DEPLOY_APP_DIR=/var/www/wesetupru/data/www/wesetup.ru/app
#   DEPLOY_HOSTKEY='ssh-ed25519 255 SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E'

set -eo pipefail

# Load creds from rc file if present
RC="$HOME/.wesetup-deploy.env"
if [ -f "$RC" ]; then
  # shellcheck disable=SC1090
  . "$RC"
fi

: "${DEPLOY_SSH_HOST:=wesetup.ru}"
: "${DEPLOY_SSH_USER:=wesetupru}"
: "${DEPLOY_SSH_PORT:=22}"
: "${DEPLOY_APP_DIR:=/var/www/wesetupru/data/www/wesetup.ru/app}"
: "${DEPLOY_HOSTKEY:=ssh-ed25519 255 SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E}"

if [ -z "${DEPLOY_SSH_PASS:-}" ]; then
  echo "✖ DEPLOY_SSH_PASS is not set. Create $RC with the deploy creds or export env vars." >&2
  exit 1
fi

DRY_RUN=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="echo [dry-run]"
fi

# Прод — только код из origin/master (AGENTS.md → «Production deploy rules»).
# tar ниже пакует рабочую папку целиком, вместе с незакоммиченным, а в
# .build-sha пишет HEAD: выкладка грязной копии или старой ветки выглядела бы
# на проде как обычный деплой master, а следующий деплой из CI её затёр бы.
git fetch --quiet origin master || echo "⚠ git fetch не удался — сверяем с последним известным origin/master" >&2
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/master)" ]; then
  echo "✖ HEAD ($(git rev-parse --short HEAD)) не совпадает с origin/master ($(git rev-parse --short origin/master))." >&2
  echo "  Деплой — только из master: запушьте изменения в master или переключитесь на свежий origin/master." >&2
  exit 1
fi
DIRTY=$(git status --porcelain | grep -vE '^\?\? (\.build-sha|\.build-time|deploy\.tar)$' || true)
if [ -n "$DIRTY" ]; then
  echo "✖ В рабочей копии есть незакоммиченные или неотслеживаемые файлы — они попали бы на прод:" >&2
  printf '%s\n' "$DIRTY" | head -20 >&2
  echo "  Деплойте из чистой копии: git worktree add ../wesetup-deploy origin/master" >&2
  exit 1
fi

SHA=$(git rev-parse HEAD)
TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "==> Deploying $SHA ($TIME) to $DEPLOY_SSH_USER@$DEPLOY_SSH_HOST:$DEPLOY_APP_DIR"

echo "==> Writing build markers"
echo "$SHA" > .build-sha
echo "$TIME" > .build-time

echo "==> Creating deploy.tar (excluding node_modules, .next, .git, etc.)"
# ВАЖНО: `--exclude=journals` (без `./`) матчится любой папкой `journals`
# в дереве, включая `src/app/(dashboard)/journals/`, `src/app/api/journals/`
# и `src/app/mini/journals/` — после такого extract на проде пропадали все
# роуты журналов и сайт отдавал «Страница не найдена». Ставим `./journals`
# чтобы анкорить на корень репо — исключает только source-data, не код.
$DRY_RUN tar cf deploy.tar \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=public/screenshots \
  --exclude=.git \
  --exclude=.github \
  --exclude=.claude \
  --exclude=.vscode \
  --exclude=.agent \
  --exclude=./journals \
  --exclude=./tmp-source-journals \
  --exclude=_run.py \
  --exclude=_deploy.py \
  --exclude=_seed_remote.py \
  --exclude=haccp-deploy.tar \
  --exclude='*.tar' \
  --exclude='*.tar.gz' \
  --exclude='*.png' \
  --exclude='prod-*.png' \
  --exclude=test.txt \
  --exclude=.playwright-mcp \
  .

PLINK=(plink -batch -hostkey "$DEPLOY_HOSTKEY" -P "$DEPLOY_SSH_PORT" -l "$DEPLOY_SSH_USER" -pw "$DEPLOY_SSH_PASS" "$DEPLOY_SSH_HOST")
PSCP=(pscp -batch -hostkey "$DEPLOY_HOSTKEY" -P "$DEPLOY_SSH_PORT" -pw "$DEPLOY_SSH_PASS")

echo "==> Backing up .env on server"
$DRY_RUN "${PLINK[@]}" "[ -f $DEPLOY_APP_DIR/.env ] && cp $DEPLOY_APP_DIR/.env $DEPLOY_APP_DIR/.env.bak || true"

echo "==> Uploading tarball"
$DRY_RUN "${PSCP[@]}" deploy.tar "$DEPLOY_SSH_USER@$DEPLOY_SSH_HOST:$DEPLOY_APP_DIR/deploy.tar"

echo "==> Extracting + restoring .env"
$DRY_RUN "${PLINK[@]}" "cd $DEPLOY_APP_DIR && rm -rf src scripts prisma public .github docs .agent journals tmp-source-journals && tar xf deploy.tar && rm deploy.tar && [ -f .env.bak ] && cp .env.bak .env || true"

echo "==> Installing deps + building on prod host"
# Verifies client-reference-manifest.js файлы на месте после build —
# Next.js 16 иногда собирается «успешно», но без manifest-ов, и SSR
# отдаёт страницы которые не гидрируются на мобильных (на ПК часто
# работают из кэша). Если меньше 5 manifest-ов — ребилдим один раз и
# фейлим если опять.
$DRY_RUN "${PLINK[@]}" "cd $DEPLOY_APP_DIR && [ -s ~/.nvm/nvm.sh ] && . ~/.nvm/nvm.sh || true; rm -rf node_modules .next node_modules/.cache 2>/dev/null || true; sleep 1; rm -rf node_modules .next 2>/dev/null || true; npm ci --no-audit --no-fund 2>&1 | tail -5 || (echo 'retry after deep clean' && rm -rf node_modules ~/.npm/_cacache && npm ci --no-audit --no-fund 2>&1 | tail -5); npx prisma generate 2>&1 | tail -5 && npm run build 2>&1 | tail -10 && verify() { local M=\$(find .next/server/app -name '*client-reference-manifest.js' 2>/dev/null | wc -l); if [ \"\$M\" -lt \"5\" ]; then echo \"[fail] only \$M manifests\"; return 1; fi; if [ ! -f .next/server/app/_not-found/page_client-reference-manifest.js ]; then echo \"[fail] _not-found manifest missing\"; return 1; fi; echo \"[ok] \$M manifests + _not-found present\"; return 0; } && if ! verify; then echo \"[warn] rebuild\"; rm -rf .next; npm run build 2>&1 | tail -10; if ! verify; then echo \"[fail] manifests still bad after rebuild\" && exit 1; fi; fi"

echo "==> Running prisma db push + seeds"
$DRY_RUN "${PLINK[@]}" "cd $DEPLOY_APP_DIR && [ -s ~/.nvm/nvm.sh ] && . ~/.nvm/nvm.sh || true; [ -f .env ] && (set -a && . ./.env && set +a); npx prisma db push 2>&1 | tail -5 && npx tsx prisma/seed.ts 2>&1 | tail -5"

echo "==> Restarting PM2 (web + telegram poller)"
# Перед restart — удаляем старые процессы (web мог быть запущен с
# `npm start` и слушать :3000 вместо :3002 → EADDRINUSE; poller мог
# держать старую версию bot-кода).
$DRY_RUN "${PLINK[@]}" "cd $DEPLOY_APP_DIR && [ -s ~/.nvm/nvm.sh ] && . ~/.nvm/nvm.sh || true; (npx pm2 delete haccp-online 2>/dev/null || true) && npx pm2 start 'npx next start -p 3002' --name haccp-online --cwd \"\$(pwd)\" --update-env 2>&1 | tail -3 && (npx pm2 delete haccp-telegram-poller 2>/dev/null || true) && npx pm2 start 'npx tsx scripts/telegram-poller.ts' --name haccp-telegram-poller --cwd \"\$(pwd)\" --update-env 2>&1 | tail -3 && npx pm2 save --force 2>&1 | tail -2"

echo "==> Probing HTTP"
sleep 3
$DRY_RUN "${PLINK[@]}" "curl -I -s http://127.0.0.1:3002 | head -3"

echo "==> Cleanup local artifacts"
$DRY_RUN rm -f deploy.tar .build-sha .build-time

echo "✓ Deploy of $SHA complete. Remember: the repo on the server is NOT a git checkout — verify via .build-sha."
