# Evidence: APK по ссылке с сайта (до слияния)

| AC | Статус | Чем подтверждено |
|----|--------|------------------|
| AC1 | PASS (код) | `.github/workflows/mobile-site-apk.yml`; запуск возможен только после слияния в master — итог в AC3 |
| AC2 | PASS | `src/app/download/android/route.test.ts`, `src/lib/app-links.test.ts` (метка и имя файла совпадают с workflow) |
| AC3 | после слияния | проверяется запуском workflow и запросом к `https://wesetup.ru/download/android` |
| AC4 | PASS | `raw/typecheck.txt` (exit 0), `raw/test-gate.txt` (pass=6033, fail=0); `mobile/README.md` |
