import { Coins, Trophy, User as UserIcon } from "lucide-react";
import { getStrugglingWorkers, getWorkerLeaderboard } from "@/lib/worker-leaderboard";

/**
 * «Топ за месяц» и «Кому помочь» — кто заполнял журналы чаще и реже всех
 * за 30 дней. Жили на главной; с меню 2026-10-16 — в «Сотрудники →
 * Команда», рядом с теми, о ком они.
 */
export async function WorkerLeaderboardCards({ organizationId }: { organizationId: string }) {
  const [leaderboard, strugglers] = await Promise.all([
    getWorkerLeaderboard(organizationId, 3, 30),
    getStrugglingWorkers(organizationId, 3, 30),
  ]);
  return (
    <>
      {/* Worker leaderboard — топ-3 за месяц по числу записей. Показываем
          только когда есть хотя бы 1 человек с записями (на пустой
          компании не выглядит странно). Геймификация для команды. */}
      {leaderboard.length > 0 && (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#fff8eb] text-[#b25f00]">
              <Trophy className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[18px] font-semibold text-[#0b1024]">
                Топ за месяц
              </h2>
              <p className="mt-0.5 text-[13px] text-[#6f7282]">
                Кто заполнял журналы чаще всех за последние 30 дней.
              </p>
              <ol className="mt-4 space-y-2">
                {leaderboard.map((row, idx) => {
                  const medalColor =
                    idx === 0
                      ? { bg: "#fff8eb", fg: "#b25f00", emoji: "🥇" }
                      : idx === 1
                        ? { bg: "#f3f4f6", fg: "#52525b", emoji: "🥈" }
                        : { bg: "#fef3c7", fg: "#92400e", emoji: "🥉" };
                  return (
                    <li
                      key={row.userId}
                      className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3"
                    >
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[18px]"
                        style={{
                          backgroundColor: medalColor.bg,
                          color: medalColor.fg,
                        }}
                      >
                        {medalColor.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[#0b1024]">
                          {row.userName}
                        </span>
                        {row.positionTitle ? (
                          <span className="block truncate text-[12px] text-[#6f7282]">
                            {row.positionTitle}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 flex-col items-end text-right">
                        <span className="text-[14px] font-semibold tabular-nums text-[#0b1024]">
                          {row.entryCount}
                          <span className="ml-1 text-[12px] font-normal text-[#6f7282]">
                            записей
                          </span>
                        </span>
                        {row.bonusKopecks > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[12px] tabular-nums text-[#116b2a]">
                            <Coins className="size-3" />
                            +{(row.bonusKopecks / 100).toFixed(0)} ₽
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>
      )}

      {/* Strugglers — bottom-3 за месяц. Показываем только если есть
          разрыв (топ-1 хотя бы вдвое впереди отстающих) — иначе шум. */}
      {strugglers.length > 0 &&
        leaderboard[0] &&
        leaderboard[0].entryCount > strugglers[0].entryCount * 2 && (
          <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#fff4f2] text-[#a13a32]">
                <UserIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[18px] font-semibold text-[#0b1024]">
                  Кому помочь
                </h2>
                <p className="mt-0.5 text-[13px] text-[#6f7282]">
                  Сотрудники с наименьшим числом записей за 30 дней —
                  поддержите их или проверьте загрузку.
                </p>
                <ol className="mt-4 space-y-2">
                  {strugglers.map((row) => (
                    <li
                      key={row.userId}
                      className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#fff4f2] text-[#a13a32]">
                        <UserIcon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[#0b1024]">
                          {row.userName}
                        </span>
                        {row.positionTitle ? (
                          <span className="block truncate text-[12px] text-[#6f7282]">
                            {row.positionTitle}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-right text-[14px] font-semibold tabular-nums text-[#0b1024]">
                        {row.entryCount}
                        <span className="ml-1 text-[12px] font-normal text-[#6f7282]">
                          записей
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>
        )}
    </>
  );
}
