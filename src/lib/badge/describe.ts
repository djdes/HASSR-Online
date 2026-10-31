import { badgeEmbedHtml, badgeImageUrl, badgePublicUrl, renderBadgeSvg } from "@/lib/badge/render";
import { sphereToday } from "@/lib/badge/today";
import { normalizeSphere } from "@/lib/org-profile";

export type BadgeDescription = {
  enabled: boolean;
  /**
   * Код страницы `/b/<код>`. Есть и у выключенного бейджа: код заводится
   * заранее (`prepareBadgeCode`), чтобы ссылку и код для вставки было видно
   * сразу. Пока `enabled = false`, по ним ничего не открывается —
   * `getBadgeStatusByCode` отдаёт только включённые.
   */
  code: string | null;
  publicUrl: string | null;
  imageUrl: string | null;
  embedHtml: string | null;
  percent: number | null;
  /**
   * Живой пример: та же картинка, что увидят на сайте, с текущим процентом
   * организации — `data:`-URL, потому что публичная картинка у выключенного
   * бейджа не отдаётся.
   */
  previewSvgDataUrl: string;
  /** Блок «Сегодня» на странице — отдельное согласие (`badgeTodayEnabled`). */
  todayEnabled: boolean;
  /** Что увидят люди этой сферы в блоке «Сегодня»: адресат, заголовок, пункты. */
  today: { audience: string; title: string; items: string[] };
  /** Точки для таблички и страниц точек; пусто — страница одна на организацию. */
  points: Array<{ id: string; name: string }>;
};

/** Что покажет блок «Сегодня» для сферы — для описания в настройках. */
export function describeBadgeToday(sphere: unknown): BadgeDescription["today"] {
  const spec = sphereToday(normalizeSphere(sphere));
  const items = spec.facts.map((item) => item.label);
  if (spec.dishes === "list") items.push(`${spec.dishesTitle} — список блюд с выходом и оценкой`);
  if (spec.dishes === "count") items.push(`${spec.dishesTitle} — число за день`);
  return { audience: spec.audience, title: spec.title, items };
}

function baseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "https://wesetup.ru";
}

export function badgePreviewDataUrl(percent: number | null): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderBadgeSvg({ percent }))}`;
}

/** Состояние бейджа и ссылки для вставки — одно и то же для API и страницы настроек. */
export function describeBadge(
  org: { badgeEnabled: boolean; badgeCode: string | null; badgeTodayEnabled?: boolean; type?: string | null },
  percent: number | null,
  points: Array<{ id: string; name: string }> = [],
): BadgeDescription {
  const code = org.badgeCode ?? null;
  return {
    enabled: org.badgeEnabled && Boolean(code),
    code,
    publicUrl: code ? badgePublicUrl(baseUrl(), code) : null,
    imageUrl: code ? badgeImageUrl(baseUrl(), code) : null,
    embedHtml: code ? badgeEmbedHtml(baseUrl(), code) : null,
    percent,
    previewSvgDataUrl: badgePreviewDataUrl(percent),
    todayEnabled: org.badgeTodayEnabled === true,
    today: describeBadgeToday(org.type),
    points: points.map((point) => ({ id: point.id, name: point.name })),
  };
}
