import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { sortJournalsByName } from "@/lib/journal-sort";
import { JournalDifficultyClient } from "@/components/settings/journal-difficulty-client";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function JournalDifficultyPage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/settings");
  const organizationId = getActiveOrgId(session);

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalDifficultyJson: true },
  });
  const stored = (org?.journalDifficultyJson ?? {}) as Record<string, unknown>;
  const initial: Record<string, number> = {};
  for (const [code, v] of Object.entries(stored)) {
    if (typeof v === "number" && v >= 1 && v <= 5) {
      initial[code] = Math.round(v);
    }
  }

  const journals = sortJournalsByName(ACTIVE_JOURNAL_CATALOG, (j) => j.name).map((j) => ({
    code: j.code,
    name: j.name,
  }));

  return (
    <div className="space-y-5">
      {/* Тёмный hero снят: под заголовком уже стоит PageGuide, который
          подробно разбирает шкалу 1–5 — бейдж «дефолты из практики
          общепита» был его дублем и удалён. Ссылка на «Распределение
          задач» стала кнопкой-действием справа. */}
      <PageHeader
        title="Сложность журналов"
        description={
          <>
            Нужно только если в команде <strong>нет шеф-повара</strong> и
            журналы распределяются между поварами с одинаковой зарплатой.
            Сложность × частота × строк/запись = вес, по которому страница
            «Распределение задач» покажет перекос между сотрудниками. Если
            шеф-повар есть — этим блоком можно не пользоваться.
          </>
        }
        actions={
          <Link
            href="/settings/workload-balance"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Распределение задач
          </Link>
        }
      />

      <PageGuide
        storageKey="journal-difficulty"
        title="Как пользоваться сложностью"
        bullets={[
          {
            title: "1 — Очень просто",
            body: "галочка-отметка, ~10 секунд (хороший пример: гигиенический журнал, климат).",
          },
          {
            title: "2-3 — Стандартно",
            body: "одно-два поля + цифра, до 1 минуты (температура холодильника, бракераж).",
          },
          {
            title: "4 — Сложно",
            body: "обоснование, комиссия, акт (списание продукции, ЧП, генеральная уборка).",
          },
          {
            title: "5 — Очень сложно",
            body: "аналитический документ или план — занимает 15+ минут (аудиты, обучение, поверка).",
          },
        ]}
        qa={[
          {
            q: "Зачем сложность если есть частота",
            a: "Частота показывает «сколько раз», сложность — «сколько усилий за раз». Ежедневный журнал на отметку (вес 30) сильно легче ежемесячного с обоснованием (вес 4-5×4=16-20). Без сложности невозможно сравнить.",
          },
          {
            q: "А если у нас все журналы одинаково простые",
            a: "Поставьте всем 1 — частота останется единственным фактором, и нагрузка сравняется в зависимости только от количества заполнений. Это и есть «равномерное» распределение по умолчанию.",
          },
        ]}
      />

      <JournalDifficultyClient
        journals={journals}
        initialDifficulty={initial}
      />
    </div>
  );
}
