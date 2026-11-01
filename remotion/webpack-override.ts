import path from "node:path";

import type { WebpackOverrideFn } from "@remotion/bundler";
import { enableTailwind } from "@remotion/tailwind-v4";

/**
 * Сборка видео идёт вебпаком Remotion, не Next: нужны алиас `@/` (как в
 * tsconfig) и Tailwind v4 для классов сцены. Общая для CLI
 * (`remotion.config.ts`) и скрипта рендера.
 */
export const webpackOverride: WebpackOverrideFn = (config) =>
  enableTailwind({
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...(config.resolve?.alias as Record<string, string> | undefined),
        // Раньше «@»: точное совпадение должно сработать первым (см. заглушку).
        "@/lib/translations/overrides.server$": path.join(process.cwd(), "remotion/stubs/translation-overrides.ts"),
        "@": path.join(process.cwd(), "src"),
      },
    },
  });
