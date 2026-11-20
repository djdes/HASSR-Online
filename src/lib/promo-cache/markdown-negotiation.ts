import { isPublicCacheablePage } from "@/lib/robots-txt";

/**
 * Pure RFC 9110 Accept header negotiation + `.md` URL mapping.
 * Kept free of database/catalog imports so `src/proxy.ts` stays lightweight.
 */
export function prefersMarkdown(acceptHeader: string | null | undefined): boolean {
  if (!acceptHeader) return false;
  let mdQ = 0;
  let htmlQ = 0;

  for (const part of acceptHeader.split(",")) {
    const segments = part
      .trim()
      .split(";")
      .map((s) => s.trim());
    const mediaType = (segments[0] ?? "").toLowerCase();
    if (!mediaType) continue;

    let q = 1;
    for (let i = 1; i < segments.length; i += 1) {
      const [k, v] = segments[i].split("=").map((s) => s.trim().toLowerCase());
      if (k === "q") {
        const parsed = Number(v);
        q = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
      }
    }

    if (mediaType === "text/markdown" || mediaType === "text/x-markdown") {
      mdQ = Math.max(mdQ, q);
    } else if (mediaType === "text/html" || mediaType === "application/xhtml+xml") {
      htmlQ = Math.max(htmlQ, q);
    }
  }

  return mdQ > 0 && mdQ >= htmlQ;
}

export function resolvePromoMarkdownTarget(pathname: string): string | null {
  if (!pathname.startsWith("/") || !pathname.toLowerCase().endsWith(".md")) {
    return null;
  }
  const withoutExt = pathname.slice(0, -3);
  let target: string;
  if (withoutExt === "" || withoutExt === "/index") {
    target = "/";
  } else if (withoutExt === "/en/index") {
    target = "/en";
  } else if (withoutExt === "/uz/index") {
    target = "/uz";
  } else {
    target = withoutExt;
  }
  if (!isPublicCacheablePage(target)) {
    return null;
  }
  return target;
}

export function alternateMarkdownPath(pathname: string): string {
  if (pathname === "/") return "/index.md";
  if (pathname === "/en" || pathname === "/uz") return `${pathname}/index.md`;
  return `${pathname.replace(/\/+$/, "")}.md`;
}
