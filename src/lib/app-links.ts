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

/** Адреса сайта, которые открываются в приложении. */
export const APP_LINK_PATHS: readonly string[] = [
  "/mini",
  "/mini/*",
  "/journals/*",
  "/join/*",
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
