/**
 * «Живой» гид по регистрации: подсвечивает на настоящих страницах поле
 * или кнопку и говорит, что сделать. Человек сам нажимает — гид идёт
 * дальше, когда условие шага выполнено (почта введена, галочка стоит,
 * страница сменилась, окно закрылось).
 *
 * Цели помечены `data-guide="<target>"` в разметке: /register, анкета
 * после регистрации (`complete-profile-nudge`) и главная кабинета.
 */
export type GuideAdvance =
  | { kind: "next" }
  | { kind: "click" }
  | { kind: "email" }
  | { kind: "checked" }
  | { kind: "minLength"; n: number }
  | { kind: "digits"; n: number }
  /** Ушли со страницы шага — например, после «Создать аккаунт». */
  | { kind: "leave" }
  /** Цель пропала — окно анкеты закрылось после «Готово». */
  | { kind: "gone" };

export type GuideStep = {
  id: string;
  /** Где живёт шаг: путь страницы. */
  path: RegExp;
  /** Значение `data-guide` у цели; без цели — карточка по центру. */
  target?: string;
  title: string;
  text: string;
  advance: GuideAdvance;
  /** Подпись у цели: «Нажмите сюда», «Введите здесь». */
  hint?: string;
};

export const REGISTER_GUIDE: GuideStep[] = [
  {
    id: "email",
    path: /^\/register\/?$/,
    target: "reg-email",
    title: "Введите вашу почту",
    text: "Подойдёт любая почта, к которой у вас есть доступ: на неё придёт пароль для входа. Больше ничего заполнять не нужно.",
    advance: { kind: "email" },
    hint: "Введите здесь",
  },
  {
    id: "consent",
    path: /^\/register\/?$/,
    target: "reg-consent",
    title: "Поставьте галочку",
    text: "Это согласие с офертой и политикой конфиденциальности — без него кабинет не создаётся.",
    advance: { kind: "checked" },
    hint: "Нажмите на квадратик",
  },
  {
    id: "submit",
    path: /^\/register\/?$/,
    target: "reg-submit",
    title: "Нажмите «Создать аккаунт»",
    text: "Кабинет создаётся сразу — через пару секунд вы окажетесь внутри. Карта не нужна, 14 дней всё бесплатно.",
    advance: { kind: "leave" },
    hint: "Нажмите сюда",
  },
  {
    id: "profile",
    path: /^\/home\/?$/,
    target: "profile-modal",
    title: "Аккаунт создан!",
    text: "Осталось заполнить короткую анкету — эти данные попадут в шапки журналов и документы для проверки. Обязательные поля отмечены красной точкой.",
    advance: { kind: "next" },
  },
  {
    id: "org",
    path: /^\/home\/?$/,
    target: "profile-org",
    title: "Название организации",
    text: "Как называется ваше заведение или юрлицо, например «Кафе Ромашка» или ООО «Ромашка».",
    advance: { kind: "minLength", n: 2 },
    hint: "Введите здесь",
  },
  {
    id: "phone",
    path: /^\/home\/?$/,
    target: "profile-phone",
    title: "Телефон",
    text: "Номер для связи — по нему же можно будет связать аккаунт с TasksFlow.",
    advance: { kind: "digits", n: 11 },
    hint: "Введите номер",
  },
  {
    id: "sphere",
    path: /^\/home\/?$/,
    target: "profile-sphere",
    title: "Сфера и тип",
    text: "Выберите, чем вы занимаетесь: кафе, столовая, пекарня, магазин… Под сферу сервис сам подберёт нужные журналы.",
    advance: { kind: "next" },
  },
  {
    id: "locations",
    path: /^\/home\/?$/,
    target: "profile-locations",
    title: "Сколько у вас точек",
    text: "Точка — отдельный адрес со своими журналами. Если адрес один — оставьте 1.",
    advance: { kind: "next" },
  },
  {
    id: "inn",
    path: /^\/home\/?$/,
    target: "profile-inn",
    title: "ИНН — по желанию",
    text: "Введите ИНН, и название, адрес и руководителя подставим из ЕГРЮЛ сами. Можно пропустить и заполнить позже.",
    advance: { kind: "next" },
  },
  {
    id: "password",
    path: /^\/home\/?$/,
    target: "profile-password",
    title: "Ваше имя и пароль",
    text: "Пароль уже придуман — запишите его или введите свой, от 6 знаков. Его же пришлём на почту.",
    advance: { kind: "next" },
  },
  {
    id: "done",
    path: /^\/home\/?$/,
    target: "profile-done",
    title: "Нажмите «Готово»",
    text: "Данные сохранятся, и кабинет готов к работе.",
    advance: { kind: "gone" },
    hint: "Нажмите сюда",
  },
  {
    id: "naming",
    path: /^\/home\/?$/,
    target: "profile-naming",
    title: "Назовите точки",
    text: "У вас несколько точек — дайте каждой название и адрес, они печатаются в шапке журналов. Можно нажать «Позже».",
    advance: { kind: "gone" },
  },
  {
    id: "setup",
    path: /^\/home\/?$/,
    target: "home-setup",
    title: "Регистрация закончена!",
    text: "Дальше — «Начальная настройка»: сотрудники, оборудование и журналы по шагам. Нажмите сюда, мастер проведёт сам.",
    advance: { kind: "click" },
    hint: "Нажмите сюда",
  },
];

export const LIVE_GUIDES = { register: REGISTER_GUIDE } as const;
export type LiveGuideId = keyof typeof LIVE_GUIDES;

export const LIVE_GUIDE_STORAGE_KEY = "wesetup.live-guide";
export const LIVE_GUIDE_EVENT = "wesetup:live-guide";
/** Брошенный гид не всплывает через час на другой странице. */
export const LIVE_GUIDE_TTL_MS = 60 * 60 * 1000;

export type LiveGuideState = { id: LiveGuideId; step: number; startedAt: number };

export function parseGuideState(raw: string | null, now = Date.now()): LiveGuideState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LiveGuideState>;
    if (!value || typeof value.id !== "string" || !(value.id in LIVE_GUIDES)) return null;
    if (typeof value.step !== "number" || typeof value.startedAt !== "number") return null;
    if (now - value.startedAt > LIVE_GUIDE_TTL_MS) return null;
    const steps = LIVE_GUIDES[value.id as LiveGuideId];
    if (value.step < 0 || value.step >= steps.length) return null;
    return { id: value.id as LiveGuideId, step: value.step, startedAt: value.startedAt };
  } catch {
    return null;
  }
}

/** Выполнено ли условие шага по значению цели (поле или галочка). */
export function fieldConditionMet(advance: GuideAdvance, value: string, checked: boolean): boolean {
  switch (advance.kind) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
    case "checked":
      return checked;
    case "minLength":
      return value.trim().length >= advance.n;
    case "digits":
      return value.replace(/\D/g, "").length >= advance.n;
    default:
      return false;
  }
}

/**
 * Шаг для текущей страницы: если текущий шаг не про эту страницу —
 * первый следующий, который про неё (человек прошёл часть сам).
 * `null` — на этой странице гиду показывать нечего.
 */
export function stepForPath(steps: GuideStep[], current: number, pathname: string): number | null {
  if (steps[current]?.path.test(pathname)) return current;
  for (let i = current + 1; i < steps.length; i += 1) if (steps[i].path.test(pathname)) return i;
  return null;
}
