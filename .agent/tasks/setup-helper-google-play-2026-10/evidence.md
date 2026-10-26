# Evidence — «Сетап помощник» к Google Play

| AC | Статус | Доказательство |
|---|---|---|
| AC1 site как раньше | PASS | CI run 40316697894: `:app:testSiteDebugUnitTest` зелёный (все прежние тесты, в т. ч. UpdaterTest, UpdateBannerTest); `publishRelease` зависит от `assembleSiteRelease`, путь `apk/site/release/app-site-release.apk` |
| AC2 play без самообновления | PASS | `src/play/AndroidManifest.xml` (`tools:node="remove"`), `BuildConfig.SELF_UPDATE=false`; `PlayFlavorTest` (`testPlayDebugUnitTest`): нет REQUEST_INSTALL_PACKAGES / UPDATE_PACKAGES_WITHOUT_USER_ACTION / RECEIVE_BOOT_COMPLETED, нет заданий JobScheduler, плашка обновления скрыта |
| AC3 CI артефакты | PASS | run 40316697894: `setup-helper-play-aab-*` (app-play-release.aab, 2,6 МБ, подписан ключом выпуска), `setup-helper-release-apk-*`, `setup-helper-store-screenshots-*` |
| AC4 политика | PASS | `src/app/setup-helper/privacy/page.tsx` → https://wesetup.ru/setup-helper/privacy (после деплоя); данные сверены с `ApiClient`, `HelperEvents`, `SessionStore`, моделями `SetupHelperDevice`/`LabelPrinter`; история печати стирается при выходе (`HelperApp.wipeLocalData`) |
| AC5 материалы | PASS | `mobile/setup-helper/store/google-play/`: title 24 знака, краткое 80, полное 1 767; icon 512×512, feature 1024×500, скриншоты телефона 1080×1920 (чистые и с подписями), планшета 7" 1200×1920 и 10" 1600×2560; анкеты, регистрация, инструкция |
| AC6 сайт | PASS | eslint по новым файлам; тесты сайта не затронуты (страница без i18n-каталогов) |

Дополнительно: кнопка «Посмотреть шаблоны этикеток» (просмотр без принтера) — для проверяющих Google и для тех, кто ещё без принтера; тест `PrintHistoryTest.testTemplatesCanBeViewedWithoutPrinter`.

Не сделано (за пользователем): аккаунт Play Console, D-U-N-S, демо-аккаунт для проверки Google (создаём по команде), загрузка в консоль.
