#!/usr/bin/env sh
# Отказ коммита, если в добавленных строках есть секрет: токен Telegram-бота,
# ключ Anthropic, токен GitHub, пароль в команде plink. 2026-09-22 токен бота
# из docs утёк через публичный репозиторий и бот угнали — больше так нельзя.
# Секреты живут только в .env (не в git).
added=$(git diff --cached -U0 --diff-filter=ACM -- . ':(exclude)scripts/check-secrets.sh' | grep -E '^\+' | grep -vE '^\+\+\+' || true)
[ -z "$added" ] && exit 0

hits=$(printf '%s\n' "$added" | grep -nE \
  -e '[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}' \
  -e 'sk-ant-[A-Za-z0-9_-]{20,}' \
  -e 'gh[pousr]_[A-Za-z0-9]{30,}' \
  -e 'github_pat_[A-Za-z0-9_]{30,}' \
  -e "-pw '[^'\$\"<]{6,}'" \
  || true)

if [ -n "$hits" ]; then
  echo "✗ В коммите похоже на секрет (токен/ключ/пароль):"
  printf '%s\n' "$hits" | sed -E 's/([0-9]{8,10}:AA)[A-Za-z0-9_-]+/\1…/g; s/(sk-ant-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+/\1…/g' | cut -c1-160
  echo "  Уберите секрет в .env и читайте его оттуда."
  exit 1
fi
exit 0
