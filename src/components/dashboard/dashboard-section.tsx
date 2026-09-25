import { ChevronDown, type LucideIcon } from "lucide-react";

type Props = {
  /** Уникальный ключ для localStorage. Inline-скрипт в dashboard
   *  layout читает все [data-storage-key] и подменяет open. */
  storageKey: string;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  badge?: {
    text: string;
    tone?: "default" | "ok" | "warn" | "danger";
  };
  /**
   * Мелкий элемент сразу после бейджа — тихая пилюля-справка.
   * Живёт внутри <summary>, поэтому обязан гасить клик, иначе секция
   * свернётся вместо перехода.
   */
  titleAction?: React.ReactNode;
  /**
   * Настройка секции — стоит слева от стрелки и остаётся в строке
   * заголовка даже на телефоне, где основные действия уезжают вниз.
   * Внутри группы заголовка кнопка переносилась на вторую строку и
   * висела в пустоте под названием.
   */
  titleAside?: React.ReactNode;
  defaultOpen?: boolean;
  /**
   * Действия в шапке секции — встают справа от заголовка, перед
   * стрелкой. Занимают уже существующую пустую строку вместо того,
   * чтобы заводить под себя новую.
   *
   * Клик по ним не должен сворачивать секцию: элемент лежит внутри
   * <summary>, поэтому содержимое обязано само гасить событие.
   */
  actions?: React.ReactNode;
  /**
   * Заголовок со счётчиком — по центру карточки, действия — строкой под
   * ним по центру, настройка (`titleAside`) — в левом углу, стрелка — в
   * правом. Иконка и подпись в этом режиме не рисуются. Нужен карточке
   * «Обязательные журналы» (решение владельца 2026-09-25): главное —
   * название и N/M, под ними две кнопки.
   */
  centered?: boolean;
  children: React.ReactNode;
};

const TONE_CLS: Record<NonNullable<Props["badge"]>["tone"] & string, string> = {
  default: "bg-[#eef1ff] text-[#3848c7]",
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
};

/**
 * Раскрывающаяся секция дашборда. Server-component с native
 * `<details>` — работает с любыми children (включая async
 * server-components), не требует client JS bundle, лёгкий SSR.
 *
 * Persist в localStorage реализован через inline-скрипт в
 * dashboard layout (см. <DashboardSectionPersistScript />): он
 * читает все [data-storage-key] и устанавливает initial open
 * state, и на toggle event пишет обратно в localStorage.
 */
