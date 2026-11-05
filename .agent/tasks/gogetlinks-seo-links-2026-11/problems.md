# Problems Found During Proof-Loop Verification (`gogetlinks-seo-links-2026-11`)

## Pass 1 — ESLint (`AC8`)

Running `npx eslint src/lib/seo src/lib/platform-access.ts src/app/root/seo src/app/api/root/gogetlinks src/app/api/cron/gogetlinks src/components/root/seo-subnav.tsx src/components/root/seo-links` exited with code `1`:

1. **`src/lib/seo/gogetlinks-client.server.ts:90:48` (`error @typescript-eslint/no-require-imports`)**
   - `getFetchImpl()` used CommonJS `require("undici")` instead of an ES module import, plus 11 `@typescript-eslint/no-explicit-any` warnings on `prismaClient?: any` and raw balance row casts.
2. **`src/lib/seo/gogetlinks-codec.test.ts:241:47` & `301:28` (2 warnings)**
   - Unused parameter `init` (should be `_init`) and `args: any` on mock `gglAccount.update`.

### Resolution Applied

- Replaced `require("undici")` in `src/lib/seo/gogetlinks-client.server.ts` with typed ESM `import { ProxyAgent, fetch as undiciFetch } from "undici"` and introduced `GglPrismaClientLike` + `Record<string, unknown>` types instead of `any`.
- Replaced `(url, init)` with `(url, _init)` and typed `update` mock argument in `src/lib/seo/gogetlinks-codec.test.ts`.
- Re-ran `typecheck`, `eslint`, and all `src/lib/seo/*.test.ts` + `src/lib/platform-access.test.ts` checks to verify `0` errors and `0` warnings.

---

## Pass 2 — Public Dark Theme / Hardcoded Color Token (`AC7`, `AC8`)

Running `src/components/public/public-dark-theme.test.ts` caught a hardcoded color hex class `[&_a]:text-[#3848c7]` in `src/components/root/seo-links/ArticleDrawer.tsx:370` during the full test suite run.

### Resolution Applied

- Replaced `[&_a]:text-[#3848c7]` with semantic design token `[&_a]:text-primary` in `src/components/root/seo-links/ArticleDrawer.tsx`.
- Re-ran `npx.cmd tsx --test src/lib/seo/*.test.ts src/lib/platform-access.test.ts src/components/public/public-dark-theme.test.ts` -> 72 tests passed, 0 failures (`raw/seo-and-access-tests.txt`).
- Re-ran `npm.cmd run typecheck` -> EXIT_CODE=0 (`raw/typecheck.txt`).
- Re-ran `npx.cmd eslint src/lib/seo src/lib/platform-access.ts src/app/root/seo src/app/api/root/gogetlinks src/app/api/cron/gogetlinks src/components/root/seo-subnav.tsx src/components/root/seo-links` -> EXIT_CODE=0, 0 errors, 0 warnings (`raw/eslint-seo.txt`).
