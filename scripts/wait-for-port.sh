#!/usr/bin/env bash
# Ждёт, пока TCP-порт сервера ответит, — перед SSH-шагами деплоя.
#
# Деплой #2029 (2026-10-24) упал на разовом `dial tcp …: i/o timeout`
# ещё до выгрузки: сайт работал, а SSH из GitHub Actions на полминуты
# пропал. Выкат #2383 (2026-11-21) — порт молчал все 3 минуты, а в тот день
# сервер через раз не принимал соединения из зарубежных дата-центров. Ждём
# порт до ~8 минут, и только потом идём в SSH.
#
#   wait-for-port.sh <host> <port> [попыток=20] [пауза, с=15]
#
# Хост в лог не пишем: в деплое это секрет.

set -u

HOST="${1:?host}"
PORT="${2:?port}"
ATTEMPTS="${3:-20}"
PAUSE="${4:-15}"

for attempt in $(seq 1 "$ATTEMPTS"); do
  if timeout 10 bash -c "exec 3<>/dev/tcp/$HOST/$PORT" 2>/dev/null; then
    echo "[ssh] порт сервера отвечает (попытка $attempt/$ATTEMPTS)"
    exit 0
  fi
  echo "[ssh] порт сервера не отвечает, попытка $attempt/$ATTEMPTS"
  if [ "$attempt" -lt "$ATTEMPTS" ]; then sleep "$PAUSE"; fi
done

echo "::error::SSH-порт сервера не отвечает из GitHub Actions — проверьте сервер (sshd, файрвол, fail2ban). Код до прода не дошёл."
exit 1
