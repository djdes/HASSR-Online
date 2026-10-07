import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ID = "ru.wesetup.app";
export const APP_URL = "https://wesetup.ru/mini?src=app";
export const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Return names/reasons only: signing material must never appear in logs.
export function checkRelease({ root = mobileRoot, platform, env = process.env } = {}) {
  const errors = [];
  const read = (relative) => {
    try { return readFileSync(path.join(root, relative), "utf8"); }
    catch { errors.push(`Missing file: ${relative}`); return ""; }
  };
  const json = (relative) => {
    const source = read(relative);
    if (!source) return {};
    try { return JSON.parse(source.replace(/^\uFEFF/, "")); }
    catch { errors.push(`Invalid JSON: ${relative}`); return {}; }
  };
  const requireEnv = (names) => {
    for (const name of names) if (!env[name]?.trim()) errors.push(`Missing environment variable: ${name}`);
  };
  if (!["android", "ios"].includes(platform)) return ["Platform must be android or ios"];
  requireEnv(["BUILD_NUMBER"]);
  if (!/^[1-9]\d{0,9}$/.test(env.BUILD_NUMBER ?? "") || Number(env.BUILD_NUMBER) > 2100000000)
    errors.push("BUILD_NUMBER must be an integer between 1 and 2100000000");
  if (env.WESETUP_APP_URL?.trim()) errors.push("WESETUP_APP_URL must be unset for a store release");
  const pkg = json("package.json");
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? "")) errors.push("App version must be major.minor.patch");

  const configPath = platform === "android" ? "android/app/src/main/assets/capacitor.config.json" : "ios/App/App/capacitor.config.json";
  const config = json(configPath);
  if (config.appId !== APP_ID) errors.push("Generated app ID must be ru.wesetup.app");
  if (config.server?.url !== APP_URL || config.server?.cleartext !== false)
    errors.push("Generated server configuration must use the HTTPS production URL with cleartext disabled");
  const hosts = config.server?.allowNavigation;
  if (!Array.isArray(hosts) || !hosts.includes("wesetup.ru") || hosts.some((host) => !["wesetup.ru", "www.wesetup.ru"].includes(host)))
    errors.push("Generated navigation allowlist contains unexpected hosts");
  if (config[platform]?.appendUserAgent !== `WeSetupApp/${pkg.version} (${platform})`)
    errors.push("Generated User-Agent does not match the platform and app version");
  if (config.server?.errorPath !== "offline.html" || !existsSync(path.join(root, "www/offline.html")))
    errors.push("Offline fallback is missing");

  if (platform === "android") {
    requireEnv(["ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]);
    if (!existsSync(path.join(root, "android/app/upload.jks"))) errors.push("Missing Android upload keystore");
    const firebase = json("android/app/google-services.json");
    const client = firebase.client?.find((c) => c.client_info?.android_client_info?.package_name === APP_ID);
    if (!client || !firebase.project_info?.project_id || !firebase.project_info?.project_number || !client.client_info?.mobilesdk_app_id || !client.api_key?.some((k) => k.current_key))
      errors.push("Firebase Android config must contain this app, project, app ID and API key");
  } else {
    requireEnv(["APPLE_TEAM_ID", "ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH"]);
    if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID ?? "")) errors.push("Invalid APPLE_TEAM_ID format");
    if (!/^[A-Z0-9]{10}$/.test(env.ASC_KEY_ID ?? "")) errors.push("Invalid ASC_KEY_ID format");
    if (!/^[a-f0-9-]{36}$/i.test(env.ASC_ISSUER_ID ?? "")) errors.push("Invalid ASC_ISSUER_ID format");
    if (!env.ASC_KEY_PATH || !existsSync(env.ASC_KEY_PATH)) errors.push("App Store Connect API key file is missing");
    const plist = read("ios/App/App/GoogleService-Info.plist");
    const value = (key) => plist.match(new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([^<]+)</string>`))?.[1]?.trim();
    if (value("BUNDLE_ID") !== APP_ID || !value("GOOGLE_APP_ID") || !value("PROJECT_ID") || !value("GCM_SENDER_ID") || !value("API_KEY"))
      errors.push("Firebase iOS config must match ru.wesetup.app and contain the project, sender, app ID and API key");
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const platform = process.argv[process.argv.indexOf("--platform") + 1];
  const errors = checkRelease({ platform });
  for (const error of errors) console.error(`Release blocked: ${error}`);
  if (errors.length) process.exitCode = 1;
  else console.log(`Release preflight PASS: ${platform}, build ${process.env.BUILD_NUMBER}`);
}
