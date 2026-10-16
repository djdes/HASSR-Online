import { createElement } from "react";
import {
  AlertTriangle,
  Award,
  Bell,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  CloudUpload,
  Coins,
  CreditCard,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Gauge,
  Handshake,
  KeyRound,
  LayoutGrid,
  Library,
  Lightbulb,
  ListChecks,
  Network,
  Package,
  Phone,
  Plug,
  Printer,
  Scale,
  ScrollText,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Store,
  TabletSmartphone,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";

/**
 * Имена иконок меню (`lib/app-nav.ts`, `lib/settings-cards.ts`) → компоненты
 * lucide. Имена лежат строками, потому что модули меню читает и сервер, а
 * функции через границу RSC не передаются.
 */
const NAV_ICONS: Record<string, LucideIcon> = {
  AlertTriangle,
  Award,
  Bell,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  CloudUpload,
  Coins,
  CreditCard,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Gauge,
  Handshake,
  KeyRound,
  LayoutGrid,
  Library,
  Lightbulb,
  ListChecks,
  Network,
  Package,
  Phone,
  Plug,
  Printer,
  Scale,
  ScrollText,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Store,
  TabletSmartphone,
  Users,
  Webhook,
};

export function navIcon(name: string): LucideIcon {
  return NAV_ICONS[name] ?? LayoutGrid;
}

export function hasNavIcon(name: string): boolean {
  return Object.hasOwn(NAV_ICONS, name);
}

/**
 * Иконка меню по имени. Через `createElement`, а не `const Icon = …`
 * в рендере: компилятор React считает такой `Icon` новым компонентом
 * на каждый рендер.
 */
export function NavIcon({ name, className }: { name: string; className?: string }) {
  return createElement(navIcon(name), { className, "aria-hidden": true });
}
