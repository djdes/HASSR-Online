/**
 * Настройки Remotion CLI (`npx remotion studio remotion/index.ts`).
 * Рендер для главной — `npm run video:render` (scripts/landing-video/render.ts).
 */
import { Config } from "@remotion/cli/config";

import { webpackOverride } from "./remotion/webpack-override";

Config.overrideWebpackConfig(webpackOverride);
Config.setVideoImageFormat("jpeg");
Config.setEntryPoint("remotion/index.ts");
