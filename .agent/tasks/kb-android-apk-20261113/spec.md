# Android APK link in the knowledge base

Frozen before implementation: 2026-11-13.

Request: provide the WeSetup APK link and explain why the knowledge base has no APK link. Investigation found that the main application's signed APK is served by the existing `/download/android` redirect to the official `wesetup-app-latest/wesetup.apk` release. The knowledge-base Telegram article only points readers to links at the bottom of the homepage.

Scope: add one concise article under the existing employee-phone group with a direct APK link and installation steps. Replace the indirect homepage instruction with a link to that article. Reuse the existing article/navigation renderer and stable download route. No application binary, release, endpoint, layout or translation-catalog change.

- AC1: The main APK download URL is checked against the official release and returns a redirect to a downloadable Android package. Do not substitute the separate label-printing helper app.
- AC2: `/baza-znaniy/prilozhenie-android` appears in the existing knowledge-base navigation, exposes a direct native link to `https://wesetup.ru/download/android`, and explains downloading, Android's browser-install prompt and signing in. The former indirect mention points to this article.
- AC3: Existing knowledge-base, inline-rendering and APK-route checks, ESLint, typecheck and the repository test gate pass. A fresh verification records current-source evidence and all AC verdicts. No implementation-mirroring test is added for this content correction.
- AC4: Deliver through a mergeable green PR squash-merged into current master, preserve unrelated working-tree edits, and verify successful deployment plus the live article and APK link.

Keep evidence and raw results in `.agent/tasks/kb-android-apk-20261113/`. Use the clean reusable checkout from the previous completed task, on a new branch based on fresh origin/master. No real notifications or emails are sent by task tools.
