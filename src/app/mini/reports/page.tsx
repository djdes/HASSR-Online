import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { APP_SECTIONS, canSeeAppSection } from "@/lib/app-sections";

import { MiniReportsClient, type MiniReportLink } from "./reports-client";

export const dynamic = "force-dynamic";

/**
 * Отчёты в мини-приложении.
 *
 * Раньше каждая строка вела на `/mini/open` — экран-заглушку «раздел
 * только в полной версии», и человек уходил из приложения. Теперь
 * разделы открываются прямо здесь, в оболочке приложения, потому что
 * страницы сайта умеют в ней работать.
 *
 * Показываем только то, что человеку и правда открыто: права берём тем
 * же `canSeeAppSection`, что и экран «Все разделы» — иначе строка вела
 * бы в отказ, и приложение выглядело бы сломанным.
 */
const REPORT_ROWS: {
  href: string;
  /** Адрес раздела, по правам которого решаем показывать строку. */
  section: string;
  label: string;
  hint: string;
  icon: string;
}[] = [
  {
    href: "/reports?format=pdf",
    section: "/reports",
    label: "Журналы в PDF",
    hint: "для проверяющего, на печать",
    icon: "FileText",
  },
  {
    href: "/reports?format=excel",
    section: "/reports",
    label: "Журналы в Excel",
    hint: "таблица для своих расчётов",
    icon: "FileSpreadsheet",
  },
  {
    href: "/plans",
    section: "/plans",
    label: "Производственный план",
    hint: "что и сколько готовим",
    icon: "CalendarRange",
  },
  {
    href: "/capa",
    section: "/capa",
    label: "Нарушения и их устранение",
    hint: "что нашли и как исправили (CAPA)",
    icon: "AlertTriangle",
  },
  {
    href: "/losses",
    section: "/losses",
    label: "Потери и списания",
    hint: "испорченные и просроченные продукты",
    icon: "TrendingDown",
  },
  {
    href: "/changes",
    section: "/changes",
    label: "Изменения в работе",
    hint: "новое оборудование, рецептура, поставщик",
    icon: "GitBranch",
  },
  {
    href: "/competencies",
    section: "/competencies",
    label: "Обучение сотрудников",
    hint: "кто что прошёл и когда повторять",
    icon: "GraduationCap",
  },
  {
    href: "/batches",
    section: "/batches",
    label: "Партии продукции",
    hint: "прослеживаемость сырья и блюд",
    icon: "Package",
  },
];

export default async function MiniReportsPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user ?? null;

  const links: MiniReportLink[] = user
    ? REPORT_ROWS.filter((row) => {
        const section = APP_SECTIONS.find((item) => item.href === row.section);
        return section ? canSeeAppSection(user, section) : false;
      }).map(({ href, label, hint, icon }) => ({ href, label, hint, icon }))
    : [];

  return <MiniReportsClient links={links} authed={Boolean(user)} />;
}
