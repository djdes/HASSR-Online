import type { BuildingOption } from "@/lib/building-scope";

/** «commission» — сторонняя бракеражная комиссия (третья колонка «Комиссия»). */
export type PositionCategory = "management" | "staff" | "commission";

export type StaffPosition = {
  id: string;
  categoryKey: PositionCategory;
  name: string;
  sortOrder: number;
};

export type StaffEmployee = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  jobPositionId: string | null;
  positionTitle: string | null;
  role: string;
  isActive: boolean;
  isRoot: boolean;
  isSelf: boolean;
  telegramLinked: boolean;
  /// Недельное правило выходных: 0=Пн … 6=Вс.
  weeklyDaysOff: number[];
  /// Точки, на которых работает сотрудник; пусто — на всех.
  buildingIds?: string[];
  /// Задан ли PIN для QR-форм (сам PIN на клиент не уходит).
  hasQrPin?: boolean;
  /** «Уполномочен редактировать в бракеражных журналах список блюд». */
  canEditBrakerageDishes?: boolean;
  /** «Ответственный за ведение основных журналов» (гигиена и здоровье). */
  keepsCoreJournals?: boolean;
  /** «Разрешение менять настройки» — права руководителя на настройки. */
  canManageSettings?: boolean;
};

export type StaffTelegramInvitePayload = {
  inviteUrl: string;
  qrPngDataUrl: string;
  expiresAt: string;
};

export type StaffWorkOff = {
  userId: string;
  /// ISO YYYY-MM-DD
  date: string;
  /// Исключение из недельного правила: "off" — выходной вопреки
  /// правилу, "work" — рабочий день вопреки правилу.
  kind: "off" | "work";
};

export type StaffPeriodRow = {
  id: string;
  userId: string;
  userName: string;
  jobPositionId: string | null;
  positionLabel: string;
  /// ISO YYYY-MM-DD
  dateFrom: string;
  /// ISO YYYY-MM-DD
  dateTo: string;
};

export type StaffDismissalRow = {
  id: string;
  userId: string;
  userName: string;
  jobPositionId: string | null;
  positionLabel: string;
  /// ISO YYYY-MM-DD
  date: string;
};

export type StaffPageProps = {
  organization: { id: string; name: string };
  /** Точки организации — чипы «Точки» в диалогах сотрудника. */
  buildings?: BuildingOption[];
  /** Журналы ведутся отдельно по точкам — чипы показываются только тогда. */
  perLocationJournals?: boolean;
  /** Активная точка — новый сотрудник по умолчанию привязывается к ней. */
  activeBuildingId?: string | null;
  telegramBotUrl: string | null;
  /** Интеграция TasksFlow подключена — промо-блок не показываем. */
  hasTasksflowIntegration: boolean;
  positions: StaffPosition[];
  employees: StaffEmployee[];
  /// Подсказки названий должностей для сферы организации, уже без
  /// тех, что заведены. Считаются на сервере из onboarding-пресета.
  positionSuggestions: Record<PositionCategory, string[]>;
  workOffDays: StaffWorkOff[];
  vacations: StaffPeriodRow[];
  sickLeaves: StaffPeriodRow[];
  dismissals: StaffDismissalRow[];
};
