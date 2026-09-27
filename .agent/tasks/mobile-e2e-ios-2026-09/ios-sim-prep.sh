#!/usr/bin/env bash
# Фоновая подготовка на macOS: симулятор (новейший iPhone с iOS 26, русский язык),
# Appium с драйвером XCUITest и заранее собранный WebDriverAgent.
# Итог — $STATE/udid и $STATE/sim.done (или sim.fail).
set -uo pipefail
: "${STATE:?}"
trap 'echo "[sim-prep] FAILED at line $LINENO"; touch "$STATE/sim.fail"' ERR
set -e
echo "[sim-prep] $(date -u +%T) runtimes:"
xcrun simctl list runtimes
RUNTIME=$(xcrun simctl list runtimes -j | jq -r '[.runtimes[] | select(.platform=="iOS" and .isAvailable and (.version|startswith("26")))] | sort_by(.version | split(".") | map(tonumber)) | last | .identifier')
[ -n "$RUNTIME" ] && [ "$RUNTIME" != "null" ] || { echo "no iOS 26 runtime"; false; }
echo "[sim-prep] runtime $RUNTIME"
TYPES=$(xcrun simctl list runtimes -j | jq -r --arg r "$RUNTIME" '.runtimes[] | select(.identifier==$r) | .supportedDeviceTypes[] | select(.productFamily=="iPhone") | .name')
echo "$TYPES"
NAME=""
for want in "iPhone 17 Pro" "iPhone 17" "iPhone Air" "iPhone 17 Pro Max" "iPhone 16 Pro"; do
  if echo "$TYPES" | grep -qx "$want"; then NAME="$want"; break; fi
done
[ -n "$NAME" ] || NAME=$(echo "$TYPES" | tail -1)
TYPE_ID=$(xcrun simctl list runtimes -j | jq -r --arg r "$RUNTIME" --arg n "$NAME" '.runtimes[] | select(.identifier==$r) | .supportedDeviceTypes[] | select(.name==$n) | .identifier')
UDID=$(xcrun simctl create "WeSetup E2E" "$TYPE_ID" "$RUNTIME")
echo "$UDID" > "$STATE/udid"
echo "$NAME" > "$STATE/device-name"
echo "$RUNTIME" > "$STATE/runtime"
echo "[sim-prep] created $NAME $UDID"
defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false || true
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
# Русский язык и регион, без обучающих окон клавиатуры — затем перезагрузка.
xcrun simctl spawn "$UDID" defaults write "Apple Global Domain" AppleLanguages -array ru-RU
xcrun simctl spawn "$UDID" defaults write "Apple Global Domain" AppleLocale -string ru_RU
xcrun simctl spawn "$UDID" defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true || true
xcrun simctl spawn "$UDID" defaults write com.apple.keyboard.preferences DidShowGestureKeyboardIntroduction -bool true || true
xcrun simctl shutdown "$UDID"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
echo "[sim-prep] $(date -u +%T) simulator ready"
touch "$STATE/sim.booted"

echo "[sim-prep] install appium"
npm install -g appium@3 --no-fund --no-audit 2>&1 | tail -3
appium --version
appium driver install xcuitest 2>&1 | tail -5
appium driver list --installed 2>&1 | tail -5
WDA=$(find "$HOME/.appium" -type d -name "WebDriverAgent.xcodeproj" -maxdepth 8 | head -1)
echo "[sim-prep] WDA project: $WDA"
echo "[sim-prep] $(date -u +%T) build WDA"
xcodebuild build-for-testing \
  -project "$WDA" \
  -scheme WebDriverAgentRunner \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$STATE/wda" \
  -quiet COMPILER_INDEX_STORE_ENABLE=NO 2>&1 | tail -20
echo "[sim-prep] $(date -u +%T) done"
touch "$STATE/sim.done"
