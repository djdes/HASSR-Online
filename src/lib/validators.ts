import {
  MAX_LOCATIONS,
  ORG_OWNERSHIP,
  ORG_SPHERES,
  normalizeSphere,
} from "@/lib/org-profile";
import { z } from "zod";

// Max bytes for bcrypt — anything longer is silently truncated and wastes bandwidth.
const PASSWORD_MAX = 72;

/** Кортежи значений для z.enum — он не принимает readonly-массив объектов. */
export const ORG_SPHERE_VALUES = ORG_SPHERES.map((s) => s.value) as [
  string,
  ...string[],
];
const ORG_OWNERSHIP_VALUES = ORG_OWNERSHIP.map((o) => o.value) as [
  string,
  ...string[],
];


export const loginSchema = z.object({
  email: z.string().email("Введите корректный email").max(320),
  password: z
    .string()
    .min(6, "Пароль должен содержать минимум 6 символов")
    .max(PASSWORD_MAX, `Пароль не должен превышать ${PASSWORD_MAX} символов`),
});

export const registerSchema = z.object({
  organizationName: z.string().min(2, "Название организации должно содержать минимум 2 символа").max(200),
  // Сфера заведения. Значения — из общего словаря org-profile, чтобы
  // список не разъезжался с модалкой анкеты и настройками.
  organizationType: z.string().transform((v) => normalizeSphere(v)),
  name: z.string().min(2, "Имя должно содержать минимум 2 символа").max(100),
  email: z.string().email("Введите корректный email").max(320),
  password: z
    .string()
    .min(6, "Пароль должен содержать минимум 6 символов")
    .max(PASSWORD_MAX, `Пароль не должен превышать ${PASSWORD_MAX} символов`),
  phone: z.string().max(40).optional(),
});

export const journalEntrySchema = z.object({
  templateCode: z.string().min(1, "templateCode обязателен").max(100),
  areaId: z.string().min(1).max(100).optional(),
  equipmentId: z.string().min(1).max(100).optional(),
  data: z.record(z.string(), z.unknown()),
});

export const areaSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  description: z.string().max(1000).optional(),
});

export const equipmentSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  // Все типы из окна оборудования: раньше «УФ-лампа», «Датчик» и
  // «Фритюрница» отдавали 400 при создании.
  type: z.enum(["refrigerator", "freezer", "oven", "dishwasher", "scale", "thermometer", "sensor", "fryer", "uv_lamp", "other"], {
    message: "Выберите тип оборудования",
  }),
  serialNumber: z.string().max(100).optional(),
  tempMin: z.number().finite().optional(),
  tempMax: z.number().finite().optional(),
  tuyaDeviceId: z.string().max(100).optional(),
  areaId: z.string().min(1, "Выберите зону"),
  /** «Кто заполняет» по QR; пусто — все. */
  fillerUserIds: z.array(z.string().min(1).max(64)).max(200).optional(),
  /** УФ-лампа: модель, ресурс, дата установки, уже отработала. */
  lampModel: z.string().max(120).optional(),
  lampLifetimeHours: z.number().int().min(1).max(100000).optional(),
  lampInstalledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lampUsedHours: z.number().min(0).max(100000).optional(),
});

export const competencySchema = z.object({
  userId: z.string().min(1).max(100),
  skill: z.string().min(1).max(100),
  level: z.number().int().min(0).max(3),
  expiresAt: z.string().datetime().optional().or(z.string().length(0)).or(z.null()).optional(),
  notes: z.string().max(1000).optional().or(z.null()),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type JournalEntryInput = z.infer<typeof journalEntrySchema>;
export type AreaInput = z.infer<typeof areaSchema>;
export type EquipmentInput = z.infer<typeof equipmentSchema>;
export type CompetencyInput = z.infer<typeof competencySchema>;

export const notificationPrefsSchema = z.object({
  temperature: z.boolean(),
  deviations: z.boolean(),
  compliance: z.boolean(),
  /// Еженедельная сводка на почту (понедельник 08:00). Старые записи без ключа = включено.
  weeklyDigest: z.boolean().default(true),
  /// Тихие часы Telegram: не-срочное откладывается до конца окна (lib/quiet-hours.ts).
  quietHours: z
    .object({ enabled: z.boolean(), from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })
    .optional(),
});

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  temperature: true,
  deviations: true,
  compliance: true,
  weeklyDigest: true,
};

/**
 * Анкета после мгновенной регистрации.
 *
 * Обязательны только название организации и телефон: без первого
 * кабинет и PDF подписаны заглушкой, без второго не работает
 * авто-связка сотрудника с TasksFlow по номеру. Остальное человек
 * дозаполнит в настройках, и держать его в модалке незачем.
 */
export const completeProfileSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, "Название организации — минимум 2 символа")
    .max(200),
  phone: z.string().trim().min(1, "Укажите телефон").max(40),
  sphere: z.enum(ORG_SPHERE_VALUES).default("restaurant"),
  ownershipKind: z.enum(ORG_OWNERSHIP_VALUES).default("private"),
  locationsCount: z.coerce.number().int().min(1).max(MAX_LOCATIONS).default(1),
  inn: z.string().trim().max(20).optional().or(z.literal("")),
  /** Юридический адрес из ЕГРЮЛ — подставляется анкетой по ИНН. */
  address: z.string().trim().max(500).optional().or(z.literal("")),
  name: z.string().trim().max(100).optional().or(z.literal("")),
  newPassword: z.string().min(6, "Пароль — минимум 6 символов").max(200).optional().or(z.literal("")),
  // Оформить владельца сотрудником: должность из каталога организации,
  // чтобы он не висел в списке команды без роли.
  asEmployee: z.boolean().default(true),
  positionName: z
    .string()
    .trim()
    .min(2, "Должность — минимум 2 символа")
    .max(120)
    .optional()
    .or(z.literal("")),
});
