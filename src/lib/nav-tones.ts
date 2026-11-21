/**
 * Тон пункта меню по **имени иконки** (владелец, 2026-10-29, вариант C: у
 * каждого пункта был свой цвет).
 *
 * С 2026-11-21 (владелец: «кнопки и иконки одинакового цвета в светлой и
 * тёмной версии») все тона рисуются одним цветом — акцентом темы: блок
 * `[data-tone]` в `app-theme.css` один, значение тона на цвет не влияет
 * (`src/app/one-accent.test.ts`). Карта и атрибут `data-tone` оставлены,
 * чтобы не переписывать вызывающих; новой иконке тон нужен только затем,
 * чтобы прошёл `nav-tones.test.ts`. Модуль без React: его читают серверные
 * компоненты и тесты.
 */

export const NAV_TONES = [
  "indigo",
  "violet",
  "sky",
  "teal",
  "green",
  "amber",
  "orange",
  "rose",
  "fuchsia",
] as const;

export type NavTone = (typeof NAV_TONES)[number];

/**
 * Иконка → тон. Группы по смыслу: индиго — главное и документы, фиолетовый —
 * люди, небесный — офис и оборудование, бирюзовый — контроль, зелёный —
 * «всё в порядке», янтарный — деньги и помещения, оранжевый — точки и
 * продукты, розовый — срочное, пурпурный — оформление и QR.
 */
const ICON_TONES: Record<string, NavTone> = {
  Archive: "indigo",
  Binoculars: "indigo",
  Building2: "indigo",
  ClipboardList: "indigo",
  FileText: "indigo",
  LayoutTemplate: "indigo",
  ListOrdered: "indigo",
  Network: "indigo",
  Plus: "indigo",
  ScrollText: "indigo",
  Webhook: "indigo",

  FlaskConical: "violet",
  GitBranch: "violet",
  KeyRound: "violet",
  Library: "violet",
  ListChecks: "violet",
  Printer: "violet",
  Settings2: "violet",
  SwatchBook: "violet",
  User: "violet",
  Users: "violet",
  UsersRound: "violet",
  Wand2: "violet",

  BookOpen: "sky",
  Boxes: "sky",
  BriefcaseBusiness: "sky",
  CalendarDays: "sky",
  CalendarRange: "sky",
  Contact: "sky",
  FolderOpen: "sky",
  Languages: "sky",
  MessageCircle: "sky",
  Newspaper: "sky",
  PenLine: "sky",
  Plug: "sky",
  Refrigerator: "sky",
  Send: "sky",
  Shuffle: "sky",
  Workflow: "sky",

  ArrowDownToLine: "teal",
  BadgeCheck: "teal",
  CloudUpload: "teal",
  Crosshair: "teal",
  FileCheck2: "teal",
  Gauge: "teal",
  Handshake: "teal",
  Phone: "teal",
  ShieldPlus: "teal",

  CalendarCheck: "green",
  ClipboardCheck: "green",
  FileSpreadsheet: "green",
  GraduationCap: "green",
  LayoutGrid: "green",
  Map: "green",
  ShieldCheck: "green",
  TabletSmartphone: "green",
  UserCheck: "green",
  Wallet: "green",

  Award: "amber",
  Bell: "amber",
  Coins: "amber",
  CreditCard: "amber",
  DoorOpen: "amber",
  Lightbulb: "amber",
  ListPlus: "amber",
  Scale: "amber",
  Stamp: "amber",
  UserSearch: "amber",

  Package: "orange",
  Rocket: "orange",
  Store: "orange",
  UtensilsCrossed: "orange",

  AlertTriangle: "rose",
  Bug: "rose",
  HeartPulse: "rose",
  LogOut: "rose",
  ShieldAlert: "rose",
  TrendingDown: "rose",
  TriangleAlert: "rose",

  Eye: "fuchsia",
  Image: "fuchsia",
  Palette: "fuchsia",
  QrCode: "fuchsia",
  Sparkles: "fuchsia",
};

/** Тон иконки меню; у незнакомой иконки — фирменный индиго. */
export function navTone(icon: string): NavTone {
  return Object.hasOwn(ICON_TONES, icon) ? ICON_TONES[icon] : "indigo";
}

export function hasNavTone(icon: string): boolean {
  return Object.hasOwn(ICON_TONES, icon);
}
