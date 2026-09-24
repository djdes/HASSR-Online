import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildingTargets } from "@/lib/active-building";
import { checkCronSecret } from "@/lib/cron-auth";
import {
  closeExpiredDocuments,
  ensureActiveDocument,
  ensureCurrentDocumentsForBrokenChains,
  ensureNextPeriodDocument,
} from "@/lib/journal-auto-create";
import { listAutomationOwnedCodes } from "@/lib/journal-automation";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/auto-create-journals?secret=$CRON_SECRET
 *
 * Раз в день для каждой org:
 *   0. closeExpiredDocuments — закрывает active-документы прошлых
 *      периодов, у которых уже есть документ-преемник (perpetual/
 *      yearly не трогаем). Выполняется для всех org.
 *   0b. ensureCurrentDocumentsForBrokenChains — журналы, у которых
 *      документы были, но последний истёк и преемника нет. Создаёт
 *      документ текущего периода, наследуя ответственных из последнего.
 *      Тоже для всех org: без этого журнал, которого нет в
 *      autoJournalCodes, после автозакрытия оставался пустым навсегда.
 *
 * Далее — для каждой org с непустым `autoJournalCodes`:
 *   1. ensureActiveDocument — гарантирует что есть документ на текущий
 *      период (если cron упал вчера 1-го числа — догоняет сегодня).
 *   2. ensureNextPeriodDocument — за 7 дней до конца текущего создаёт
 *      следующий, чтобы 1-го числа он уже существовал и не было
 *      «провала compliance» из-за недосозданного документа.
 *
 * Идемпотентно. Безопасно вызывать несколько раз в день.
 *
 * INFRA NEXT: внешний cron 04:00 MSK ежедневно.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const orgs = await db.organization.findMany({
    // Приостановленные за неактивность организации автоматика не ведёт.
    where: { subscriptionPlan: { notIn: ["paused", "cancelled"] }, ...NOT_DIRECTORY_ORG_WHERE },
    select: {
      id: true,
      autoJournalCodes: true,
      journalAutomationJson: true,
      // Журналы, выключенные в /settings/journals: автоматика их не ведёт.
      disabledJournalCodes: true,
    },
  });

  let totalCurrentCreated = 0;
  let totalNextCreated = 0;
  let totalClosed = 0;
  let totalChainsRestored = 0;
  let orgsTouched = 0;
  const errors: string[] = [];
  const restoredCodes = new Set<string>();

  for (const org of orgs) {
    // Точки: документы создаются на каждую точку организации (или один
    // общий, если точки не включены).
    const targets = await buildingTargets(org.id);
    // Отключённый журнал не должен возвращаться сам: его страница отвечает
    // «Этот журнал отключён», а ночной крон всё равно заводил документ.
    const disabledCodes = parseDisabledCodes(org.disabledJournalCodes);
    // Догоняющий шаг: документы прошлых периодов, у которых уже есть
    // преемник, переводим в «закрытые» — иначе они висят active до
    // авто-архива (365 дней). Делаем для ВСЕХ орг, даже без
    // autoJournalCodes: документы могли создаваться вручную.
    try {
      const closedRes = await closeExpiredDocuments(db, {
        organizationId: org.id,
      });
      totalClosed += closedRes.closed;
    } catch (err) {
      errors.push(
        `org=${org.id} close-expired: ${(err as Error).message ?? "ошибка"}`
      );
    }

    // Догоняющий шаг №2: журналы с ПРЕРВАННОЙ цепочкой. Документы у них
    // были, но последний уже истёк, а преемника никто не создал —
    // например потому что кода нет в `autoJournalCodes`. Без этого шага
    // шаг закрытия выше просто опустошал журнал: вчера в проде было
    // «закрыто 32, создано 0». Делаем для ВСЕХ орг, до и независимо от
    // autoJournalCodes.
    try {
      const restored = await ensureCurrentDocumentsForBrokenChains(db, {
        organizationId: org.id,
        buildingIds: targets,
        skipCodes: disabledCodes,
      });
      for (const report of restored) {
        if (!report.created) continue;
        totalChainsRestored += 1;
        restoredCodes.add(report.code);
      }
    } catch (err) {
      errors.push(
        `org=${org.id} broken-chains: ${(err as Error).message ?? "ошибка"}`
      );
    }

    // Коды, которые целиком ведёт cron автоматизации 06:00
    // (/api/cron/journal-automation), здесь пропускаем: он создаёт
    // документ сразу с autoFill=true, а мы бы создали его без флага.
    const ownedByAutomation = new Set(listAutomationOwnedCodes(org));
    const codes = (
      Array.isArray(org.autoJournalCodes)
        ? (org.autoJournalCodes as string[]).filter(
            (c): c is string => typeof c === "string"
          )
        : []
    ).filter((code) => !ownedByAutomation.has(code) && !disabledCodes.has(code));
    if (codes.length === 0) continue;
    orgsTouched += 1;

    for (const code of codes) {
      for (const buildingId of targets) {
        try {
          const cur = await ensureActiveDocument(db, {
            organizationId: org.id,
            templateCode: code,
            buildingId,
          });
          if (cur.created) totalCurrentCreated += 1;

          const nxt = await ensureNextPeriodDocument(db, {
            organizationId: org.id,
            templateCode: code,
            lookaheadDays: 7,
            buildingId,
          });
          if (nxt.created) totalNextCreated += 1;
        } catch (err) {
          errors.push(
            `org=${org.id} code=${code}: ${(err as Error).message ?? "ошибка"}`
          );
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    organizationsProcessed: orgsTouched,
    currentDocumentsCreated: totalCurrentCreated,
    nextPeriodDocumentsCreated: totalNextCreated,
    expiredDocumentsClosed: totalClosed,
    brokenChainsRestored: totalChainsRestored,
    brokenChainCodes: [...restoredCodes].sort(),
    errors: errors.slice(0, 10),
  });
}

export const GET = handle;
export const POST = handle;
