#!/usr/bin/env bash
# Отпечаток содержимого deploy.tar: sha256 по путям и содержимому всех
# файлов архива, кроме .build-time (время сборки архива у каждой стороны
# своё). Даты и владельцы файлов в отпечаток не входят — так архив из
# GitHub Actions и архив, собранный сервером из того же коммита, дают
# одинаковый отпечаток.
#
#   deploy-tree-digest.sh <deploy.tar>

set -euo pipefail

TAR="${1:?путь к deploy.tar}"
TAR="$(cd "$(dirname "$TAR")" && pwd)/$(basename "$TAR")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

tar xf "$TAR" -C "$WORK"
cd "$WORK"

# Пустой архив — не отпечаток, а ошибка.
[ -n "$(find . -type f ! -path ./.build-time -print -quit)" ] || { echo "в архиве нет файлов" >&2; exit 1; }

find . -type f ! -path ./.build-time -print0 \
  | LC_ALL=C sort -z \
  | xargs -0 sha256sum \
  | sha256sum \
  | cut -d' ' -f1
