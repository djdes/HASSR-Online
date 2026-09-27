import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { sortJournalsByName } from "@/lib/journal-sort";
import {
  parseTaskModesJson,
  getDefaultTaskMode,
} from "@/lib/journal-task-modes";
import { JournalTaskModeClient } from "@/components/settings/journal-task-mode-client";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function JournalTaskModePage() {
  const session = await requireAuth();
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    redirect("/settings");
  }
  const organizationId = getActiveOrgId(session);

  const [org, areaCount] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { journalTaskModesJson: true },
    }),
    db.area.count({ where: { organizationId } }),
  ]);

  const overrides = parseTaskModesJson(org?.journalTaskModesJson);

  // Готовим список journal'ов с резолвом effective-режима для UI.
  const journals = sortJournalsByName(ACTIVE_JOURNAL_CATALOG, (j) => j.name).map((j) => {
    const def = getDefaultTaskMode(j.code);
    const override = overrides[j.code] ?? {};
    return {
      code: j.code,
      name: j.name,
      // Раздельно: дефолт, чтобы UI мог показать «по умолчанию»; и
      // override (что юзер реально настроил для этого journal).
      defaultMode: def,
      override,
    };
  });

  return (
    <div className="space-y-5">
      <div>

      </div>

      {/* Тёмный hero снят: страница — рабочий список журналов, баннер
          дублировал название из PageNav. Предупреждение про помещения
          вынесено отдельной плашкой — на светлом фоне оно заметнее. */}
      <PageHeader
        title="Режимы раздачи задач"
        description="Для каждого журнала выберите как именно создаются TasksFlow-задачи и как их проверяет ответственный. Уборку можно раздать по помещениям, гигиену — по сотрудникам, бракераж — по сменам. Один журнал = одна сводная задача по умолчанию. Если оставить «Как по умолчанию» — система сама подставит разумный режим под этот тип журнала."
      />

      {areaCount === 0 ? (
        <p className="max-w-[680px] rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[13px] leading-[1.55] text-[#8a5a06]">
          ⚠ В организации не настроены помещения. Режим «На каждое
          помещение» не будет создавать задачи пока не добавите цеха в{" "}
          <Link href="/settings/areas" className="underline">
            «Помещения»
          </Link>
          .
        </p>
      ) : null}

      <PageGuide
        storageKey="journal-task-mode"
        title="Как работают режимы раздачи задач"
        bullets={[
          {
            title: "На каждое помещение",
            body: "уборщикам прилетит N задач = N помещений из «Цеха». Каждый берёт своё.",
          },
          {
            title: "На каждого сотрудника",
            body: "каждый получает свою задачу — для гигиены и медосмотра, где «Иван прошёл, Петя нет» — норма.",
          },
          {
            title: "По графику дежурств",
            body: "Round-robin: каждый день дежурный новый. Идеально для ротации админ-задач (медкнижки, аудит).",
          },
          {
            title: "Одна сводная задача",
            body: "Простой режим — одна задача primary-исполнителю. Подходит когда один человек ведёт.",
          },
          {
            title: "По задаче каждому ответственному",
            body: "Для комиссий: бракераж готовой продукции, акт списания. Каждый член комиссии получает свою копию.",
          },
          {
            title: "Сводная проверка",
            body: "По умолчанию: когда исполнители заполнили — заведующий производством получает одну задачу «Проверить журнал». Открывает таблицу, ставит «Принять» или отклоняет конкретные ячейки.",
          },
          {
            title: "Проверка каждой ячейки",
            body: "Альтернатива: на каждое заполнение — отдельная задача проверки. Полезно для критичных журналов где каждое блюдо проверяется индивидуально.",
          },
        ]}
        qa={[
          {
            q: "Что выбрать если не знаю",
            a: "Оставьте «Как по умолчанию» — система сама подберёт разумный режим под тип журнала. Можете менять позже.",
          },
          {
            q: "Когда нажать «Сброс»",
            a: "Если жалеете о настройке и хотите вернуться к default'у. Не удаляет уже отправленные задачи в TasksFlow.",
          },
          {
            q: "Что значит «Показывать сделано Иваном»",
            a: "Опционально: если включено, уборщица 2 видит на своей карточке «помещение А — закрыл Иван». Хорошо для прозрачности команды.",
          },
        ]}
      />

      <JournalTaskModeClient journals={journals} />
    </div>
  );
}
