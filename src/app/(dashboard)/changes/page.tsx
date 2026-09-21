import Link from "next/link";
import { GitBranch, Plus } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

const STATUS_INFO: Record<string, { label: string; className: string }> = {
  requested: { label: "Заявка", className: "bg-[#eef1ff] text-[#3848c7]" },
  risk_review: { label: "Оценка рисков", className: "bg-[#fff8eb] text-[#b25f00]" },
  testing: { label: "Тестирование", className: "bg-[#f5f0ff] text-[#5d3ab3]" },
  approved: { label: "Одобрено", className: "bg-[#ecfdf5] text-[#116b2a]" },
  rejected: { label: "Отклонено", className: "bg-[#fff4f2] text-[#a13a32]" },
  implemented: { label: "Внедрено", className: "bg-[#ecfdf5] text-[#116b2a]" },
};

const TYPE_LABELS: Record<string, string> = {
  recipe: "Рецептура",
  process: "Процесс",
  packaging: "Упаковка",
  supplier: "Поставщик",
  equipment: "Оборудование",
};

export default async function ChangesPage() {
  const session = await requireAuth();

  const changes = await db.changeRequest.findMany({
    where: { organizationId: getActiveOrgId(session) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {/* Надзаголовок убран: он слово в слово повторял H1. */}
          <h1 className="flex items-center gap-2 text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
            <GitBranch className="size-6 shrink-0 text-[#5566f6]" />
            Управление изменениями
          </h1>
          <p className="mt-1.5 text-[14px] text-[#6f7282]">
            Рецептуры, процессы, упаковка, поставщики и оборудование
          </p>
        </div>
        <Link
          href="/changes/new"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:w-auto sm:justify-start sm:self-start"
        >
          <Plus className="size-4" />
          Новое изменение
        </Link>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
        <div className="min-w-[560px] overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#ececf4] bg-[#fafbff] text-left text-[12px] uppercase tracking-wider text-[#6f7282]">
                <th className="px-5 py-3 font-medium">Версия</th>
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium">Тип</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Дата</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c: (typeof changes)[number]) => {
                const sInfo = STATUS_INFO[c.status] ?? {
                  label: c.status,
                  className: "bg-[#f5f6ff] text-[#6f7282]",
                };
                return (
                  <tr
                    key={c.id}
                    className="border-b border-[#ececf4] last:border-b-0 hover:bg-[#fafbff]"
                  >
                    <td className="px-5 py-3 font-mono text-[12px] text-[#9b9fb3]">
                      #{c.version}
                    </td>
                    <td className="px-5 py-3 font-medium text-[#0b1024]">
                      {c.title}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center rounded-full border border-[#ececf4] bg-white px-2.5 py-0.5 text-[12px] text-[#3c4053]">
                        {TYPE_LABELS[c.changeType] || c.changeType}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${sInfo.className}`}
                      >
                        {sInfo.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#6f7282]">
                      {c.createdAt.toLocaleDateString("ru-RU")}
                    </td>
                  </tr>
                );
              })}
              {changes.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-[14px] text-[#9b9fb3]"
                  >
                    Изменений пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
