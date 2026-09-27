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
# сайт из эмулятора
adb shell "curl -s -o /dev/null -w '%{http_code}' http://10.0.2.2:3000/mini/login" > "$OUT/emulator-curl.txt" 2>&1 || true
node "$HARNESS/android-e2e.mjs"
code=$?
echo "driver exit $code"
exit $code
