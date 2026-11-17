#!/usr/bin/env bash
# Сквозная проверка писем на dev-сервере с SMTP-приёмником.
set -u
BASE=${BASE:-http://localhost:3000}
post() { curl -s -X POST "$BASE$1" -H "Content-Type: application/json" -H "X-Forwarded-For: $3" -d "$2"; echo; }
echo "--- A: скачивание без регистрации (дважды)"
post /api/public/blank-download '{"email":"e2e-welcome-a@gmail.com","code":"hygiene","format":"pdf","consent":true,"website":"","elapsedMs":4000}' 95.31.18.10
sleep 6
post /api/public/blank-download '{"email":"e2e-welcome-a@gmail.com","code":"cleaning","format":"pdf","consent":true,"website":"","elapsedMs":4000}' 95.31.18.10
sleep 6
echo "--- B: скачивание с быстрой регистрацией"
post /api/public/blank-download '{"email":"e2e-welcome-b@gmail.com","code":"hygiene","format":"pdf","consent":true,"register":true,"website":"","elapsedMs":4000}' 95.31.18.11
sleep 8
echo "--- C: мгновенная регистрация"
post /api/auth/instant-register '{"email":"e2e-welcome-c@gmail.com","consent":true,"website":""}' 95.31.18.12
sleep 8
