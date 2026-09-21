import { Smartphone } from "lucide-react";

/**
 * Заглушка мобильного приложения.
 *
 * Дата названа намеренно: «скоро» без срока читается как «никогда», а
 * конкретное число сообщает, что работа идёт. Держим её ОДНОЙ константой
 * — раньше подвал жил своей жизнью, и при переносе срока правку в двух
 * местах легко забыть, а разъехавшиеся даты выглядят хуже, чем их
 * отсутствие.
 */
export const MOBILE_APP_LAUNCH_DATE = "1 октября";

const STORES = ["App Store", "Google Play"] as const;

export function AppStoresTeaser({
  tone = "footer",
}: {
  /// "footer" — компактно в подвале, "card" — в настройках уведомлений.
  tone?: "footer" | "card";
}) {
  const card = tone === "card";

  return (
    <div className={card ? "" : "mt-5"}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
        Приложение
      </div>
      <p
        className={
          "mt-1.5 text-[12.5px] leading-snug text-[#6f7282] " +
          (card ? "max-w-[520px]" : "max-w-[280px]")
        }
      >
        Сотрудники будут вести журналы и получать уведомления прямо на
        телефон. Запуск — {MOBILE_APP_LAUNCH_DATE}.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {STORES.map((store) => (
          <span
            key={store}
            className="inline-flex h-9 cursor-default items-center gap-2 rounded-xl border border-[#dcdfed] bg-white px-3 text-[12.5px] font-medium text-[#9b9fb3]"
          >
            <Smartphone className="size-3.5" />
            {store}
            <span className="rounded-full bg-[#f5f6ff] px-1.5 py-0.5 text-[10.5px] text-[#3848c7]">
              скоро
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
