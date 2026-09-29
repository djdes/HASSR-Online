import type { NextConfig } from "next";
import { execSync } from "child_process";
import { readFileSync } from "fs";

function getBuildId(): string {
  // CI writes .build-sha before tarball
  try {
    const sha = readFileSync(".build-sha", "utf-8").trim();
    return sha.slice(0, 7);
  } catch {
    // Fallback: local dev with git
    try {
      return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      return "dev";
    }
  }
}

function getBuildTime(): string {
  try {
    return readFileSync(".build-time", "utf-8").trim();
  } catch {
    return new Date().toISOString();
  }
}

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Штатная нормализация трейлинг-слеша срабатывает ДО middleware и
  // отвечает редиректом 308. Робокасса шлёт уведомление об оплате
  // POST'ом на `https://wesetup.ru/payment/` (адрес зафиксирован в
  // кабинете магазина) и за редиректом не идёт — платежи молча
  // терялись. Отключаем автоматический редирект и обрабатываем слеш
  // сами в middleware: `/payment/` переписываем, остальным путям
  // отдаём тот же 308, что и раньше.
  skipTrailingSlashRedirect: true,
  // Рендер превью журналов (PDF → PNG) идёт в Node без браузера: pdfjs
  // тянет свой worker динамическим import'ом по относительному пути, а
  // @napi-rs/canvas — нативный бинарник. Внутри серверного бандла ни то,
  // ни другое не работает — оставляем их обычными node_modules.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  experimental: {
    // Proxy (src/proxy.ts) буферизует тело запроса и по умолчанию
    // обрезает его на 10 МБ. Скан приказа к журналу — до 10 МБ
    // (journal-order-scans.ts), плюс обёртка multipart: без запаса файл
    // ровно в лимит приходил бы обрезанным.
    proxyClientMaxBodySize: "12mb",
  },
  typescript: {
    // Temporary deploy unblocker: unrelated dashboard pages still carry legacy Next build type errors.
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_BUILD_ID: getBuildId(),
    NEXT_PUBLIC_BUILD_TIME: getBuildTime(),
  },
  async headers() {
    // The original rule applied `Cache-Control: no-store` to EVERY path. For
    // HTML pages that's intentional — the app deploys frequently, users must
    // always get fresh markup. For hashed Next.js build assets under
    // `/_next/static/*` it was unintended: those filenames already carry a
    // content hash and should be cached for a year. Without that, every
    // navigation re-downloaded ~300 KB of chunks from mobile networks, which
    // is what users reported as "сайт долго грузится на телефоне".
    //
    // The negative-lookahead source below excludes Next's static folders and
    // a couple of fixed public assets; everything else keeps the strict
    // no-cache behaviour. `/_next/image` keeps its own `Cache-Control:
    // public, max-age=0, must-revalidate` default from Next so dynamic image
    // optimisation still respects upstream caching rules.
    // Security headers применяются ко ВСЕМ путям (включая
    // _next/static — статика тоже выигрывает от X-Content-Type-Options
    // и т.п.). Cache-Control вешаем отдельной record'ой только на
    // не-статические пути.
    //
    // Не добавляем Content-Security-Policy: для этого нужен полный
    // аудит inline-скриптов / третьесторонних embed'ов (Telegram WebApp
    // SDK, Yandex.Metrika, и т.д.). Раскатывать без аудита = риск
    // сломать Telegram Mini App / iframe widget'ы. Это отдельная задача.
    const commonSecurityHeaders = [
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        // HSTS на 1 год БЕЗ preload и БЕЗ includeSubDomains. preload —
        // одностороннее решение (попасть в preload-list browser'ов
        // легко, выпасть — почти невозможно), пока не уверены что ВСЕ
        // субдомены готовы к https. С includeSubDomains та же проблема.
        // Без них — стандартная защита от downgrade-атак на основном
        // домене.
        key: "Strict-Transport-Security",
        value: "max-age=31536000",
      },
    ];

    // Permissions-Policy отличается у /mini и у остального сайта,
    // поэтому собирается отдельно, а не лежит в общем списке: два
    // заголовка с одним ключом в одном правиле Next.js отдаёт оба, и
    // какой из них применит браузер — не определено.
    //
    // - geolocation=(self): нужен `mini/_components/geo-reminder.tsx`
    //   (watchPosition). Когда-то стояло `geolocation=()`, и
    //   geo-напоминания молча не работали.
    // - microphone=(self): нужен ВЕЗДЕ, где рисуется `DynamicForm` —
    //   в ней есть надиктовка (`components/journals/voice-input.tsx`),
    //   а Web Speech API браузер гасит по этой политике. С `microphone=()`
    //   кнопка надиктовки была мёртвой и на сайте, и в Mini App.
    // - camera: `<input type="file" capture>` открывает нативный picker
    //   и в разрешении НЕ нуждается — поэтому на сайте камера закрыта.
    //   Внутри /mini она открыта под сканер QR прямо в браузере: вне
    //   Telegram нативного `showScanQrPopup` нет, а сканировать нужно.
    //   На наклейках холодильников и складов (/equipment-fill, /room-fill)
    //   тоже открыта: «Следующий QR» сканирует камерой прямо на странице.
    const permissionsPolicy = (camera: "()" | "(self)") => ({
      key: "Permissions-Policy",
      value: `camera=${camera}, microphone=(self), geolocation=(self)`,
    });

    // Default frame policy: DENY всё.
    const denyFrameHeaders = [
      ...commonSecurityHeaders,
      permissionsPolicy("()"),
      { key: "X-Frame-Options", value: "DENY" },
    ];

    // Mini App внутри Telegram Web (web.telegram.org) загружается в
    // iframe. С X-Frame-Options=DENY этот iframe блокировался —
    // Mini App был мёртв на Telegram Web/Desktop. Mobile (iOS/Android)
    // использует WebView, без iframe-restriction'а, поэтому работало.
    //
    // Решение: для /mini/* отдаём CSP frame-ancestors с явным whitelist'ом
    // Telegram-доменов вместо X-Frame-Options. CSP frame-ancestors
    // overрайдит X-Frame-Options в современных browser'ах.
    const miniFrameHeaders = [
      ...commonSecurityHeaders,
      permissionsPolicy("(self)"),
      {
        key: "Content-Security-Policy",
        value:
          "frame-ancestors 'self' https://web.telegram.org https://telegram.org https://*.telegram.org",
      },
    ];

    // Наклейки холодильников и складов: «Следующий QR» сканирует камерой
    // прямо на странице (2026-09-23). Фреймы — как у остального сайта.
    const objectStickerHeaders = [
      ...commonSecurityHeaders,
      permissionsPolicy("(self)"),
      { key: "X-Frame-Options", value: "DENY" },
    ];

    // PDF коммерческого предложения (/kp/<токен>/pdf) ROOT-генератор
    // показывает во встроенном просмотре на своей же странице
    // (/root/proposals). DENY запрещает даже свой origin — здесь SAMEORIGIN:
    // чужой сайт по-прежнему не встроит.
    const proposalPdfHeaders = [
      ...commonSecurityHeaders,
      permissionsPolicy("()"),
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
    ];

    return [
      {
        // Mini App: разрешаем embedding в Telegram Web.
        source: "/mini/:path*",
        headers: miniFrameHeaders,
      },
      {
        source: "/mini",
        headers: miniFrameHeaders,
      },
      {
        source: "/equipment-fill/:path*",
        headers: objectStickerHeaders,
      },
      {
        source: "/room-fill/:path*",
        headers: objectStickerHeaders,
      },
      {
        source: "/kp/:token/pdf",
        headers: proposalPdfHeaders,
      },
      {
        // Все остальные пути (кроме /mini, /mini/*) — security headers
        // + frame DENY. Negative lookahead через regex-source: Next.js
        // применяет ВСЕ matching rules одновременно, поэтому без
        // исключения /mini получает И CSP frame-ancestors, И
        // X-Frame-Options=DENY (последний переоригинировал бы).
        //
        // path-to-regexp запрещает capturing groups, поэтому
        // `(?:$|/)` non-capturing вместо `($|/)`. Без `(?:` build
        // фейлится с «Capturing groups are not allowed».
        // api/journal-samples тоже исключены: страница журнала
        // показывает собственный образец во встроенном просмотре, а
        // X-Frame-Options: DENY запрещает даже свой же origin. В файле
        // нет ни сессии, ни чужих данных — вставлять его безопасно.
        // kp/<токен>/pdf — встроенный просмотр КП в ROOT (SAMEORIGIN выше).
        source: "/((?!mini(?:$|/)|api/journal-samples|equipment-fill/|room-fill/|kp/[^/]+/pdf$).*)",
        headers: denyFrameHeaders,
      },
      {
        // api/journal-samples исключены намеренно: это публичные
        // образцы журналов с зафиксированным периодом — один и тот же
        // файл при каждом запросе. Под глобальным no-store каждое
        // скачивание заново гоняло jsPDF на полмегабайта, а роут открыт
        // без сессии — бесплатная нагрузка на CPU для любого желающего.
        // Свой Cache-Control роут выставляет сам.
        // api/journal-previews — снимки журналов организации: приватные
        // (`private, immutable`), версия в URL меняется с перерисовкой,
        // поэтому браузер держит их сколько угодно. Под no-store каждая
        // карточка дашборда заново качала бы ~100 КБ PNG.
        //
        // 2026-09-08: сюда же добавлены СТАТИЧЕСКИЕ папки из public/.
        // В списке был только РОУТ `api/journal-samples`, а сама папка
        // `/journal-samples/` (40 webp, 1,1 МБ) — нет, поэтому образцы
        // бланков качались заново при каждом заходе на /journals-info,
        // дашборд и /settings/journals: это и были недостающие ~400 КБ
        // из 465 КБ трафика каталога журналов. То же с `/brand/` и
        // `/icons/`. Свой Cache-Control им выставлен ниже.
        //
        // `uploads/` — файлы, загруженные людьми. Их отдаёт маршрут
        // `app/uploads/[...path]`, и он сам ставит `private, immutable`:
        // имена случайные, содержимое по ним не меняется. Под общим
        // no-store фото в журнале качалось бы заново при каждом
        // открытии записи.
        //
        // `b/<код>/badge.svg` — публичный бейдж, который вставляют на чужие
        // сайты; маршрут сам ставит `public, max-age=900`, иначе картинка
        // качалась бы при каждом показе страницы клиента.
        //
        // `api/kp/qr/` — QR в письме с КП: картинка зависит только от адреса,
        // маршрут ставит `public, immutable` — почтовые прокси её кэшируют.
        source:
          "/((?!_next/static|_next/image|api/journal-samples|api/journal-previews|api/kp/qr/|journal-samples/|brand/|icons/|uploads/|favicon\\.ico|manifest\\.json|sw\\.js|robots\\.txt|sitemap\\.xml|screenshots/|b/[a-z0-9]+/badge\\.svg|og/image|og-default|blog/feed\\.xml|whats-new/feed\\.xml).*)",
        headers: [
          {
            key: "Cache-Control",
            value:
              "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
          {
            key: "Expires",
            value: "0",
          },
        ],
      },
      {
        // Образцы бланков: имена файлов НЕ содержат хеша содержимого
        // (`cleaning.webp`, `hygiene.webp`), поэтому «на год» ставить
        // нельзя — после перегенерации через
        // `scripts/render-journal-sample-thumbs.ts` браузер держал бы
        // старую картинку. Час + сутки stale-while-revalidate: повторный
        // заход бесплатен, обновлённый образец доезжает к следующему дню.
        source: "/journal-samples/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // Иконки приложения и брендинг меняются реже релизов, а тянет их
        // каждая страница (манифест, шапка, письма).
        source: "/:dir(icons|brand)/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
