// Проверка перед подписанной сборкой для магазинов (Android и iOS).
//
// Ловит то, что иначе всплыло бы только у людей на телефонах или на проверке
// в магазине: тестовый адрес сайта вместо wesetup.ru, http, чужой домен в
// списке переходов, версия в User-Agent не та, нет ключа подписи, нет файлов
// Firebase (приложение собралось бы без push-уведомлений).
//
// Запускают: workflow «Выпуск приложений», fastlane (lane release) и Gradle
// перед release-сборкой (android/app/build.gradle). Отладочной сборке
// секреты не нужны — её не проверяем.
//
// В сообщения попадают только НАЗВАНИЯ переменных и файлов, никогда значения:
// логи CI видны всем, у кого есть доступ к репозиторию.
//
// Запуск: node scripts/release-preflight.mjs --platform android|ios
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ID = "ru.wesetup.app";
export const APP_URL = "https://wesetup.ru/mini?src=app";
const ALLOWED_HOSTS = ["wesetup.ru", "www.wesetup.ru"];
export const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Список причин, по которым выпуск нельзя собирать; пустой — можно. */
export function checkRelease({ root = mobileRoot, platform, env = process.env } = {}) {
  const errors = [];
  const read = (relative) => {
    try {
      return readFileSync(path.join(root, relative), "utf8");
    } catch {
      errors.push(`Нет файла ${relative}`);
      return "";
    }
  };
  const json = (relative) => {
    const source = read(relative);
    if (!source) return {};
    try {
      return JSON.parse(source.replace(/^﻿/, ""));
    } catch {
      errors.push(`Файл ${relative} — не JSON`);
      return {};
    }
  };
  const requireEnv = (names) => {
    for (const name of names) {
      if (!env[name]?.trim()) errors.push(`Не задана переменная окружения ${name}`);
    }
  };

  if (!["android", "ios"].includes(platform)) return ["Платформа должна быть android или ios"];

  requireEnv(["BUILD_NUMBER"]);
  if (!/^[1-9]\d{0,9}$/.test(env.BUILD_NUMBER ?? "") || Number(env.BUILD_NUMBER) > 2100000000) {
    errors.push("BUILD_NUMBER — целое число от 1 до 2100000000");
  }
  // WESETUP_APP_URL задают только автотестам в эмуляторе: с ним приложение
  // открыло бы тестовую копию сайта.
  if (env.WESETUP_APP_URL?.trim()) errors.push("WESETUP_APP_URL должна быть пустой: это переменная для автотестов");

  const pkg = json("package.json");
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? "")) errors.push("Версия в package.json — в виде 1.2.3");

  // Конфиг, который `npx cap sync` кладёт в нативный проект, — именно его
  // читает приложение на телефоне, а не capacitor.config.ts.
  const configPath =
    platform === "android" ? "android/app/src/main/assets/capacitor.config.json" : "ios/App/App/capacitor.config.json";
  const config = json(configPath);
  if (config.appId !== APP_ID) errors.push(`appId в ${configPath} — не ${APP_ID}`);
  if (config.server?.url !== APP_URL || config.server?.cleartext !== false) {
    errors.push(`Приложение должно открывать ${APP_URL} по https (в ${configPath} другой адрес или разрешён http)`);
  }
  const hosts = config.server?.allowNavigation;
  if (!Array.isArray(hosts) || !hosts.includes("wesetup.ru") || hosts.some((host) => !ALLOWED_HOSTS.includes(host))) {
    errors.push(`В allowNavigation (${configPath}) лишние адреса: допустимы только ${ALLOWED_HOSTS.join(", ")}`);
  }
  if (config[platform]?.appendUserAgent !== `WeSetupApp/${pkg.version} (${platform})`) {
    errors.push(`User-Agent в ${configPath} не совпадает с версией ${pkg.version} — выполните npx cap sync`);
  }
  if (config.server?.errorPath !== "offline.html" || !existsSync(path.join(root, "www/offline.html"))) {
    errors.push("Нет экрана «Нет связи» (www/offline.html и server.errorPath)");
  }

  if (platform === "android") {
    requireEnv(["ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]);
    if (!existsSync(path.join(root, "android/app/upload.jks"))) {
      errors.push("Нет ключа загрузки android/app/upload.jks (секрет ANDROID_KEYSTORE_BASE64)");
    }
    const firebase = json("android/app/google-services.json");
    const client = firebase.client?.find((c) => c.client_info?.android_client_info?.package_name === APP_ID);
    if (
      !client ||
      !firebase.project_info?.project_id ||
      !firebase.project_info?.project_number ||
      !client.client_info?.mobilesdk_app_id ||
      !client.api_key?.some((k) => k.current_key)
    ) {
      errors.push(`google-services.json (Firebase Android) не для ${APP_ID} или неполный — без него не будет push`);
    }
  } else {
    requireEnv(["APPLE_TEAM_ID", "ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH"]);
    if (env.APPLE_TEAM_ID && !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)) errors.push("APPLE_TEAM_ID — 10 латинских букв и цифр");
    if (env.ASC_KEY_ID && !/^[A-Z0-9]{10}$/.test(env.ASC_KEY_ID)) errors.push("ASC_KEY_ID — 10 латинских букв и цифр");
    if (env.ASC_ISSUER_ID && !/^[a-f0-9-]{36}$/i.test(env.ASC_ISSUER_ID)) errors.push("ASC_ISSUER_ID — в виде UUID");
    if (env.ASC_KEY_PATH && !existsSync(env.ASC_KEY_PATH)) errors.push("Нет файла ключа App Store Connect API (ASC_KEY_PATH)");
    const plist = read("ios/App/App/GoogleService-Info.plist");
    const value = (key) => plist.match(new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([^<]+)</string>`))?.[1]?.trim();
    if (
      value("BUNDLE_ID") !== APP_ID ||
      !value("GOOGLE_APP_ID") ||
      !value("PROJECT_ID") ||
      !value("GCM_SENDER_ID") ||
      !value("API_KEY")
    ) {
      errors.push(`GoogleService-Info.plist (Firebase iOS) не для ${APP_ID} или неполный — без него не будет push`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--platform");
  const platform = index >= 0 ? process.argv[index + 1] : undefined;
  const errors = checkRelease({ platform });
  for (const error of errors) console.error(`Выпуск остановлен: ${error}`);
  if (errors.length) process.exitCode = 1;
  else console.log(`Проверка перед выпуском пройдена: ${platform}, сборка ${process.env.BUILD_NUMBER}`);
}
