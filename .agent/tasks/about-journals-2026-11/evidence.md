# Public WeSetup About page evidence

| Criterion | Implementation and verification |
| --- | --- |
| AC1 | The public catalog and shared footer link to the localized About route. Playwright checked the rendered anchors and anonymous HTTP 200 responses for all three About pages. |
| AC2 | Playwright checked localized headings, links to four journal examples, the features and registration links, contact data, and the product image with JavaScript disabled. It checked the main content at 390 px and captured Russian layouts at 390 px and 1440 px. |
| AC3 | Playwright checked clean self-canonicals on tracked URLs, all language alternates, social previews, AboutPage and BreadcrumbList markup, robots metadata, and all localized sitemap entries. The robots regression test checks that each URL is allowed. |
| AC4 | The generated translation contract and neutral palette passed their check modes. A fresh targeted gate passed 326 tests across 73 files. The full project typecheck and targeted ESLint exited successfully. The rendered HTTP check passed again on the current code. |

Run the HTTP and layout checks with `node .agent/tasks/about-journals-2026-11/verify.mjs` against a local Next dev server port 3157. Optionally set `ABOUT_VERIFY_URL` and `ABOUT_CHROME_PATH` to use another server and installed Chrome. Raw logs and screenshots are in `raw/`.
