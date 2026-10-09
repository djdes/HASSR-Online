import { Bot, Composer, type Context } from "grammy";
import { Agent, ProxyAgent, setGlobalDispatcher } from "undici";
import { registerStartHandler } from "./handlers/start";
import { registerStopHandler } from "./handlers/stop";
import { registerInlineQueryHandler } from "./handlers/inline";
import { registerShortcutHandlers } from "./handlers/shortcut";
import { registerEditHandlers } from "./handlers/edit";
import {
  registerOwnerStatsHandlers,
  registerOwnerExtendedHandlers,
} from "./handlers/owner-stats";
import { registerStaffToolsHandlers } from "./handlers/staff-tools";
import { registerSupportHandlers } from "./handlers/support";
import { registerShiftGateHandler } from "./handlers/shift-gate";
import { createTelegramFetch } from "@/lib/telegram-fetch";
import { getMiniAppBaseUrlFromEnv } from "@/lib/journal-obligation-links";
import {
  configureTelegramBotProfile,
  configureTelegramBotRuntimeMenu,
} from "./setup";

/**
 * Grammy bot app singleton.
 *
 * Shared with the outbound message path in `src/lib/telegram.ts` but kept
 * as its own file because the inbound (webhook) layer needs the `Bot`
 * instance exposed to call `bot.handleUpdate(...)` directly, and because
 * webhook dispatch requires a `Composer` we can register handlers on.
 *
 * DNS / apiRoot overrides mirror the outbound bot in telegram.ts so that
 * incoming webhook processing (e.g. replying with sendMessage) takes the
 * same reachability path when Telegram's canonical IPs are blocked.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const apiRoot = process.env.TELEGRAM_API_ROOT?.replace(/\/+$/, "") || undefined;
const forceIp = process.env.TELEGRAM_FORCE_IP?.trim() || undefined;
// Keep this proxy scoped to Telegram requests; other integrations stay direct.
const proxyUrl = process.env.TELEGRAM_PROXY_URL?.trim() || undefined;
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

if (forceIp && !proxyAgent) {
  setGlobalDispatcher(
    new Agent({
      connect: {
        lookup: ((
          hostname: string,
          options: object,
          callback: (
            err: NodeJS.ErrnoException | null,
            addresses: { address: string; family: number }[]
          ) => void
        ) => {
          if (hostname === "api.telegram.org") {
            callback(null, [{ address: forceIp, family: 4 }]);
            return;
          }
          import("node:dns").then(({ lookup }) => {
            lookup(hostname, { ...options, all: true }, callback);
          });
        }) as unknown as undefined,
      },
    })
  );
}

// grammY uses its own fetch; configure the same scoped transport for all calls.
const tgFetch = forceIp || proxyAgent ? createTelegramFetch(proxyAgent) : undefined;

let cachedBot: Bot | null = null;
let initPromise: Promise<void> | null = null;
let commandsPromise: Promise<void> | null = null;

export function getInboundBot(): Bot | null {
  if (!token) return null;
  if (cachedBot) return cachedBot;
  cachedBot = new Bot(token, {
    client: {
      ...(apiRoot ? { apiRoot } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(tgFetch ? { fetch: tgFetch as any } : {}),
    },
  });
  const composer = new Composer<Context>();
  registerStartHandler(composer);
  registerShiftGateHandler(composer);
  registerStopHandler(composer);
  registerShortcutHandlers(composer);
  registerOwnerStatsHandlers(composer);
  registerOwnerExtendedHandlers(composer);
  registerStaffToolsHandlers(composer);
  registerEditHandlers(composer);
  registerInlineQueryHandler(composer);
  // Строго последним из message-обработчиков: catch-all `on("message:text")`
  // ловит всё, что не разобрали команды выше, и отправляет это в поддержку.
  registerSupportHandlers(composer);
  cachedBot.use(composer);
  return cachedBot;
}

/**
 * Grammy requires `bot.init()` to have run once before `handleUpdate()` can
 * dispatch. In serverless handlers we lazy-init on the first webhook.
 */
export async function ensureBotInit(bot: Bot): Promise<void> {
  if (!initPromise) {
    initPromise = bot.init().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;

  if (!commandsPromise) {
    const miniAppBaseUrl = getMiniAppBaseUrlFromEnv();
    // Если mini-app base URL настроен — применяем full profile (имя,
    // описания, команды, menu-button) за один идемпотентный прогон.
    // Telegram API не даст ошибок при повторной установке одинаковых
    // значений, так что это безопасно делать на первом cold-start.
    // Fallback — legacy runtime menu (команды + menu-button), без
    // name/description, на случай если env неполный.
    commandsPromise = (miniAppBaseUrl
      ? configureTelegramBotProfile({ api: bot.api, miniAppBaseUrl })
      : configureTelegramBotRuntimeMenu({
          api: bot.api,
          miniAppBaseUrl: null,
        })
    )
      .then(() => undefined)
      .catch((err) => {
        commandsPromise = null;
        console.error("Telegram bot profile setup error:", err);
      });
  }

  await commandsPromise;
}
