#!/bin/bash
# Живая проверка исправлений после независимой проверки 1 (tariffs-limits-ui AC1, AC2, AC6, Р4).
# Сначала limits-scenarios.ts и тестовые должности limpos-* (см. evidence). Нужны: next dev на :3000,
# локальная БД, login.sh (пароль TestPass123!) в $JAR_DIR.
# Запуск: JAR_DIR=... bash limits-check-2.sh > limits-check-2.txt
set -u
J="${JAR_DIR:?}"
B=http://localhost:3000
OUT="$(mktemp -d)"
XFF="203.0.113.$((RANDOM % 250 + 1))"
APP_UA="Mozilla/5.0 WeSetupApp/1.0 (ios)"

say() { echo; echo "=== $*"; }
req() {
  local jar="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -o "$OUT/body" -w "%{http_code}" -X "$method" "$B$path" -H "X-Forwarded-For: $XFF" -b "$J/$jar.jar" -c "$J/$jar.jar")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  curl "${args[@]}"
}
json() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(" · ".join(f"{k}={d.get(k)!r}" for k in sys.argv[2:]))' "$OUT/body" "$@"; }
visible() { python3 -c 'import re,html,sys; s=re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>","",sys.stdin.read()); print(re.sub(r"\s+"," ",html.unescape(re.sub(r"<[^>]+>"," ",s))))'; }
has() { echo "$1" | grep -o -- "$2" | head -1; }

for who in lim-free lim-std-full lim-prem-full v5-ref; do bash "$J/login.sh" "$who@example.test" >/dev/null; done

say "1. «Сотрудники → Добавить» (POST /api/staff), места заняты: 402 с tier и nextTier"
for who in lim-free lim-std-full lim-prem-full; do
  code=$(req "$who" POST /api/staff "{\"jobPositionId\":\"limpos-$who\",\"fullName\":\"Новый Сотрудник\"}")
  echo "-- $who: HTTP $code · $(json code limit tier nextTier)"
done

say "2. Страница «Сотрудники»: заметка о местах под шапкой"
for who in lim-free lim-std-full lim-prem-full v5-ref; do
  html=$(curl -s -b "$J/$who.jar" -H "X-Forwarded-For: $XFF" "$B/settings/users")
  text=$(echo "$html" | visible)
  banner=$(has "$text" "Места тарифа заняты: [0-9]* из [0-9]* — новых сотрудников не добавить\.[^.]*\.")
  button=$(echo "$html" | python3 -c 'import re,sys,html as h; s=sys.stdin.read(); m=re.search(r"data-testid=\"staff-seats-banner\"(.*?)</div>", s, re.S); print(re.sub(r"\s+"," ",h.unescape(re.sub(r"<[^>]+>"," ", re.search(r"<(a|button)[^>]*>.*?</\1>", m.group(1), re.S).group(0)))).strip() if m and re.search(r"<(a|button)[^>]*>.*?</\1>", m.group(1), re.S) else "—")')
  echo "-- $who: ${banner:-нет заметки} · кнопка: $button"
done
text=$(curl -s -A "$APP_UA" -b "$J/lim-std-full.jar" -H "X-Forwarded-For: $XFF" "$B/settings/users" | visible)
echo "-- приложение WeSetup, «Стандарт» 25/25: $(has "$text" "Места тарифа заняты: [0-9]* из [0-9]* — новых сотрудников не добавить\.[^.]*") · «Премиум» в тексте: $( [ -n "$(has "$text" "Перейдите на «Премиум»")" ] && echo "ЕСТЬ — ОШИБКА" || echo "нет")"

say "3. «Меркурий»: список документов на «Стандарте» — 402"
code=$(req lim-std-full GET /api/mercury/documents); echo "-- «Стандарт» GET /api/mercury/documents: HTTP $code · $(json code)"
code=$(req lim-prem-full GET /api/mercury/documents); echo "-- «Премиум» GET /api/mercury/documents: HTTP $code"

rm -rf "$OUT"
