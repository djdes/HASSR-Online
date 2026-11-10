/**
 * Связь приложений WeSetup с доменом wesetup.ru.
 *
 * iOS читает `/.well-known/apple-app-site-association` (универсальные
 * ссылки + ключи доступа), Android — `/.well-known/assetlinks.json`
 * (App Links + общие пароли и ключи доступа). После этого ссылка из бота
 * или с QR-плаката открывается сразу в приложении, если оно стоит, а
 * иначе — на сайте, как раньше.
 *
 * Team ID и отпечатки ключа подписи берутся из переменных окружения
 * (`APPLE_TEAM_ID`, `ANDROID_CERT_SHA256`), чтобы их можно было вписать
 * на сервере без правки кода.
 */

/** Идентификатор приложения на обеих платформах. */
export const APP_BUNDLE_ID = "ru.wesetup.app";

/**
 * Адреса сайта, которые открываются в приложении.
 *
 * Тот же набор зашит в приложение Android —
 * `mobile/android/app/src/main/AndroidManifest.xml` (intent-filter с
 * autoVerify): «/x» там `android:path`, «/x/*» — `android:pathPrefix="/x/"`.
 * Расхождение ловит `app-links.test.ts`. На iPhone новый путь заработает без
 * новой версии приложения (iOS перечитывает файл через CDN Apple — при
 * установке и обновлении приложения), на Android — только с новой версией.
 *
 * Только рабочие сценарии сотрудника: кабинет, журналы, QR-плакаты и
 * наклейки, вход и приглашения. Витрина, тарифы, страницы для гостей
 * (`/b/…`) и проверяющих (`/inspector/…`) остаются в браузере.
 */
export const APP_LINK_PATHS: readonly string[] = [
  "/mini",
  "/mini/*",
  "/journals/*",
  "/join/*",
  "/invite/*",
  "/pair/*",
  "/q/*",
  "/qj/*",
  "/journal-fill/*",
  "/equipment-fill/*",
  "/room-fill/*",
  "/task-fill/*",
  "/delete-account",
];

export type AppleAppSiteAssociation = {
  applinks: {
    details: Array<{ appIDs: string[]; components: Array<{ "/": string }> }>;
  };
  webcredentials: { apps: string[] };
};

export function buildAppleAppSiteAssociation(
  teamId: string,
  bundleId: string,
): AppleAppSiteAssociation {
  const appId = `${teamId.trim()}.${bundleId}`;
  return {
    applinks: {
      details: [
        { appIDs: [appId], components: APP_LINK_PATHS.map((path) => ({ "/": path })) },
      ],
    },
    webcredentials: { apps: [appId] },
  };
}

export type AssetLinkStatement = {
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
};

export function buildAssetLinks(
  packageName: string,
  fingerprints: string[],
): AssetLinkStatement[] {
  return [
    {
      relation: [
        "delegate_permission/common.handle_all_urls",
        "delegate_permission/common.get_login_creds",
      ],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints.map((f) => f.trim()).filter(Boolean),
      },
    },
  ];
}

/**
 * `ANDROID_CERT_SHA256` — отпечатки через запятую: ключ загрузки и ключ
 * подписи Google Play отличаются, и нужны оба. Google сверяет отпечаток
 * в верхнем регистре — приводим, пустые и повторы выбрасываем.
 */
export function parseCertFingerprints(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const value = part.trim().toUpperCase();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * SHA-256 отпечаток сертификата ключа загрузки (`upload.jks`) — им подписаны
 * сборки из workflow «Выпуск приложений» (`app-release.apk`, AAB). Отпечаток
 * сертификата не секрет (он записан в `docs/mobile/secrets.md` и виден в
 * любом APK), поэтому он зашит здесь: без него, пока на сервере не задана
 * `ANDROID_CERT_SHA256`, `/.well-known/assetlinks.json` отдавал пустой
 * список, и Android не открывал ссылки с QR в приложении ни у одной сборки.
 */
export const ANDROID_UPLOAD_CERT_SHA256 =
  "F6:B0:8A:6D:42:D2:1D:F8:55:26:A2:19:91:24:1E:98:C9:B6:64:03:29:9F:E3:98:98:29:B6:E5:1C:4C:F2:89";

/**
 * Отпечатки для `assetlinks.json`: ключ загрузки всегда, плюс то, что задано
 * на сервере в `ANDROID_CERT_SHA256` (ключ подписи приложения из Play Console —
 * он появляется после первой публикации и нужен сборкам, скачанным из Google Play).
 */
export function androidCertFingerprints(raw: string | null | undefined): string[] {
  return parseCertFingerprints([raw ?? "", ANDROID_UPLOAD_CERT_SHA256].join(","));
}

/**
 * Подписанный APK для установки по ссылке (не из магазина). Метка и имя файла
 * те же, что в `.github/workflows/mobile-site-apk.yml`; расхождение ловит
 * `app-links.test.ts`. Сайт отдаёт его по адресу `/download/android`.
 */
export const ANDROID_APK_RELEASE_TAG = "wesetup-app-latest";
export const ANDROID_APK_FILE = "wesetup.apk";
export const ANDROID_APK_URL = `https://github.com/djdes/HASSR-Online/releases/download/${ANDROID_APK_RELEASE_TAG}/${ANDROID_APK_FILE}`;
