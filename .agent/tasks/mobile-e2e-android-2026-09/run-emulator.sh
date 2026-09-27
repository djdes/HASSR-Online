#!/usr/bin/env bash
# Внутри reactivecircus/android-emulator-runner: ставим тестовый APK и гоняем сценарии.
set -u
OUT=e2e-out
mkdir -p "$OUT"
adb wait-for-device
adb shell getprop ro.build.version.sdk
adb shell dumpsys webviewupdate | head -20 > "$OUT/webview.txt" || true
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb shell dumpsys package ru.wesetup.app | grep -E "versionName|targetSdk|permission" | head -30 > "$OUT/package.txt" || true
# доступность прода с раннера (для prod-smoke)
curl -sS -o /dev/null -w 'runner -> wesetup.ru %{http_code} %{time_total}s
' https://wesetup.ru/mini/login > "$OUT/runner-curl.txt" 2>&1 || true
# копия сайта для приложения: 127.0.0.1:3000 телефона -> 3000 раннера
adb reverse tcp:3000 tcp:3000
{ adb shell ping -c 2 wesetup.ru; adb shell getprop net.dns1; } > "$OUT/emulator-net.txt" 2>&1 || true
node "$HARNESS/android-e2e.mjs"
code=$?
echo "driver exit $code"
exit $code
