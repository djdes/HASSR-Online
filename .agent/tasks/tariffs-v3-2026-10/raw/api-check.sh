#!/usr/bin/env bash
# Проверка серверных ограничений тарифов на локальном сервере (тестовые аккаунты).
BASE=http://localhost:3000
DIR=$(mktemp -d)
login() {
  local who=$1 jar="$DIR/$1.jar"
  local csrf
  csrf=$(curl -s -c "$jar" -b "$jar" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
  curl -s -o /dev/null -c "$jar" -b "$jar" -X POST "$BASE/api/auth/callback/credentials" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "csrfToken=$csrf" --data-urlencode "email=$who@example.test" --data-urlencode "password=TestPass123!" \
    --data-urlencode "json=true"
  echo "$jar"
}
req() { # who method path [json]
  local jar="$DIR/$1.jar"
  if [ -n "${4:-}" ]; then
    curl -s -o "$DIR/body" -w "%{http_code}" -b "$jar" -X "$2" "$BASE$3" -H "Content-Type: application/json" --data "$4"
  else
    curl -s -o "$DIR/body" -w "%{http_code}" -b "$jar" -X "$2" "$BASE$3"
  fi
  printf " %s\n" "$(head -c 260 "$DIR/body" | tr '\n' ' ')"
}
for who in trial standard premium free; do login "$who" >/dev/null; done
echo "== who am i (session org)"
for who in trial standard premium free; do printf "%s: " "$who"; curl -s -b "$DIR/$who.jar" "$BASE/api/auth/session" | head -c 160; echo; done
echo "== typical package ZIP"
for who in standard premium trial free; do printf "%s: " "$who"; curl -s -o "$DIR/pkg.zip" -w "%{http_code} %{content_type} %{size_download}B" -b "$DIR/$who.jar" "$BASE/api/production-control/package/zip"; echo; done
unzip -l "$DIR/pkg.zip" 2>/dev/null | tail -3
echo "== equipment delivery request"
for who in standard premium; do printf "%s: " "$who"; req "$who" POST /api/equipment/delivery-request '{"config":{"temp":2,"tablet":1},"contactName":"Тест Тестов","contactPhone":"+79990000000","address":"Москва"}'; done
echo "== schedule downgrade"
printf "standard renew->: "; req standard POST /api/settings/subscription/schedule '{"plan":"standard","cycle":"month","points":1}'
printf "premium -> standard/year/3: "; req premium POST /api/settings/subscription/schedule '{"plan":"standard","cycle":"year","points":3}'
printf "premium cancel: "; req premium DELETE /api/settings/subscription/schedule
printf "trial schedule: "; req trial POST /api/settings/subscription/schedule '{"plan":"standard","cycle":"year","points":1}'
echo "== points: buildings (standard: 1 point paid)"
printf "standard building #1: "; req standard POST /api/settings/buildings '{"name":"Зал 1"}'
printf "standard building #2: "; req standard POST /api/settings/buildings '{"name":"Зал 2"}'
printf "trial building #2: "; req trial POST /api/settings/buildings '{"name":"Зал 1"}'; req trial POST /api/settings/buildings '{"name":"Зал 2"}' >/dev/null; printf "trial #2 again: "; req trial POST /api/settings/buildings '{"name":"Зал 3"}'
echo "== points: organizations"
printf "standard new org: "; req standard POST /api/organizations '{"name":"Вторая точка","sphere":"restaurant"}'
echo "== journals (free after trial: 1 journal)"
printf "free enable 2nd journal: "; req free POST /api/settings/journals/temp_control/enable '{"source":"journal-page"}'
printf "free set enable: "; req free POST /api/settings/journals/sets '{"set":"standard"}'
echo "== storage (free: closed; standard: 10 MB)"
head -c 1024 /dev/zero > "$DIR/a.pdf"; printf '%%PDF-1.4\n%%%%EOF\n' > "$DIR/a.pdf"
printf "free knowledge upload: "; curl -s -o "$DIR/body" -w "%{http_code}" -b "$DIR/free.jar" -F "file=@$DIR/a.pdf;type=application/pdf" "$BASE/api/knowledge-documents"; printf " %s\n" "$(head -c 200 "$DIR/body")"
head -c 11534336 /dev/urandom > "$DIR/big.pdf"
printf "standard 11MB knowledge upload: "; curl -s -o "$DIR/body" -w "%{http_code}" -b "$DIR/standard.jar" -F "file=@$DIR/big.pdf;type=application/pdf" "$BASE/api/knowledge-documents"; printf " %s\n" "$(head -c 200 "$DIR/body")"
printf "standard PPK folder 11MB: "; curl -s -o "$DIR/body" -w "%{http_code}" -b "$DIR/standard.jar" -F "folder=package" -F "file=@$DIR/big.pdf;type=application/pdf" "$BASE/api/production-control/files"; printf " %s\n" "$(head -c 200 "$DIR/body")"
echo "== IoT (standard: locked)"
AREA=$(curl -s -b "$DIR/standard.jar" "$BASE/api/areas" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 40)
printf "standard equipment with tuya: "; req standard POST /api/equipment "{\"name\":\"Холодильник 1\",\"type\":\"fridge\",\"tuyaDeviceId\":\"bf00test\",\"areaId\":\"$AREA\"}"
echo "== upgrade route (legacy manual)"
printf "standard upgrade: "; req standard POST /api/settings/subscription/upgrade
echo "== order page quotes"
for q in "plan=premium&cycle=month&points=1" "plan=premium&cycle=year&points=1" "plan=standard&cycle=year&points=1"; do printf "standard /order?%s: " "$q"; curl -s -b "$DIR/standard.jar" "$BASE/order?$q" | grep -oE "(Доплата|доплат|Повышение|Переход|зачёт|Зачёт|к оплате|К оплате)[^<]{0,80}" | head -3 | tr '\n' '|'; echo; done
rm -rf "$DIR"
