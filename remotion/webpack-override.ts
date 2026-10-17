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
        "@": path.join(process.cwd(), "src"),
      },
    },
  });
