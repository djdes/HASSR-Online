import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  FileText,
  MessageSquare,
  Send,
  Sun,
  Users,
  Wifi,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/logo";

/**
 * Three stacked/tilted mockups showing the product surfaces: a desktop
 * dashboard in the centre, a phone with the Telegram bot on the left,
 * and a phone with the PDF export on the right.
 *
 * Everything is rendered as styled divs — no external images. That
 * keeps the hero blazing fast (one more image = one more LCP hit) and
 * sidesteps the «stock photo of a chef pointing at a laptop» cliché.
 * Content is stylised miniature UI: the proportions and typography
 * read as «it's our app», not «it's a random chart».
 */

/** Три поверхности продукта — по одной строке чек-листа на мокап. */
const SHOWCASE_POINTS = [
  {
    title: "Бланк для проверки",
    hint: "PDF по форме СанПиН — отдаёте инспектору в один клик",
  },
  {
    title: "Бот для смены",
    hint: "Повар заполняет журнал из Telegram за минуту",
  },
  {
    title: "Кабинет управляющего",
    hint: "Вся картина дня: кто заполнил, что просрочено",
  },
] as const;

/**
 * Витрина продукта — тёмный блок с заголовком, чек-листом и веером
 * мокапов, как у Мегаплана. Раньше на телефоне это была карусель с
 * серой подписью, и блок читался как недоделанный.
 *
 * Мобильный веер: лист А4 стоит ровно впереди, телефон и окно
 * браузера выглядывают из-за него наклонёнными в разные стороны.
 * Низ карточек уходит за край блока — так веер не раздувает высоту.
 */
