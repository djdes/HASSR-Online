#!/usr/bin/env bash
# Фоновая сборка приложения для симулятора, как в mobile-check.yml, но с адресом
# тестовой копии сайта (WESETUP_APP_URL) и только в CI: экран «Нет связи»
# повторяет тестовый адрес, ATS разрешает локальную сеть.
# Итог — $STATE/App.app, $STATE/AppFB.app (с тестовым GoogleService-Info.plist) и app.done.
set -uo pipefail
: "${STATE:?}" "${APP_URL:?}"
trap 'echo "[app-build] FAILED at line $LINENO"; touch "$STATE/app.fail"' ERR
set -e
cd "$GITHUB_WORKSPACE/mobile"
echo "[app-build] $(date -u +%T) npm ci"
npm ci --no-fund --no-audit 2>&1 | tail -3
sed -i '' "s#https://wesetup.ru/mini?src=app#${APP_URL}#" www/offline.html
grep -n "START_URL =" www/offline.html
WESETUP_APP_URL="$APP_URL" npx cap sync ios 2>&1 | tail -30
# Только тестовая сборка: WebView доступен Appium (Web Inspector) — явно, не полагаясь на #if DEBUG.
CFG=ios/App/App/capacitor.config.json
jq '.ios.webContentsDebuggingEnabled = true' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
cat "$CFG"
PL=ios/App/App/Info.plist
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity dict" "$PL"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$PL"
/usr/libexec/PlistBuddy -c "Add :CAPACITOR_DEBUG string true" "$PL"
echo "[app-build] $(date -u +%T) xcodebuild"
cd ios/App
set +e
xcodebuild build \
  -workspace App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath "$STATE/dd" \
  CODE_SIGNING_ALLOWED=NO \
  COMPILER_INDEX_STORE_ENABLE=NO > "$LOGS/xcodebuild.log" 2>&1
RC=$?
set -e
grep -E "warning:|error:|\*\* BUILD" "$LOGS/xcodebuild.log" | grep -v "Pods/" | sort -u | tail -60 || true
[ $RC -eq 0 ] || { echo "xcodebuild rc=$RC"; tail -80 "$LOGS/xcodebuild.log"; false; }
APP=$(find "$STATE/dd/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name "*.app" | head -1)
echo "[app-build] app: $APP"
rm -rf "$STATE/App.app" "$STATE/AppFB.app"
cp -R "$APP" "$STATE/App.app"
cat > "$STATE/dev.entitlements" <<'ENT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>get-task-allow</key><true/></dict></plist>
ENT
sign_app() {
  codesign --force --deep --sign - "$1"
  # Без entitlements: с get-task-allow в подписи симулятор отказал в запуске (run 3).
  codesign -d --entitlements - "$1" 2>&1 | tail -5 || true
}
sign_app "$STATE/App.app"
# Вариант с тестовым Firebase: только чтобы нажатие на уведомление дошло до
# сайта (без файла Firebase плагин push не подключает обработчик нажатий).
cp -R "$APP" "$STATE/AppFB.app"
cat > "$STATE/AppFB.app/GoogleService-Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>API_KEY</key><string>AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q</string>
  <key>GCM_SENDER_ID</key><string>123456789012</string>
  <key>PLIST_VERSION</key><string>1</string>
  <key>BUNDLE_ID</key><string>ru.wesetup.app</string>
  <key>PROJECT_ID</key><string>wesetup-e2e-fake</string>
  <key>STORAGE_BUCKET</key><string>wesetup-e2e-fake.appspot.com</string>
  <key>IS_ADS_ENABLED</key><false/>
  <key>IS_ANALYTICS_ENABLED</key><false/>
  <key>IS_APPINVITE_ENABLED</key><false/>
  <key>IS_GCM_ENABLED</key><true/>
  <key>IS_SIGNIN_ENABLED</key><false/>
  <key>GOOGLE_APP_ID</key><string>1:123456789012:ios:0123456789abcdef012345</string>
</dict>
</plist>
PLIST
sign_app "$STATE/AppFB.app"
plutil -p "$STATE/App.app/Info.plist" | grep -E "NSAppTransport|NSAllowsLocal|CFBundleIdentifier|UILaunchStoryboard|UIMainStoryboard|UISceneStoryboard" || true
echo "[app-build] $(date -u +%T) done"
touch "$STATE/app.done"
