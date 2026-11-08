#!/usr/bin/env bash
# Прод после выкладки (без входа, без записей): «Удобство чтения» и короткие тексты.
#  - /api/build-info — коммит;
#  - <html> по куке wesetup-view: размер, контраст, анимация, пояснения; без куки — по умолчанию;
#  - CSS сайта: кегли обёрнуты в var(--app-text-scale), правила view-prefs на месте;
#  - главная и /login открываются (200).
# Запуск: bash .agent/tasks/ux-readability-2026-11/e2e/post-deploy-check.sh [https://wesetup.ru]
set -u
BASE="${1:-https://wesetup.ru}"
pass=0; fail=0
ok() { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }
UA="WeSetup-post-deploy-check/1.0"

info=$(curl -s --max-time 30 -A "$UA" "$BASE/api/build-info")
echo "build-info: $info"

html_default=$(curl -s --max-time 60 -A "$UA" "$BASE/login")
echo "$html_default" | grep -qE '<html[^>]*data-view-text="normal"[^>]*data-view-hints="on"' && ok "без куки: обычный текст, пояснения видны" || bad "без куки: атрибуты <html>"

html_custom=$(curl -s --max-time 60 -A "$UA" -H 'Cookie: wesetup-view=t:xlarge|c:high|m:reduce|h:off' "$BASE/login")
tag=$(echo "$html_custom" | grep -oE '<html[^>]*>' | head -1)
echo "html: $tag"
echo "$tag" | grep -q 'data-view-text="xlarge"' && ok "кука: очень крупный текст с первого кадра" || bad "кука: data-view-text"
echo "$tag" | grep -q 'data-view-hc=""' && ok "кука: высокий контраст" || bad "кука: data-view-hc"
echo "$tag" | grep -q 'data-view-still=""' && ok "кука: без анимации" || bad "кука: data-view-still"
echo "$tag" | grep -q 'data-view-hints="off"' && ok "кука: пояснения скрыты" || bad "кука: data-view-hints"
echo "$html_custom" | grep -q '__wesetupViewSync' && ok "скрипт «как в системе» до гидрации" || bad "скрипт до гидрации"

css_hits=0; scale_hits=0
for href in $(echo "$html_default" | grep -oE 'href="/_next/static/[^"]+\.css"' | sed 's/href="//;s/"$//' | sort -u); do
  css=$(curl -s --max-time 60 -A "$UA" "$BASE$href")
  n=$(echo "$css" | grep -o 'var(--app-text-scale,1)\|var(--app-text-scale, 1)' | wc -l)
  scale_hits=$((scale_hits + n))
  echo "$css" | grep -q 'data-view-hints=off\]\|data-view-hints="off"\]' && css_hits=$((css_hits + 1))
done
echo "css: scale=$scale_hits view-prefs-files=$css_hits"
[ "$scale_hits" -gt 20 ] && ok "CSS: кегли умножаются на --app-text-scale" || bad "CSS: --app-text-scale"
[ "$css_hits" -ge 1 ] && ok "CSS: правила «Удобства чтения»" || bad "CSS: view-prefs.css"

code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 -A "$UA" "$BASE/")
[ "$code" = "200" ] && ok "главная 200" || bad "главная $code"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 -A "$UA" -H 'Cookie: wesetup-view=t:large|c:auto|m:reduce|h:on' "$BASE/")
[ "$code" = "200" ] && ok "главная с кукой 200" || bad "главная с кукой $code"

echo "Итого: $pass PASS, $fail FAIL"
[ "$fail" -eq 0 ]