export function ProductShowcase() {
  return (
    <section
      aria-label="Как выглядит WeSetup"
      className="relative mt-8 overflow-hidden rounded-3xl border border-[#ececf4] bg-[#0b1024] text-left text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)] sm:mt-16"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
        <div className="absolute -bottom-40 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
        <div className="absolute left-1/3 top-1/2 size-[280px] rounded-full bg-[#3d4efc] opacity-25 blur-[100px]" />
      </div>

      <div className="relative z-10 px-5 pt-7 sm:px-10 sm:pt-12 lg:flex lg:items-end lg:justify-between lg:gap-10">
        <div className="lg:max-w-[440px]">
          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#aeb7ff]">
            Как это выглядит
          </div>
          <h2 className="mt-2 text-[clamp(1.5rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
            Три экрана — и проверка больше не страшна
          </h2>
        </div>
        <ul className="mt-5 grid gap-3 sm:grid-cols-3 lg:mt-0 lg:flex-1 lg:grid-cols-3">
          {SHOWCASE_POINTS.map((point, i) => (
            // `hero-point`: внутри hero-секции li без своей анимации
            // остаются с opacity 0 (stagger-правило в globals.css ждёт
            // data-inview, которого у hero не бывает).
            <li
              key={point.title}
              className="hero-point flex items-start gap-3"
              style={{ animationDelay: `${400 + i * 120}ms` }}
            >
              <span className="mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-white/10 text-[#aeb7ff] ring-1 ring-white/15">
                <Check className="size-3" strokeWidth={3} />
              </span>
              <span>
                <span className="block text-[15px] font-semibold leading-snug">
                  {point.title}
                </span>
                <span className="mt-0.5 block text-[13px] leading-snug text-white/65">
                  {point.hint}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Телефон: веер из трёх карточек в коробке фиксированной высоты.
          Ширины заданы процентами от блока, чтобы на 320–430px ничего
          не вылезало за края. */}
      <div className="relative mt-4 h-[320px] sm:hidden">
        <div className="absolute left-[2%] top-4 w-[42%] origin-top -rotate-[14deg]">
          <TelegramMockup />
        </div>
        <div className="absolute right-[-4%] top-6 w-[560px] origin-top-right rotate-[9deg] scale-[0.42]">
          <DesktopMockup />
        </div>
        <div className="absolute left-1/2 top-[68px] z-10 w-[80%] -translate-x-1/2">
          <A4SheetMockup />
        </div>
      </div>

      {/* sm+: прежний десктопный веер, теперь внутри тёмного блока. */}
      <div className="hero-fan relative mx-auto hidden max-w-[1100px] sm:mt-12 sm:block sm:min-h-[620px] md:min-h-[680px]">
        <ScreenshotFan />
      </div>
    </section>
  );
}

/**
 * Веер мокапов для sm+ — дашборд по центру, телефон слева, лист А4
 * справа. Абсолютное позиционирование: карточки намеренно
 * перекрываются и наклонены.
 */
function ScreenshotFan() {
  return (
    <div className="absolute inset-0">
      <div className="absolute left-1/2 top-0 w-[min(700px,100%)] -translate-x-1/2">
        <DesktopMockup />
      </div>

      <div className="absolute bottom-0 left-[2%] w-[min(210px,21vw)] -rotate-[8deg] md:left-[5%] md:w-[228px]">
        <TelegramMockup />
      </div>

      {/* Лист А4 — справа и крупнее телефона: это главный аргумент
          секции, инспектору отдают именно его. */}
      <div className="absolute bottom-4 right-[1%] w-[min(330px,30vw)] rotate-[5deg] md:right-[3%] md:w-[360px]">
        <A4SheetMockup />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Desktop dashboard mockup
 * -------------------------------------------------------------------- */

function DesktopMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#ececf4] bg-white shadow-[0_12px_30px_-18px_rgba(11,16,36,0.18),0_0_0_1px_rgba(240,240,250,0.7)] sm:shadow-[0_40px_80px_-30px_rgba(11,16,36,0.25),0_0_0_1px_rgba(240,240,250,0.7)]">
      {/* browser chrome */}
      <div className="flex items-center gap-2 border-b border-[#ececf4] bg-[#fafbff] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff6059]" />
        <span className="size-2.5 rounded-full bg-[#ffbe2f]" />
        <span className="size-2.5 rounded-full bg-[#29d153]" />
        <div className="ml-4 flex h-6 flex-1 items-center rounded-full bg-white px-3 text-[11px] text-[#9b9fb3]">
          wesetup.ru/dashboard
        </div>
      </div>

      {/* Шапка кабинета — те же элементы и в том же порядке, что в
          настоящем: переключатель организации и «Сотрудники» слева,
          статус и действия справа. */}
      <div className="flex items-center gap-2 border-b border-[#ececf4] bg-white px-4 py-2.5">
        <div className="text-[#0b1024]">
          <BrandLogo height={15} title="" />
        </div>
        <span className="ml-2 inline-flex items-center gap-1.5 rounded-xl border border-[#ececf4] bg-white px-2.5 py-1 text-[10px] font-medium text-[#0b1024]">
          <Building2 className="size-3 text-[#5566f6]" />
          Ромашка
          <ChevronDown className="size-3 text-[#9b9fb3]" />
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#ececf4] bg-white px-2.5 py-1 text-[10px] font-medium text-[#0b1024]">
          <Users className="size-3 text-[#5566f6]" />
          Сотрудники
        </span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-xl bg-[#ecfdf5] px-2 py-1 text-[10px] font-medium text-[#116b2a]">
          <Cloud className="size-3" />
          В сети
        </span>
        <span className="inline-flex items-center gap-1 rounded-xl bg-[#5566f6] px-2.5 py-1 text-[10px] font-medium text-white">
          <MessageSquare className="size-3" />
          Обратная связь
        </span>
        <span className="flex size-6 items-center justify-center rounded-full bg-[#eef1ff] text-[9px] font-semibold text-[#3848c7]">
          М
        </span>
      </div>

      <div className="space-y-3 bg-[#f6f7fb] p-4">
        <div className="px-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
          Что сделать сегодня
        </div>

        {/* Тёмная карточка приветствия с четырьмя плитками — первое,
            что видит управляющая, открыв кабинет. */}
        <div className="relative overflow-hidden rounded-xl bg-[#0b1024] p-4 text-white">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-10 -top-10 size-[180px] rounded-full bg-[#5566f6] opacity-40 blur-[70px]" />
            <div className="absolute -bottom-16 right-0 size-[200px] rounded-full bg-[#7a5cff] opacity-30 blur-[80px]" />
          </div>
          <div className="relative flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
              <Sun className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-tight tracking-[-0.01em]">
                Доброе утро, Мария
              </div>
              <div className="mt-0.5 text-[10px] text-white/60">
                Четверг, 27 августа · ООО «Ромашка»
              </div>
            </div>
            <span className="ml-auto shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-medium uppercase tracking-wider text-white/80 ring-1 ring-white/15">
              Готовность сегодня: 72%
            </span>
          </div>
          <div className="relative mt-3 grid grid-cols-4 gap-2">
            {[
              { n: "18", l: "Записей сегодня" },
              { n: "3", l: "На проверке" },
              { n: "8", l: "Сотрудников" },
              { n: "35", l: "Журналов" },
            ].map((t) => (
              <div
                key={t.l}
                className="rounded-lg bg-white/[0.06] px-2.5 py-2 ring-1 ring-white/10"
              >
                <div className="text-[16px] font-semibold leading-none tabular-nums">
                  {t.n}
                </div>
                <div className="mt-1 text-[9px] leading-tight text-white/55">
                  {t.l}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Незаполненное за сегодня — то, ради чего кабинет открывают. */}
        <div className="rounded-xl border border-[#ececf4] bg-white p-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#eef1ff] text-[#5566f6]">
              <CheckCircle2 className="size-3.5" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-[#0b1024]">
                Закрыть день
              </div>
              <div className="text-[9px] text-[#6f7282]">
                Незаполненные журналы за сегодня
              </div>
            </div>
            <span className="ml-auto rounded-full bg-[#fff4f2] px-2 py-0.5 text-[9px] font-medium text-[#a13a32]">
              3 осталось
            </span>
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {[
              { name: "Гигиенический журнал", time: "09:00", done: true, auto: false },
              { name: "Температура холодильников", time: "10:00", done: true, auto: true },
              { name: "Бракераж готовой продукции", time: "12:00", done: false, auto: false },
              { name: "Уборка зала", time: "18:00", done: false, auto: false },
            ].map((r) => (
              <li
                key={r.name}
                className="flex items-center gap-2.5 rounded-lg bg-[#fafbff] px-2.5 py-1.5"
              >
                <CheckCircle2
                  className={`size-3 shrink-0 ${
                    r.done ? "text-[#5566f6]" : "text-[#dcdfed]"
                  }`}
                />
                <span className="text-[10px] font-medium text-[#0b1024]">
                  {r.name}
                </span>
                {r.auto ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-[#eef1ff] px-1.5 py-[1px] text-[8px] font-medium text-[#3848c7]">
                    <Wifi className="size-2" />
                    авто
                  </span>
                ) : null}
                <span className="ml-auto text-[9px] text-[#9b9fb3]">
                  {r.time}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-[#ececf4] bg-white p-3.5">
          <div className="flex items-baseline justify-between">
            <div className="text-[11px] font-semibold text-[#0b1024]">
              Заполнено за сегодня
            </div>
            <div className="text-[9px] tabular-nums text-[#6f7282]">
              25 из 35
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#eef0f6]">
            <div className="h-full w-[72%] rounded-full bg-[#5566f6]" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Telegram bot phone mockup
 * -------------------------------------------------------------------- */

function TelegramMockup() {
  return (
    // aspect-[9/19] locks this to a realistic phone ratio. Without it, the
    // inner chat content drives a tall natural height (~500 px for ~160 px
    // width), so on tablets the "веер" rendered as squished vertical
    // strips next to the desktop mockup — user feedback «телефоны в веере
    // вытянулись и стало некрасиво». `overflow-hidden` clips surplus chat
    // messages that don't fit inside the locked ratio.
    <div className="aspect-[9/19] overflow-hidden rounded-[34px] border-[6px] border-[#0b1024] bg-[#0b1024] shadow-[0_10px_28px_-16px_rgba(11,16,36,0.25)] sm:shadow-[0_30px_60px_-20px_rgba(11,16,36,0.4)]">
      <div className="h-full rounded-[28px] bg-white">
        {/* header */}
        <div className="flex items-center gap-2 bg-[#4680c2] px-4 py-3 text-white">
          <div className="flex size-8 items-center justify-center rounded-full bg-white/20">
            <Send className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold">
              @wesetupbot
            </div>
            <div className="text-[10px] text-white/70">в сети</div>
          </div>
        </div>
        {/* chat */}
        <div className="space-y-2 bg-[#eef3f8] p-3">
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 shadow-sm">
            <div className="text-[11px] font-semibold text-[#0b1024]">
              📋 Журналы
            </div>
            <div className="mt-1 text-[10px] leading-[1.4] text-[#6f7282]">
              Выберите журнал для заполнения:
            </div>
            <div className="mt-2 space-y-1.5">
              {["Гигиенический журнал", "Температура холодильников", "Уборка зала"].map(
                (t) => (
                  <div
                    key={t}
                    className="rounded-lg bg-[#eef1ff] px-2 py-1.5 text-[10px] font-medium text-[#3848c7]"
                  >
                    {t}
                  </div>
                )
              )}
            </div>
          </div>

          <div className="ml-auto max-w-[60%] rounded-2xl rounded-br-sm bg-[#5566f6] px-3 py-2 text-[10px] text-white">
            Температура холодильников
          </div>

          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 shadow-sm">
            <div className="text-[10px] text-[#0b1024]">
              Холодильник №3 — введите значение температуры:
            </div>
          </div>

          <div className="ml-auto max-w-[40%] rounded-2xl rounded-br-sm bg-[#5566f6] px-3 py-2 text-[10px] text-white">
            +2.8
          </div>

          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 shadow-sm">
            <div className="text-[10px] font-medium text-[#116b2a]">
              ✅ Запись сохранена
            </div>
            <div className="mt-0.5 text-[10px] text-[#6f7282]">
              Видна на сайте мгновенно
            </div>
          </div>
        </div>
        {/* input */}
        <div className="flex items-center gap-2 border-t border-[#ececf4] bg-white px-3 py-2">
          <div className="flex-1 rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[10px] text-[#9b9fb3]">
            Написать...
          </div>
          <div className="flex size-6 items-center justify-center rounded-full bg-[#5566f6]">
            <MessageSquare className="size-3 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * PDF export phone mockup
 * -------------------------------------------------------------------- */

/* ----------------------------------------------------------------------
 * A4 sheet mockup — «Журнал уборки»
 *
 * Заменил телефон с гигиеническим журналом. Посетитель лендинга — чаще
 * всего управляющая, которая держала в руках именно бумажный бланк:
 * лист А4 с шапкой ХАССП узнаётся мгновенно, а список фамилий на
 * телефоне — нет. Разметка статическая, «по мотивам» реального бланка,
 * а не рендер настоящего документа: это витрина, ей не нужен доступ
 * к чужим данным.
 * -------------------------------------------------------------------- */

/**
 * Дни месяца в шапке сетки. Выходные подкрашены — ровно как в
 * настоящей печатной форме.
 */
const A4_DAYS = [
  { d: "1", off: false },
  { d: "2", off: false },
  { d: "3", off: false },
  { d: "4", off: true },
  { d: "5", off: true },
  { d: "6", off: false },
  { d: "7", off: false },
  { d: "8", off: false },
  { d: "9", off: false },
  { d: "10", off: false },
  { d: "11", off: true },
  { d: "12", off: true },
  { d: "13", off: false },
  { d: "14", off: false },
];

/** Кто расписывается в сетке. Инициалы — как в заполненном журнале. */
const A4_SIGN_ROWS = [
  { title: "Ответственный за уборку", agent: "С1", mark: "МЕА" },
  { title: "Ответственный за контроль", agent: "С1", mark: "ИМП" },
];

/** Нижняя таблица помещений: что входит в текущую и генеральную уборку. */
const A4_ROOMS = [
  { name: "гостевая зона", current: "Т", general: "Г" },
  { name: "помещение мойки", current: "Т", general: "Г" },
  { name: "горячий цех/кухня", current: "Т", general: "Г" },
  { name: "Бар", current: "Т", general: "—" },
];

/* ----------------------------------------------------------------------
 * A4 sheet mockup — «Журнал уборки»
 *
 * Повторяет НАСТОЯЩУЮ печатную форму, которую отдаёт
 * /api/journal-samples/cleaning/pdf: та же шапка ХАССП, та же строка
 * периодичности, та же сетка «помещение | средства | месяц по дням» и
 * та же нижняя таблица помещений. Не «похожий бланк», а тот же —
 * иначе витрина обещала бы одно, а человек после регистрации получал
 * другое.
 *
 * Разметка статическая: витрине не нужен доступ к чужим данным.
 * -------------------------------------------------------------------- */

function A4SheetMockup() {
  return (
    <div className="overflow-hidden rounded-[6px] bg-white p-4 sm:aspect-[1.414/1] sm:p-[3.5%] shadow-[0_10px_28px_-16px_rgba(11,16,36,0.22)] ring-1 ring-[#e3e6f2] sm:shadow-[0_30px_60px_-20px_rgba(11,16,36,0.35)]">
      {/* Шапка бланка: организация | система и название | учётные даты */}
      <table className="w-full border-collapse text-[#0b1024]">
        <tbody>
          <tr>
            <td
              rowSpan={2}
              className="w-[26%] border border-[#0b1024] px-1.5 py-1 text-center text-[5.5px] leading-tight"
            >
              ООО «Ромашка» · ИНН 7701234567 · г. Москва, ул. Пищевая, д. 12
            </td>
            <td className="border border-[#0b1024] px-1.5 py-1 text-center text-[6px] leading-tight">
              СИСТЕМА ХАССП
            </td>
            <td className="w-[20%] border border-[#0b1024] px-1.5 py-1 text-[5.5px] leading-tight">
              Начат 01-04-2026
              <br />
              Окончен ________
            </td>
          </tr>
          <tr>
            <td className="border border-[#0b1024] px-1.5 py-1 text-center text-[6px] leading-tight">
              ЖУРНАЛ УБОРКИ
            </td>
            <td className="border border-[#0b1024] px-1.5 py-1 text-center text-[5.5px] leading-tight">
              СТР. 1 ИЗ 1
            </td>
          </tr>
          <tr>
            <td className="border border-[#0b1024] px-1.5 py-1 text-center text-[5.5px] leading-tight">
              Периодичность контроля
            </td>
            <td
              colSpan={2}
              className="border border-[#0b1024] px-1.5 py-1 text-[5.5px] leading-tight"
            >
              Текущая уборка — ежедневно (ежесменно); генеральная уборка —
              не реже одного раза в месяц по графику.
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 text-center text-[7px] font-medium text-[#0b1024]">
        ЖУРНАЛ УБОРКИ
      </div>

      {/* Сетка: кто расписался, каким средством и по каким дням */}
      <table className="mt-1.5 w-full border-collapse text-[#0b1024]">
        <thead>
          <tr>
            <th
              rowSpan={2}
              className="w-[22%] border border-[#0b1024] px-1 py-0.5 text-center text-[5px] font-normal leading-tight text-[#1b3a8f]"
            >
              Наименование помещения
            </th>
            <th
              rowSpan={2}
              className="w-[14%] border border-[#0b1024] px-1 py-0.5 text-center text-[5px] font-normal leading-tight text-[#1b3a8f]"
            >
              Моющие и дезинфицирующие средства
            </th>
            <th
              colSpan={A4_DAYS.length}
              className="border border-[#0b1024] px-1 py-0.5 text-center text-[5px] font-normal"
            >
              Месяц Апрель 2026 г.
            </th>
          </tr>
          <tr>
            {A4_DAYS.map((d) => (
              <th
                key={d.d}
                className={`border border-[#0b1024] px-0.5 py-0.5 text-center text-[5px] font-normal tabular-nums ${
                  d.off ? "bg-[#fbe3e1]" : ""
                }`}
              >
                {d.d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {A4_SIGN_ROWS.map((row) => (
            <tr key={row.title}>
              <td className="border border-[#0b1024] px-1 py-0.5 text-center text-[5px] leading-tight">
                {row.title}
              </td>
              <td className="border border-[#0b1024] px-1 py-0.5 text-center text-[5px]">
                {row.agent}
              </td>
              {A4_DAYS.map((d) => (
                <td
                  key={d.d}
                  className={`border border-[#0b1024] px-0.5 py-0.5 text-center text-[4.5px] ${
                    d.off ? "bg-[#fbe3e1] text-[#9b9fb3]" : "text-[#3c4053]"
                  }`}
                >
                  {d.off ? "" : row.mark}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[5px] text-[#3c4053]">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-1.5 border border-[#0b1024] bg-[#fbe3e1]" />
          Выходной или праздник
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-1.5 border border-[#0b1024] bg-[#fff6d9]" />
          Сокращённый день
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-1.5 border border-[#0b1024] bg-white" />
          Рабочий день
        </span>
      </div>

      <div className="mt-1.5 text-[5px] leading-[1.6] text-[#3c4053]">
        <div className="text-[5.5px] text-[#0b1024]">Условные обозначения:</div>
        <div>/-/ — Уборка не проводилась</div>
        <div>Т — Текущая</div>
        <div>Г — Генеральная</div>
      </div>

      <table className="mt-2 w-full border-collapse text-[#0b1024]">
        <thead>
          <tr>
            <th className="w-[30%] border border-[#0b1024] px-1 py-0.5 text-center text-[5px] font-normal text-[#1b3a8f]">
              Наименование помещения
            </th>
            <th className="border border-[#0b1024] px-1 py-0.5 text-center text-[5px] font-normal">
              Текущая уборка
            </th>
            <th className="border border-[#0b1024] px-1 py-0.5 text-center text-[5px] font-normal">
              Генеральная уборка
            </th>
          </tr>
        </thead>
        <tbody>
          {A4_ROOMS.map((r) => (
            <tr key={r.name}>
              <td className="border border-[#0b1024] px-1 py-0.5 text-[5px]">
                {r.name}
              </td>
              <td className="border border-[#0b1024] px-1 py-0.5 text-center text-[5px] font-medium">
                {r.current}
              </td>
              <td className="border border-[#0b1024] px-1 py-0.5 text-center text-[5px] font-medium text-[#1b3a8f]">
                {r.general}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex items-center justify-between border-t border-dashed border-[#dcdfed] pt-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-1.5 py-0.5 text-[5px] font-medium text-[#116b2a]">
          <FileText className="size-1.5" />
          PDF для проверки
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#0b1024] px-2 py-0.5 text-[5.5px] font-medium text-white">
          Скачать для проверки
          <ArrowRight className="size-1.5" />
        </span>
      </div>
    </div>
  );
}
