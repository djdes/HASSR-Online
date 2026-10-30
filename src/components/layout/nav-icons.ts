import { createElement } from "react";
import { navTone, type NavTone } from "@/lib/nav-tones";
import {
  AlertTriangle,
  Archive,
  Award,
  BadgeCheck,
  Bell,
  Binoculars,
  BookOpen,
  BriefcaseBusiness,
  Bug,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  CloudUpload,
  Coins,
  Contact,
  CreditCard,
  Crosshair,
  DoorOpen,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  FolderOpen,
  Gauge,
  GitBranch,
  GraduationCap,
  Handshake,
  HeartPulse,
  Image,
  KeyRound,
  Languages,
  LayoutGrid,
  LayoutTemplate,
  Library,
  Lightbulb,
  ListChecks,
  ListOrdered,
  ListPlus,
  LogOut,
  Map,
  Network,
  Package,
  Palette,
  PenLine,
  Phone,
  Plug,
  Plus,
  Printer,
  QrCode,
  Refrigerator,
  Rocket,
  Scale,
  ScrollText,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShieldPlus,
  Shuffle,
  Sparkles,
  Stamp,
  Store,
  SwatchBook,
  TabletSmartphone,
  TrendingDown,
  TriangleAlert,
  UserCheck,
  UserSearch,
  Users,
  UsersRound,
  UtensilsCrossed,
  Wallet,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * Имена иконок меню (`lib/app-nav.ts`, `lib/settings-cards.ts`) → компоненты
 * lucide. Имена лежат строками, потому что модули меню читает и сервер, а
 * функции через границу RSC не передаются.
 */
const NAV_ICONS: Record<string, LucideIcon> = {
  AlertTriangle,
  Archive,
  Award,
  BadgeCheck,
  Bell,
  Binoculars,
  BookOpen,
  BriefcaseBusiness,
  Bug,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  CloudUpload,
  Coins,
  Contact,
  CreditCard,
  Crosshair,
  DoorOpen,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  FolderOpen,
  Gauge,
  GitBranch,
  GraduationCap,
  Handshake,
  HeartPulse,
  Image,
  KeyRound,
  Languages,
  LayoutGrid,
  LayoutTemplate,
  Library,
  Lightbulb,
  ListChecks,
  ListOrdered,
  ListPlus,
  LogOut,
  Map,
  Network,
  Package,
  Palette,
  PenLine,
  Phone,
  Plug,
  Plus,
  Printer,
  QrCode,
  Refrigerator,
  Rocket,
  Scale,
  ScrollText,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShieldPlus,
  Shuffle,
  Sparkles,
  Stamp,
  Store,
  SwatchBook,
  TabletSmartphone,
  TrendingDown,
  TriangleAlert,
  UserCheck,
  UserSearch,
  Users,
  UsersRound,
  UtensilsCrossed,
  Wallet,
  Webhook,
  Workflow,
};

export function navIcon(name: string): LucideIcon {
  return NAV_ICONS[name] ?? LayoutGrid;
}

export function hasNavIcon(name: string): boolean {
  return Object.hasOwn(NAV_ICONS, name);
}

/** Все имена иконок меню — у каждой должен быть свой тон (`nav-tones.test.ts`). */
export const NAV_ICON_NAMES: readonly string[] = Object.keys(NAV_ICONS);

/**
 * Иконка меню по имени. Через `createElement`, а не `const Icon = …`
 * в рендере: компилятор React считает такой `Icon` новым компонентом
 * на каждый рендер.
 */
export function NavIcon({ name, className }: { name: string; className?: string }) {
  return createElement(navIcon(name), { className, "aria-hidden": true });
}

/**
 * Цветная плашка иконки (вариант C, 2026-10-29): градиент тона и белая
 * иконка. Тон — по имени иконки (`lib/nav-tones.ts`), так что пункт одного
 * цвета во всех меню. Размер и скругление задаёт место (`className`);
 * цвета, свечение и движение — `[data-nav-chip]` в `app-theme.css`.
 * Строка вокруг с `data-nav-row` оживляет плашку при наведении, с
 * `data-active` — выделяет. `text-current` на иконке: правило пунктов меню
 * красит серым каждую иконку без своего цвета.
 */
export function NavIconChip({
  name,
  className,
  iconClassName,
}: {
  name: string;
  className?: string;
  iconClassName?: string;
}) {
  return createElement(ToneChip, { tone: navTone(name), icon: navIcon(name), className, iconClassName });
}

/** Плашка с явным тоном — для иконок вне меню (каналы связи на главной). */
export function ToneChip({
  tone,
  icon,
  className,
  iconClassName,
}: {
  tone: NavTone;
  icon: LucideIcon;
  className?: string;
  iconClassName?: string;
}) {
  return createElement(
    "span",
    { "data-nav-chip": "", "data-tone": tone, "aria-hidden": true, className },
    createElement(icon, {
      className: iconClassName ? `text-current ${iconClassName}` : "text-current",
      "aria-hidden": true,
    }),
  );
}
