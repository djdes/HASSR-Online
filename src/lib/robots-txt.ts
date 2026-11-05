/**
 * Configuration and serializer for `/robots.txt`.
 *
 * Kept in a dedicated module (served by `src/app/robots.txt/route.ts`)
 * rather than Next.js `MetadataRoute.Robots`, because Yandex Webmaster
 * relies on `Clean-param:` directives to merge UTM / ad-click query
 * parameters onto the canonical URL without losing link equity, and
 * `MetadataRoute.Robots` does not emit `Clean-param`.
 *
 * Prefix-matching rules:
 * - Never use bare `/sanpin`, `/partner`, `/journals`, `/master`,
 *   `/inspection`, `/orders` without `/` or `$`, so public routes like
 *   `/sanpin-2-3-2-4-4282-26`, `/partners`, `/partner-agreement`, and
 *   `/journals-info` remain 100% crawlable.
 */
export const ROBOTS_DISALLOW: readonly string[] = [
  // API and platform admin roots
  "/api/",
  "/root/",
  "/root$",
  "/admin/",
  "/admin$",

  // Authenticated workspace routes from `(dashboard)` and master cabinet
  "/dashboard",
  "/journals/",
  "/journals$",
  "/journals-progress",
  "/settings",
  "/partner/",
  "/partner$",
  "/p/",
  "/master/",
  "/master$",
  "/acknowledge",
  "/batches",
  "/bonuses",
  "/capa",
  "/changes",
  "/checklists",
  "/competencies",
  "/control-board",
  "/edo",
  "/home/",
  "/home$",
  "/ideas",
  "/inspection/",
  "/inspection$",
  "/knowledge",
  "/losses",
  "/mercury",
  "/monitoring",
  "/more/",
  "/more$",
  "/news/",
  "/news$",
  "/orders/",
  "/orders$",
  "/plans",
  "/production-control",
  "/reports",
  "/sanpin/",
  "/sanpin$",
  "/staff",
  "/team",
  "/translations",
  "/verifications",
  "/verify",

  // Telegram Mini App & MAX messenger connect
  "/mini",
  "/max/",

  // Signed / tokenized / one-off links
  "/invite/",
  "/inspector/",
  "/inspector-sheet",
  "/join/",
  "/kp/",
  "/order/",
  "/pair/",
  "/payment/",
  "/policy/",
  "/promo/",
  "/q/",
  "/qb/",
  "/qj/",
  "/r/",
  "/unsubscribe/",

  // QR fill routes (signed tokens, never meant for search index)
  "/task-fill",
  "/equipment-fill",
  "/room-fill",
  "/journal-fill",
];

/**
 * Tracking and ad-network parameters stripped by Yandex (`Clean-param`)
 * so campaign links consolidate onto clean canonical URLs.
 */
export const ROBOTS_CLEAN_PARAMS =
  "utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&etext&from&ref";

export function renderRobotsTxt(): string {
  const lines = [
    "User-Agent: *",
    "Allow: /",
    ...ROBOTS_DISALLOW.map((rule) => `Disallow: ${rule}`),
    `Clean-param: ${ROBOTS_CLEAN_PARAMS}`,
    "",
    "Host: https://wesetup.ru",
    "Sitemap: https://wesetup.ru/sitemap.xml",
    "",
  ];
  return lines.join("\n");
}

/**
 * Standard Google / Yandex robots rule matcher (prefix + `*` + trailing `$`)
 * used in tests to guarantee no public sitemap URL is ever blocked.
 */
export function matchesRobotsRule(urlPathAndQuery: string, rule: string): boolean {
  if (!rule) return false;
  const endAnchored = rule.endsWith("$");
  const core = endAnchored ? rule.slice(0, -1) : rule;
  const escaped = core
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}${endAnchored ? "$" : ""}`);
  return regex.test(urlPathAndQuery);
}

export function isAllowedByRobots(urlOrPath: string): boolean {
  const target = urlOrPath.startsWith("http")
    ? (() => {
        const parsed = new URL(urlOrPath);
        return `${parsed.pathname}${parsed.search}`;
      })()
    : urlOrPath;

  let longestAllow = 1; // "Allow: /" has length 1
  let longestDisallow = -1;

  for (const rule of ROBOTS_DISALLOW) {
    if (matchesRobotsRule(target, rule)) {
      longestDisallow = Math.max(longestDisallow, rule.length);
    }
  }
  if ("/".length > 0 && matchesRobotsRule(target, "/")) {
    longestAllow = Math.max(longestAllow, 1);
  }
  return longestDisallow <= longestAllow ? longestDisallow === -1 : false;
}
