#!/usr/bin/env bash
# Собирает deploy.tar из дерева исходников. Один список исключений и для
# GitHub Actions, и для сервера, когда сервер сам скачивает коммит с GitHub
# (deploy.yml, шаг «Server downloads the commit from GitHub»): архивы с
# обеих сторон должны совпасть по содержимому.
#
#   deploy-tarball.sh <каталог исходников> <куда положить deploy.tar>
#
# Относительный путь архива считается от каталога исходников.

set -euo pipefail

SRC="${1:?каталог исходников}"
OUT="${2:?путь к deploy.tar}"

cd "$SRC"

# ВАЖНО: `--exclude=journals` (без `./`) матчится любой папкой `journals`
# в дереве, в т.ч. `src/app/(dashboard)/journals/`, `src/app/api/journals/`,
# `src/app/mini/journals/` — после распаковки на проде пропадали все роуты
# журналов и сайт отдавал «Страница не найдена». Ставим `./journals`, чтобы
# привязать к корню репозитория: исключаются только исходные данные, не код.
tar cf "$OUT" \
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
  --exclude='./prod-*.png' \
  --exclude='./animations*.png' \
  --exclude='./screenshot-*.png' \
  --exclude=test.txt \
  --exclude=cloudflared.exe \
  --exclude=pg.zip \
  --exclude=./pgdata \
  --exclude=./docs \
  --exclude=./mobile \
  --exclude='*.exe' \
  --exclude='*.zip' \
  .
