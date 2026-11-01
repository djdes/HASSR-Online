import type { ReactNode } from "react";
import type { BuildingOption } from "@/lib/building-scope";

/** «commission» — сторонняя бракеражная комиссия (третья колонка «Комиссия»). */
export type PositionCategory = "management" | "staff" | "commission";

export type StaffPosition = {
  id: string;
  categoryKey: PositionCategory;
  name: string;
  sortOrder: number;
  /** Штатная численность; null — не задана (см. src/lib/staffing.ts). */
  plannedHeadcount?: number | null;
};

/** Действующая временная точка сотрудника (замена), см. point-assignments.ts. */
export type StaffPointAssignment = {
  id: string;
  buildingId: string;
  buildingName: string;
  mode: "transfer" | "extra";
  /** День возврата `YYYY-MM-DD` по часам организации. */
  returnKey: string;
  /** Точки, на которые вернётся после перевода. */
  returnBuildingNames: string[];
};

export type StaffEmployee = {
  id: string;
  name: string;
  email: string;
  /** Личная почта (не логин), см. User.contactEmail. */
  contactEmail?: string | null;
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
  /** Основная точка у сотрудника на нескольких точках. */
  primaryBuildingId?: string | null;
  /** Временная точка (замена), если есть. */
  pointAssignment?: StaffPointAssignment | null;
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
  positionRoleCode?: string | null;
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
  positionRoleCode?: string | null;
  /// ISO YYYY-MM-DD
  date: string;
};

export type StaffPageProps = {
  organization: { id: string; name: string };
  /** Точки организации — чипы «Точки» в диалогах сотрудника. */
  buildings?: BuildingOption[];
  /** Журналы ведутся отдельно по точкам — чипы показываются только тогда. */
  perLocationJournals?: boolean;
  /** «Сегодня» по часам организации — подпись «Вернётся 05.11» в окне замены. */
  todayKey?: string;
  /**
   * Место, выбранное в фильтре «Где работает» (точка или офис), — новый
   * сотрудник по умолчанию привязывается к нему (2026-10-29: раньше — к точке
   * из шапки, даже если в фильтре выбрана другая). «Все» — null.
   */
  activeBuildingId?: string | null;
  /**
   * Открыть добавление сотрудника сразу в это место (`?add=` со страницы
   * офиса или точки): офис — рубрика «Руководство», точка — «Сотрудники».
   */
  initialAdd?: { buildingId: string; office: boolean } | null;
  /** Фильтр «Где работает» — под заголовком страницы (рисует сервер). */
  placeFilter?: ReactNode;
  telegramBotUrl: string | null;
  /** Интеграция TasksFlow подключена — промо-блок не показываем. */
  hasTasksflowIntegration: boolean;
  /** Править и удалять должности (справочник на всю компанию) — не руководителю точки. */
  canEditPositions?: boolean;
  positions: StaffPosition[];
  employees: StaffEmployee[];
  /// Подсказки названий должностей для сферы организации, уже без
  /// тех, что заведены. Считаются на сервере из onboarding-пресета.
  positionSuggestions: Record<PositionCategory, Array<{ id: string; name: string }>>;
  workOffDays: StaffWorkOff[];
  vacations: StaffPeriodRow[];
  sickLeaves: StaffPeriodRow[];
  dismissals: StaffDismissalRow[];
  /**
   * Места тарифа заняты — заметка под шапкой: лимит и следующий тариф
   * (кнопка на страницу тарифа) или «по согласованию» у «Премиума»
   * («Связаться»); в приложении WeSetup — только факт, без кнопки.
   */
  seatsBanner?: {
    text: string;
    action: { kind: "pay"; href: string; label: string } | { kind: "contact"; subject: string; label: string } | null;
  } | null;
};
