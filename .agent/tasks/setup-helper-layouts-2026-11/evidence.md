# Доказательства — «Сетап помощник» 1.6.0, макеты на телефоне (05.11.2026)

Окружение: JDK 21 (Temurin 21.0.9), Android SDK `D:\Android\sdk` (platform 36 установлен Gradle), Windows Server 2019.

| AC | Статус | Чем подтверждено |
|---|---|---|
| AC1 Ядро | PASS | `:core:test` — `TemplateWriterTest` (все 12 встроенных: запись → разбор, поля, record и разметка `DrawOp` совпадают; черновик правится и собирается; record выпадает без своих полей; копия независима; битый черновик отклоняется), `LayoutEditingTest` (попадание, перенос с шагом 0,5 мм, стрелки, линия, размер, границы, рамка не двигается, масштаб под новый размер, свободное место, вставки). `raw/gradle-site-tests.txt` |
| AC2 Хранение | PASS | `LayoutsTest`: изменённый встроенный подменяет его и возвращается; свой добавляется после встроенных и удаляется; битый файл и файл с чужим `id` пропускаются |
| AC3 Экраны | PASS | `LayoutsTest`: список с пометками, нажатие открывает редактор; в редакторе нажатие выбирает элемент, перетаскивание на 2 мм, правка текста, новое поле «Партия» сразу на этикетке, удаление + «Отменить», сохранение — экран печати показывает новое поле; выход с несохранённым спрашивает; новый макет 40×30 появляется в печати. Скриншоты `raw/1-layouts.png`, `raw/2-editor-selected.png`, `raw/3-editor-field-added.png`, `raw/4-editor-layout-tab.png` |
| AC4 Без авторизации и сети | PASS | новый код — только файлы во внутренней папке (`files/layouts`), без сети и аккаунта; `raw/playRelease-AndroidManifest.xml` — нет `INTERNET`, `ACCESS_NETWORK_STATE`, `REQUEST_INSTALL_PACKAGES`, `UPDATE_PACKAGES_WITHOUT_USER_ACTION`, `RECEIVE_BOOT_COMPLETED`; версия 1.6.0 / versionCode 9, `release-notes.txt`, README |
| AC5 Сборка | PASS | `:core:test` + `:app:testSiteDebugUnitTest` — 120 тестов, 0 падений; `:app:testPlayDebugUnitTest` — 50 тестов, 0 падений (`raw/gradle-play-tests.txt`); `assembleSiteDebug` и `bundlePlayRelease` — BUILD SUCCESSFUL (`raw/gradle-build.txt`) |

Замечание по окружению: на этой машине Robolectric иногда падает при удалении своей временной папки
(`TempDirectory.java:134`, `FileSystemException`) и при запуске site- и play-тестов в одном вызове Gradle
(`UnsatisfiedLinkError` нативной графики). Повтор отдельным вызовом проходит целиком; CI запускает их отдельно.

Не проверено: живой запуск на телефоне или эмуляторе (на машине нет образа эмулятора и аппаратной виртуализации) и печать
на реальном AIYIN IP-802BT.
