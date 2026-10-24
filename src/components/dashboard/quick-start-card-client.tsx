"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { LinkPendingOverlay } from "@/components/ui/link-pending";

/**
 * Карточка быстрого старта на /dashboard: заголовок, прогресс и большая
 * кнопка. Кликабельна целиком — ведёт в /settings/onboarding.
 *
 * Чем закрыт каждый шаг и когда карточку прятать целиком, решает
 * серверный `QuickStartCard` через `getCoreSetupStatus`: здесь только
 * отрисовка, чтобы условия настройки не разошлись по двум местам.
 */
export function QuickStartCardCompact({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const t = useTranslations("dashboardUi.quickStartCardClient");
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    // Ссылка — вся карточка целиком, а не одна кнопка в углу. Блок
    // ведёт ровно в одно место, поэтому «мимо» тут кликнуть нельзя, а
    // цель попадания становится во весь экран шириной.
    <Link
      href="/settings/onboarding"
      className="group relative block overflow-hidden rounded-3xl border border-[#5566f6]/25 bg-white shadow-[0_10px_30px_-15px_rgba(85,102,246,0.25)] transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/50 hover:shadow-[0_16px_38px_-16px_rgba(85,102,246,0.45)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/20"
    >
      {/* Лёгкий индиго-подсвет вместо сплошной заливки: карточка
          остаётся заметной, но не спорит с тёмным hero над ней. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 -top-24 size-[320px] rounded-full bg-[#5566f6] opacity-[0.07] blur-[100px]" />
      </div>
      {/* Три колонки на одной линии: слева — что настраиваем, по центру
          прогресс во всю оставшуюся ширину, справа — действие. Раньше
          полоса лежала отдельной строкой под заголовком и читалась как
          не связанная ни с текстом слева, ни с кнопкой справа. */}
      <div className="relative z-10 p-4 sm:p-5">
        {/* На sm+ полоса стоит ровно по центру блока: боковые группы
            одной ширины (260px), левая прижата влево, правая вправо.
            Пока ширины были разные, «центр» полосы уезжал вслед за
            длиной заголовка.

            На мобиле не колонка, а обёртка: заголовок и «Завершить»
            держатся в одной строке, полоса уходит вниз. Колонкой кнопка
            падала третьей строкой под прогресс-баром — до неё надо было
            доскроллить, и главное действие карточки терялось. */}
        <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:w-[260px] sm:flex-none sm:shrink-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
              <Sparkles className="size-4" />
            </span>
            {/* На широком экране заголовок держим в одну строку, иначе
                он перекашивает полосу. На узком — разрешаем перенос:
                обрезка превращала его в «Начальная настр…», а из огрызка
                непонятно, что за настройка. */}
            <h2 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024] sm:truncate sm:whitespace-nowrap sm:text-[16px]">
              {t("title")}
            </h2>
          </div>

          {/* Процент вынут из потока: в колонке он поднимал полосу над
              центром блока. Абсолютом он висит над ней, а сама полоса
              остаётся единственным содержимым и центрируется и по
              горизонтали, и по вертикали. */}
          {/* order-last + basis-full: на мобиле полоса встаёт отдельной
              второй строкой во всю ширину, mt компенсирует висящий над
              ней абсолютный «NN%» — иначе процент налезал бы на строку
              заголовка. */}
          <div className="relative flex min-w-0 flex-1 items-center gap-2 max-sm:order-last max-sm:basis-full">
            {/* Процент над полосой — только на широком экране, где полоса
                стоит между заголовком и кнопкой и подписать её сверху
                больше негде. На мобиле он встаёт справа от полосы: висящая
                над ней цифра читалась как оторванная от всего. */}
            <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 hidden w-full text-center text-[11px] font-semibold tabular-nums text-[#6f7282] sm:block">
              {percent}%
            </span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#ececf4]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  percent >= 80
                    ? "bg-emerald-400"
                    : percent >= 50
                      ? "bg-amber-400"
                      : "bg-[#5566f6]"
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[#6f7282] sm:hidden">
              {percent}%
            </span>
          </div>

          <div className="flex shrink-0 items-center justify-end sm:w-[260px]">
            {/* Уже не ссылка, а её вид: кликабельна вся карточка, а
                вложенная <a> внутри <a> невалидна. Подсветку берёт от
                группы-родителя, чтобы кнопка реагировала на наведение
                в любой точке блока.

                max-sm:w-auto — на 360px «Начальная настройка» и
                «Завершить →» помещаются в одну строку только если
                кнопка сжимается по содержимому. */}
            <span className="inline-flex h-10 w-[180px] items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors group-hover:bg-[#4a5bf0] max-sm:w-auto">
              {t("finish")}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </div>
      <LinkPendingOverlay />
    </Link>
  );
}