export function DashboardSection({
  storageKey,
  title,
  subtitle,
  icon: Icon,
  badge,
  titleAction,
  titleAside,
  defaultOpen = false,
  actions,
  centered = false,
  children,
}: Props) {
  // «Обязательные журналы» → head «Обязательные », tail «журналы».
  const lastSpace = title.lastIndexOf(" ");
  const titleHead = lastSpace > 0 ? title.slice(0, lastSpace + 1) : "";
  const titleTail = lastSpace > 0 ? title.slice(lastSpace + 1) : title;

  const badgeEl = badge ? (
    <span
      className={`ml-1.5 inline-flex translate-y-[-1px] items-center rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold ${TONE_CLS[badge.tone ?? "default"]}`}
    >
      {badge.text}
    </span>
  ) : null;

  if (centered) {
    return (
      <details
        {...(defaultOpen ? { open: true } : {})}
        data-storage-key={storageKey}
        data-section-layout="centered"
        className="group overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
      >
        {/* Строка заголовка — сетка «угол | заголовок | угол» с равными
            боковыми колонками: так название стоит ровно по центру, а не
            «по центру остатка» после кнопки настройки. */}
        <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 transition-colors hover:bg-[#fafbff] sm:p-5">
          <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
            <div className="flex items-center justify-start">{titleAside}</div>
            <h3 className="text-center text-[16px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024] sm:text-[18px]">
              {badge ? (
                <>
                  {titleHead}
                  <span className="whitespace-nowrap">
                    {titleTail}
                    {badgeEl}
                  </span>
                </>
              ) : (
                title
              )}
            </h3>
            <div className="flex items-center justify-end">
              <ChevronDown
                className="size-5 shrink-0 text-[#9b9fb3] transition-transform group-open:rotate-180 group-open:text-[#5566f6]"
                aria-hidden
              />
            </div>
          </div>
          {actions ? (
            <div className="flex w-full justify-center">{actions}</div>
          ) : null}
        </summary>
        <div className="border-t border-[#ececf4] p-4 sm:p-5">{children}</div>
      </details>
    );
  }

  return (
    <details
      // open — нужно прокинуть как boolean prop (не через open={false})
      // т.к. в JSX для native HTML element атрибут принимается как
      // boolean (presence/absence). Используем conditional spread.
      {...(defaultOpen ? { open: true } : {})}
      data-storage-key={storageKey}
      className="group overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
    >
      {/* items-center: иконка 40px и заголовок выравниваются друг по
          другу. При items-start однострочный заголовок прижимался к
          верху и стоял выше центра иконки.

          flex-wrap только на мобиле: действия секции (например две
          кнопки «Закрыть день») не помещаются в строку заголовка на
          390px и раньше выталкивали её за экран — теперь они уезжают
          отдельной строкой под заголовок. */}
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 transition-colors hover:bg-[#fafbff] sm:flex-nowrap sm:p-5">
        {/* Иконка входит В левую группу: снаружи она делала левую
            сторону шире правой на свою ширину плюс отступ.
            flex-1 на мобиле: группа занимает всю строку заголовка и
            больше не сжимается в ноль под напором кнопок справа.
            На sm+ ширина 430px — ориентир, а не жёсткая рамка
            (shrink разрешён): на узком ноутбуке фиксированная ширина
            выдавливала стрелку за край карточки. */}
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:w-[430px] sm:shrink sm:grow-0 sm:basis-auto">
          {Icon ? (
            // max-sm:self-start — на узком экране строка заголовка
            // переносится (бейджи, ссылка-настройка), и по центру иконка
            // оказывалась напротив ВТОРОЙ строки, будто оторвана от
            // названия. Сверху она стоит ровно у заголовка. Для
            // однострочных секций высота строки и так равна иконке —
            // там ничего не меняется.
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7] max-sm:self-start">
              <Icon className="size-5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* Бейдж-счётчик живёт ВНУТРИ заголовка, а не рядом: на
                  390px «Обязательные журналы» занимает всю ширину группы,
                  и отдельный flex-элемент падал на следующую строку под
                  название. Как inline-часть текста он переносится вместе
                  с последним словом («…журналы 3/5»), а на десктопе стоит
                  там же, где стоял. */}
              <h3 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024] sm:text-[16px]">
                {badge ? (
                  // Последнее слово и бейдж — одним неразрывным куском:
                  // перед inline-элементом браузер переносит строку даже
                  // через nbsp, и бейдж оказывался один на новой строке.
                  // Так, если всё не влезает, переносится «журналы 3/5».
                  <>
                    {titleHead}
                    <span className="whitespace-nowrap">
                      {titleTail}
                      {badgeEl}
                    </span>
                  </>
                ) : (
                  title
                )}
              </h3>
              {titleAction}
            </div>
            {subtitle ? (
              <p className="mt-0.5 text-[12px] leading-snug text-[#6f7282] sm:text-[13px]">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {/* Распорка между группами: слева и справа по 430px, всё лишнее
            место уходит сюда — заголовок и действия оказываются на
            одинаковом расстоянии от краёв. */}
        <div className="hidden flex-1 sm:block" />

        {/* Действия и стрелка — соседи, а не вложенная группа: на
            мобиле действия уезжают отдельной строкой (order-3 +
            basis-full), а стрелка обязана остаться в строке заголовка.
            На sm+ симметрия 430/430 сохраняется арифметикой:
            398 (действия) + 12 (gap-3) + 20 (стрелка) = 430.
            Именно min-w, а не w: при фиксированной ширине длинные
            действия вылезали за неё и наезжали на стрелку. */}
        {actions ? (
          <div className="flex items-center justify-end gap-3 max-sm:order-3 max-sm:basis-full sm:min-w-[398px] sm:shrink-0">
            {actions}
          </div>
        ) : null}
        {titleAside ? (
          <div className="flex shrink-0 items-center max-sm:order-2">
            {titleAside}
          </div>
        ) : null}
        <ChevronDown
          className="size-5 shrink-0 text-[#9b9fb3] transition-transform group-open:rotate-180 group-open:text-[#5566f6] max-sm:order-2"
          aria-hidden
        />
      </summary>
      <div className="border-t border-[#ececf4] p-4 sm:p-5">{children}</div>
    </details>
  );
}

/**
 * Inline-скрипт для localStorage persist. Размещается ОДИН раз в
 * dashboard layout / page. Читает все [data-storage-key] на mount,
 * устанавливает open state из localStorage; на toggle — пишет
 * обратно. Без зависимости от React — работает даже если client JS
 * ещё не загрузился.
 */
export function DashboardSectionPersistScript() {
  const script = `
(function(){
  try {
    var prefix = 'wesetup.dashboard.section.';
    function apply() {
      document.querySelectorAll('details[data-storage-key]').forEach(function(d){
        if (d.__persistAttached) return;
        d.__persistAttached = true;
        var key = prefix + d.dataset.storageKey;
        var saved = null;
        try { saved = localStorage.getItem(key); } catch(e) {}
        if (saved === '1') d.open = true;
        else if (saved === '0') d.open = false;
        d.addEventListener('toggle', function(){
          try { localStorage.setItem(key, d.open ? '1' : '0'); } catch(e) {}
        });
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply);
    } else {
      apply();
    }
    // Re-apply при router-navigation внутри Next (SPA), иначе attach не
    // случится при F5 на другую страницу + back.
    document.addEventListener('visibilitychange', apply);
  } catch (e) { /* fail silently */ }
})();`;
  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
