#!/usr/bin/env bash
# Один выкат за раз (задача deploy-pull-agent-2026-11-21). Подключается через
# `source` в шагах выката (deploy.yml) и в агенте сервера
# (scripts/deploy-agent.mjs берёт тот же замок сам):
#
#   . scripts/deploy-lock.sh
#   deploy_lock_acquire "github step 2/3 $GITHUB_SHA" 1500 || exit 1
#
# Замок — каталог: mkdir атомарен, и, в отличие от flock, его не унаследует
# демон pm2, если шаг 3 запустит его заново. Освобождается сам при выходе из
# оболочки (trap EXIT). Замок старше 45 минут — от упавшего выката: снимаем.
# WESETUP_DEPLOY_LOCKED=1 — замок уже держит агент, шаги его не берут.

DEPLOY_LOCK_DIR="${WESETUP_DEPLOY_LOCK_DIR:-$HOME/.wesetup-deploy.lock.d}"
DEPLOY_LOCK_STALE_MIN="${WESETUP_DEPLOY_LOCK_STALE_MIN:-45}"
DEPLOY_LOCK_PAUSE="${WESETUP_DEPLOY_LOCK_PAUSE:-10}"
DEPLOY_LOCK_HELD=""

deploy_lock_release() {
  if [ -n "$DEPLOY_LOCK_HELD" ]; then
    rm -rf "$DEPLOY_LOCK_DIR"
    DEPLOY_LOCK_HELD=""
  fi
}

# deploy_lock_acquire <кто> [ждать, с=1500]
deploy_lock_acquire() {
  local owner="${1:-unknown}" wait="${2:-1500}" waited=0 announced=""
  if [ "${WESETUP_DEPLOY_LOCKED:-}" = "1" ]; then
    return 0
  fi
  mkdir -p "$(dirname "$DEPLOY_LOCK_DIR")"
  while :; do
    if mkdir "$DEPLOY_LOCK_DIR" 2>/dev/null; then
      printf '%s\n' "$owner" > "$DEPLOY_LOCK_DIR/owner"
      DEPLOY_LOCK_HELD=1
      # Свой trap EXIT у шага (уборка временного каталога) сохраняем: снимаем
      # замок и выполняем прежнюю команду.
      local previous=""
      if [ -n "$(trap -p EXIT)" ]; then
        eval "set -- $(trap -p EXIT)"
        previous="$3"
      fi
      # shellcheck disable=SC2064 # прежняя команда подставляется сейчас, её переменные — при выходе
      trap "deploy_lock_release${previous:+; $previous}" EXIT
      return 0
    fi
    if [ -n "$(find "$DEPLOY_LOCK_DIR" -maxdepth 0 -mmin "+$DEPLOY_LOCK_STALE_MIN" 2>/dev/null)" ]; then
      echo "[lock] замок старше $DEPLOY_LOCK_STALE_MIN мин ($(cat "$DEPLOY_LOCK_DIR/owner" 2>/dev/null)) — снимаем"
      rm -rf "$DEPLOY_LOCK_DIR"
      continue
    fi
    if [ "$waited" -ge "$wait" ]; then
      echo "[lock] другой выкат идёт дольше $wait с: $(cat "$DEPLOY_LOCK_DIR/owner" 2>/dev/null) — остановлено"
      return 1
    fi
    if [ -z "$announced" ]; then
      echo "[lock] идёт другой выкат: $(cat "$DEPLOY_LOCK_DIR/owner" 2>/dev/null) — ждём"
      announced=1
    fi
    sleep "$DEPLOY_LOCK_PAUSE"
    waited=$((waited + DEPLOY_LOCK_PAUSE))
  done
}
