import { CHANGELOG } from "@/content/changelog";
import { moscowDateKey } from "@/lib/channel-autopost/topics";
import { db } from "@/lib/db";
import { titleFromPost } from "@/lib/smm/templates";

import { SITE_URL, selectCommitSubjects, type WeeklyFacts } from "./facts";
import { upcomingOccasions } from "./occasions";
import { factsPeriod } from "./schedule";

/**
 * Факты еженедельного выпуска из живых источников. Каждый источник
 * необязателен: сбой одного (например, GitHub недоступен) не мешает
 * собрать выпуск из остальных.
 */

/** Репозиторий сайта: в master попадает только то, что ушло на прод (слияние = деплой). */
const REPO = () => process.env.WEEKLY_GITHUB_REPO?.trim() || "djdes/HASSR-Online";

/** Первые строки коммитов master за период — через GitHub API (репозиторий публичный). */
export async function fetchCommitMessages(from: Date, to: Date): Promise<string[] | null> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "wesetup-weekly-issue" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const messages: string[] = [];
  try {
    for (let page = 1; page <= 3; page += 1) {
      const url = `https://api.github.com/repos/${REPO()}/commits?sha=master&since=${from.toISOString()}&until=${to.toISOString()}&per_page=100&page=${page}`;
      const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) {
        console.warn(`[weekly] github commits ${response.status}`);
        return messages.length ? messages : null;
      }
      const rows = (await response.json()) as Array<{ commit?: { message?: string } }>;
      for (const row of rows) if (row.commit?.message) messages.push(row.commit.message);
      if (rows.length < 100) break;
    }
    return messages;
  } catch (error) {
    console.warn("[weekly] github commits failed", (error as Error)?.message?.slice(0, 120));
    return null;
  }
}

export async function collectWeeklyFacts(weekKey: string, now: Date = new Date()): Promise<WeeklyFacts> {
  const { from, to } = factsPeriod(now);
  const fromKey = moscowDateKey(from);
  const toKey = moscowDateKey(to);
  const horizon = new Date(now.getTime() + 14 * 86_400_000);
  const [messages, articles, promotions, posts] = await Promise.all([
    fetchCommitMessages(from, to),
    db.article
      .findMany({
        where: { publishedAt: { gte: from, lte: to } },
        orderBy: { publishedAt: "desc" },
        take: 5,
        select: { slug: true, title: true },
      })
      .catch(() => []),
    db.pricePromotion
      .findMany({
        where: { active: true, endsAt: { gt: now }, startsAt: { lt: horizon } },
        orderBy: { startsAt: "asc" },
        take: 5,
      })
      .catch(() => []),
    db.maxChannelPost
      .findMany({
        where: {
          status: { in: ["scheduled", "review"] },
          scheduledAt: { gte: now, lte: horizon },
          source: { notIn: ["weekly"] },
        },
        orderBy: { scheduledAt: "asc" },
        take: 60,
        select: { text: true, scheduledAt: true, source: true },
      })
      .catch(() => []),
  ]);
  // Кросспост — одна запись на канал: показываем пост один раз.
  const seen = new Set<string>();
  const upcomingPosts: WeeklyFacts["upcomingPosts"] = [];
  for (const post of posts) {
    const title = titleFromPost(post.text);
    const date = moscowDateKey(post.scheduledAt as Date);
    const key = `${date}|${title}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    upcomingPosts.push({ date, title });
    if (upcomingPosts.length >= 12) break;
  }
  return {
    weekKey,
    periodFrom: fromKey,
    periodTo: toKey,
    changes: messages ? selectCommitSubjects(messages) : [],
    changesSource: messages ? "github" : "unavailable",
    changelog: CHANGELOG.filter((entry) => entry.date >= fromKey && entry.date <= toKey).flatMap((entry) => [entry.title, ...entry.items]).slice(0, 12),
    articles: articles.map((a) => ({ title: a.title, url: `${SITE_URL}/blog/${a.slug}` })),
    promotions: promotions.map((p) => ({
      title: p.title,
      percent: p.percent,
      from: moscowDateKey(p.startsAt),
      // Конец не включительно: последний день акции — накануне endsAt.
      until: moscowDateKey(new Date(p.endsAt.getTime() - 1)),
    })),
    upcomingPosts,
    occasions: upcomingOccasions(weekKey, 31).slice(0, 4),
  };
}
