import { badgeEmbedHtml, badgeImageUrl, badgePublicUrl, renderBadgeSvg } from "@/lib/badge/render";

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
};

function baseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "https://wesetup.ru";
}

export function badgePreviewDataUrl(percent: number | null): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderBadgeSvg({ percent }))}`;
}

/** Состояние бейджа и ссылки для вставки — одно и то же для API и страницы настроек. */
export function describeBadge(org: { badgeEnabled: boolean; badgeCode: string | null }, percent: number | null): BadgeDescription {
  const code = org.badgeCode ?? null;
  return {
    enabled: org.badgeEnabled && Boolean(code),
    code,
    publicUrl: code ? badgePublicUrl(baseUrl(), code) : null,
    imageUrl: code ? badgeImageUrl(baseUrl(), code) : null,
    embedHtml: code ? badgeEmbedHtml(baseUrl(), code) : null,
    percent,
    previewSvgDataUrl: badgePreviewDataUrl(percent),
  };
}
