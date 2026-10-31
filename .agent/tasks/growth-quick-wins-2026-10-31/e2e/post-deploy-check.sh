#!/usr/bin/env bash
# Prod checks after the deploy of PR #84 (AC5, AC5a, AC5b, AC6, AC7). Read-only HTTP probes.
# Usage: bash post-deploy-check.sh <task-dir>
set -u
T="$1"
R="$T/raw"
SM="$(mktemp)"
{
  echo "checked $(date -u +%FT%TZ)"
  echo "build-info: $(curl -sS https://wesetup.ru/api/build-info)"
  curl -sS https://wesetup.ru/sitemap.xml -o "$SM"
  echo "sitemap urls: $(grep -c '<loc>' "$SM")"
  echo "sitemap urls with <lastmod>: $(grep -c '<lastmod>' "$SM")"
  echo "distinct lastmod values (top 5):"
  grep -o '<lastmod>[^<]*</lastmod>' "$SM" | sort | uniq -c | sort -rn | head -5
  echo "/ (home) has <lastmod>? $(python3 - "$SM" <<'PY'
import re,sys
s=open(sys.argv[1],encoding='utf-8').read()
urls=re.findall(r'<url>(.*?)</url>',s,re.S)
home=[u for u in urls if re.search(r'<loc>https://wesetup.ru/?</loc>',u)]
blog=[u for u in urls if '<loc>https://wesetup.ru/blog</loc>' in u]
print('home:', 'yes' if home and '<lastmod>' in home[0] else 'no', '| /blog lastmod:', (re.search(r'<lastmod>([^<]*)',blog[0]).group(1) if blog and '<lastmod>' in blog[0] else 'none'))
PY
)"
  echo "/login robots meta: $(curl -sS https://wesetup.ru/login | grep -o '<meta name="robots" content="[^"]*"' | head -1)"
  HOME_HTML="$(curl -sS https://wesetup.ru/)"
  echo "home mentions «Запуск: 1 октября»: $(printf '%s' "$HOME_HTML" | grep -c 'Запуск: 1 октября')"
  echo "home has new app teaser text: $(printf '%s' "$HOME_HTML" | grep -c 'готовятся к публикации в магазинах')"
  echo "home challenge placeholder reserved (min-h-[144px]): $(printf '%s' "$HOME_HTML" | grep -c 'min-h-\[144px\]')"
} > "$R/after-prod-checks.txt" 2>&1
rm -f "$SM"
node "$T/e2e/cls-measure.cjs" https://wesetup.ru/ 3 > "$R/after-prod-cls.json"
cat "$R/after-prod-checks.txt"
python3 -c "import json,sys; d=json.load(open('$R/after-prod-cls.json')); print('CLS runs:', [(r['cls'], r['challenge']) for r in d['runs']])"
