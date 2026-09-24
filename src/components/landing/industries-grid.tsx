import Link from "next/link";
import {
  ArrowRight,
  Dumbbell,
  Factory,
  Fuel,
  GraduationCap,
  HeartPulse,
  Hotel,
  Scissors,
  ShoppingCart,
  Store,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/**
 * Секция «Кому подходит» на лендинге: полный список сфер и типов
 * бизнеса, которым по СанПиН/ХАССП нужны журналы. Каждый тип ведёт на
 * посадочную `/dlya-*` (если она есть) или в каталог журналов.
 *
 * Наборы журналов, приказов и чек-листов по сферам живут в
 * `SPHERE_RULES` (страницы `/dlya-*` строятся из них) — здесь только
 * навигационная карта «тип бизнеса → посадочная». Server component:
 * иконки рендерятся прямо тут и через RSC-границу не передаются (правило
 * про LucideIcon в CLAUDE.md).
 */

type IndustryLink = { label: string; href: string };
type IndustryGroup = { title: string; icon: LucideIcon; items: IndustryLink[] };

const INDUSTRY_GROUPS: IndustryGroup[] = [
  {
    title: "Общепит",
    icon: UtensilsCrossed,
    items: [
      { label: "Рестораны", href: "/dlya-kafe" },
      { label: "Кафе и кофейни", href: "/dlya-kafe" },
      { label: "Бары и пабы", href: "/dlya-bara" },
      { label: "Столовые", href: "/dlya-stolovoy" },
      { label: "Фастфуд", href: "/dlya-fastfuda" },
      { label: "Пиццерии и суши", href: "/dlya-fastfuda" },
      { label: "Фудтраки", href: "/dlya-fastfuda" },
    ],
  },
  {
    title: "Производство",
    icon: Factory,
    items: [
      { label: "Пекарни", href: "/dlya-pekarni" },
      { label: "Кондитерские", href: "/dlya-pekarni" },
      { label: "Кулинарные цеха", href: "/dlya-proizvodstva" },
      { label: "Мясные и рыбные цеха", href: "/dlya-proizvodstva" },
      { label: "Фабрики-кухни", href: "/dlya-proizvodstva" },
      { label: "Пищевые производства", href: "/dlya-proizvodstva" },
    ],
  },
  {
    title: "Образование",
    icon: GraduationCap,
    items: [
      { label: "Детские сады", href: "/dlya-detskogo-sada" },
      { label: "Школы", href: "/dlya-detskogo-sada" },
      { label: "Колледжи и вузы", href: "/dlya-stolovoy" },
      { label: "Детские лагеря", href: "/dlya-detskogo-sada" },
    ],
  },
  {
    title: "Медицина и соцсфера",
    icon: HeartPulse,
    items: [
      { label: "Больницы и клиники", href: "/dlya-medcentra" },
      { label: "Санатории", href: "/dlya-medcentra" },
      { label: "Дома престарелых", href: "/dlya-medcentra" },
    ],
  },
  {
    title: "Гостеприимство",
    icon: Hotel,
    items: [
      { label: "Отели и гостиницы", href: "/dlya-otelya" },
      { label: "Базы отдыха и глэмпинги", href: "/dlya-otelya" },
      { label: "Хостелы с кухней", href: "/dlya-otelya" },
    ],
  },
  {
    title: "Дорога и промышленность",
    icon: Fuel,
    items: [
      { label: "Кафе при АЗС", href: "/dlya-azs" },
      { label: "Придорожные кафе", href: "/dlya-azs" },
      { label: "Вахтовые столовые", href: "/dlya-stolovoy" },
    ],
  },
  {
    title: "Спорт и бассейны",
    icon: Dumbbell,
    items: [
      { label: "Фитнес-клубы", href: "/dlya-fitnes-centra" },
      { label: "Бассейны", href: "/dlya-fitnes-centra" },
      { label: "Спортзалы и СПА", href: "/dlya-fitnes-centra" },
    ],
  },
  {
    title: "Красота и уход",
    icon: Scissors,
    items: [
      { label: "Салоны красоты", href: "/dlya-salona-krasoty" },
      { label: "Парикмахерские и барбершопы", href: "/dlya-salona-krasoty" },
      { label: "Маникюр и педикюр", href: "/dlya-salona-krasoty" },
      { label: "Косметология", href: "/dlya-salona-krasoty" },
    ],
  },
  {
    title: "Ритейл и доставка",
    icon: ShoppingCart,
    items: [
      { label: "Магазины с кулинарией", href: "/dlya-magazina" },
      { label: "Кейтеринг", href: "/dlya-keyteringa" },
      { label: "Доставка готовой еды", href: "/dlya-keyteringa" },
    ],
  },
];

export function IndustriesGrid() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
      <div className="mb-10 max-w-[720px]">
        <div className="mb-3 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
          <Store className="size-4" />
          Кому подходит
        </div>
        <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
          Журналы нужны всем, кто кормит людей или принимает посетителей
        </h2>
        <p className="mt-3 text-[15px] text-[#6f7282]">
          СанПиН 2.3/2.4.4282-26 распространяется на всё общественное
          питание — от кофейни до пищеблока больницы, а у фитнес-клуба с
          бассейном и у салона красоты свои санитарные правила. Найдите
          свою сферу и посмотрите,
          какие журналы, приказы и чек-листы нужны именно ей.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INDUSTRY_GROUPS.map((group) => (
          <div
            key={group.title}
            className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6"
          >
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                <group.icon className="size-5" />
              </span>
              <div className="text-[15px] font-semibold text-[#0b1024]">
                {group.title}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {group.items.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="inline-flex items-center rounded-full border border-[#ececf4] bg-[#fafbff] px-3 py-1.5 text-[13px] text-[#3c4053] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#3848c7]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Fallback: сфера не в списке — всё равно ведём в каталог журналов. */}
      <div className="mt-6">
        <Link
          href="/journals-info"
          className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          Не нашли свою сферу — смотрите каталог журналов
          <ArrowRight className="size-4 text-[#5566f6]" />
        </Link>
      </div>
    </section>
  );
}
