"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  UserRoundPen,
  X,
} from "lucide-react";
import { NumberStepper } from "@/components/ui/number-stepper";
import { TasksFlowPromoHint } from "@/components/tasksflow/tasksflow-promo-hint";
import {
  MAX_LOCATIONS,
  ORG_OWNERSHIP,
  ORG_SPHERES,
  normalizeSphere,
} from "@/lib/org-profile";
import { innDigits, isValidInn } from "@/lib/inn";
import { suggestPassword } from "@/lib/password-suggest";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import {
  DEFAULT_OWNER_POSITION,
  OWNER_POSITION_CATEGORY,
  positionSuggestionsFor,
} from "@/lib/sphere-positions";

const DISMISS_KEY = "wesetup.complete-profile-dismissed";

/**
 * Что уже известно об организации. Анкета стартует с этих значений, а не
 * с пустых полей: её сабмит перезаписывает организацию целиком, и у
 * человека, пришедшего в уже настроенный кабинет (например, владелец,
 * которому консультант передал готовую организацию), пустая форма
 * стёрла бы название, сферу, ИНН и адрес.
 *
 * Название передаём только настоящее: плейсхолдер `DEFAULT_ORG_NAME`
 * отсеивает вызывающая сторона, иначе анкета предложила бы сохранить
 * «Моя организация» как имя заведения.
 */
export type CompleteProfileInitial = {
  organizationName?: string | null;
  sphere?: string | null;
  ownershipKind?: string | null;
  locationsCount?: number | null;
  inn?: string | null;
  address?: string | null;
  /**
   * Имя человека, если оно уже известно. Без него поле стартует пустым, и
   * подстановка из ЕГРЮЛ переименовывает владельца в руководителя юрлица
   * по реестру — тому, кому консультант передал кабинет, это меняет имя.
   */
  personName?: string | null;
};

/**
 * Напоминание заполнить анкету после мгновенной регистрации.
 *
 * Аккаунт создаётся по одной почте, поэтому данные организации
 * собираются уже внутри кабинета. Баннер закрывается на текущую
 * сессию: возвращается при следующем входе, но не мешает работать
 * прямо сейчас.
 *
 * Сразу после регистрации (`?welcome=1`) модалка открывается сама —
 * это единственный авто-показ, дальше только баннер.
 */
export function CompleteProfileNudge({
  email,
  initial,
}: {
  email: string;
  initial?: CompleteProfileInitial;
}) {
  const searchParams = useSearchParams();
  const welcome = searchParams.get("welcome") === "1";

  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(welcome);

  useEffect(() => {
    if (welcome) return;
    let cancelled = false;
    try {
      if (window.sessionStorage.getItem(DISMISS_KEY)) {
        queueMicrotask(() => {
          if (!cancelled) setHidden(true);
        });
      }
    } catch {
      /* sessionStorage недоступен — просто показываем баннер */
    }
    return () => {
      cancelled = true;
    };
  }, [welcome]);

  function dismiss() {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* не смогли запомнить — скроем только до перезагрузки */
    }
    setHidden(true);
  }

  return (
    <>
      {!hidden ? (
        <div className="flex items-center gap-3 bg-[#5566f6] px-4 py-2.5 text-white md:px-6">
          <Sparkles className="size-4 shrink-0" />
          <p className="hidden min-w-0 flex-1 text-[13px] leading-[1.45] sm:block">
            <span className="font-medium">Завершите регистрацию:</span>{" "}
            <span className="text-white/85">
              название организации и телефон — они идут в шапку журналов и
              PDF для проверок.
            </span>
          </p>
          {/* На узком экране — короче: без «и PDF для проверок», чтобы
              уместиться в одну-две строки и не толкать кнопку с крестиком
              на отдельную строку. */}
          <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-[1.45] sm:hidden">
            <span className="font-medium">Завершите регистрацию:</span>{" "}
            <span className="text-white/85">
              название организации и телефон — они идут в шапку журналов.
            </span>
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-xl bg-white/15 px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-white/25"
          >
            Завершить
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Скрыть до следующего входа"
            className="shrink-0 rounded-lg p-1 text-white/70 transition-colors hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {open ? (
        <CompleteProfileModal
          email={email}
          welcome={welcome}
          initial={initial}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Ответ `/api/public/inn-lookup` в части, которую использует анкета. */
type InnLookup = {
  ok: boolean;
  name: string;
  address?: string;
  sphere?: string | null;
  ownershipKind?: string | null;
  personName?: string;
  personPost?: string;
};

/** Телефон считаем годным, если в нём 11 цифр и он начинается с 7/8. */
function phoneLooksValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 && /^[78]/.test(digits);
}

/**
 * Анкета. Обязательны только название организации и телефон — они
 * наверху, помечены красной точкой. Всё остальное человек дозаполнит в
 * настройках, и держать его на пути к первому журналу незачем.
 *
 * Раскладка рассчитана на первый экран телефона без прокрутки: поля
 * стоят парами по смыслу («Сфера · Тип», «Точек · ИНН», «Имя · Пароль»),
 * галочка сотрудника и должность — в одной строке, промо TasksFlow —
 * под телефоном, кнопки футера — в один ряд.
 *
 * ИНН — ключ к ЕГРЮЛ: как только введены 10/12 цифр с верной контрольной
 * суммой, анкета сама подставляет название, сферу (по ОКВЭД), тип (по
 * ОПФ) и юридический адрес через `/api/public/inn-lookup`. Своё название
 * или выбранную сферу не перетираем.
 *
 * Пароль подставляется сам (6 знаков, см. `suggestPassword`) и виден
 * открытым текстом: человек либо запоминает его, либо перегенерирует
 * кнопкой, либо печатает свой. При сохранении он же уходит на почту —
 * пароль из письма о регистрации после этого не подходит.
 *
 * Подтверждения почты здесь больше нет: оно блокировало «Готово» до
 * похода в почтовый ящик. Переехало в /settings.
 */
function CompleteProfileModal({
  email,
  welcome,
  initial,
  onClose,
}: {
  email: string;
  welcome: boolean;
  initial?: CompleteProfileInitial;
  onClose: () => void;
}) {
  const router = useRouter();
  // Фон под анкетой не должен прокручиваться (на iOS body.overflow не помогает).
  useBodyScrollLock(true);

  // Стартуем от того, что уже известно об организации: сабмит анкеты
  // перезаписывает её целиком, и пустые поля стёрли бы готовые данные.
  const [organizationName, setOrganizationName] = useState(
    initial?.organizationName ?? "",
  );
  const [phone, setPhone] = useState("");
  // Тип расширяем до string намеренно: сюда же кладут значение из
  // ЕГРЮЛ (`found.sphere`), которое приходит с сервера обычной строкой.
  const [sphere, setSphere] = useState<string>(
    initial?.sphere ? normalizeSphere(initial.sphere) : "restaurant",
  );
  const [ownershipKind, setOwnershipKind] = useState<string>(
    initial?.ownershipKind ?? "private",
  );
  const [locationsCount, setLocationsCount] = useState(
    initial?.locationsCount && initial.locationsCount > 0
      ? initial.locationsCount
      : 1,
  );
  const [inn, setInn] = useState(initial?.inn ?? "");
  const [name, setName] = useState(initial?.personName ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [asEmployee, setAsEmployee] = useState(true);
  const [positionName, setPositionName] = useState(DEFAULT_OWNER_POSITION);

  // Пароль генерируем после монтирования, а не в инициализаторе state:
  // модалка рендерится и на сервере (`?welcome=1`), и случайное значение
  // на сервере и клиенте разошлось бы при гидратации.
  useEffect(() => {
    setNewPassword((current) => current || suggestPassword());
  }, []);

  // Автозаполнение по ИНН. Запрос уходит с задержкой после последней
  // цифры и только для ИНН с верной контрольной суммой. Название
  // подставляем, если поле пустое или в нём наша прошлая подстановка;
  // сферу и тип — пока человек не выбирал их сам.
  const [address, setAddress] = useState(initial?.address ?? "");
  const [innState, setInnState] = useState<"idle" | "loading" | "found" | "missing">("idle");
  const autoNameRef = useRef("");
  const autoPersonRef = useRef("");
  // Уже известные сфера и тип считаются выбранными: их задал человек или
  // консультант, и подстановка из ЕГРЮЛ не должна их перебивать.
  const sphereTouchedRef = useRef(Boolean(initial?.sphere));
  const ownershipTouchedRef = useRef(Boolean(initial?.ownershipKind));
  // Адрес поля ввода не имеет — он заполняется только подстановкой из
  // ЕГРЮЛ. Поэтому известный адрес перетирать нельзя молча: у заведения
  // он обычно фактический, а в реестре лежит юридический.
  const knownAddressRef = useRef(Boolean(initial?.address));
  const positionTouchedRef = useRef(false);
  useEffect(() => {
    const digits = innDigits(inn);
    if (!isValidInn(digits)) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setInnState("loading");
      try {
        const res = await fetch(`/api/public/inn-lookup?inn=${digits}`);
        const data = (await res.json().catch(() => null)) as InnLookup | null;
        if (cancelled) return;
        if (!res.ok || !data?.ok || !data.name) {
          setInnState("missing");
          return;
        }
        const found = data;
        setOrganizationName((current) =>
          current.trim() === "" || current === autoNameRef.current ? found.name : current,
        );
        autoNameRef.current = found.name;
        if (found.sphere && !sphereTouchedRef.current) setSphere(found.sphere);
        if (found.ownershipKind && !ownershipTouchedRef.current) {
          setOwnershipKind(found.ownershipKind);
        }
        if (found.address && !knownAddressRef.current) setAddress(found.address);
        // Руководитель юрлица или сам ИП — почти всегда тот, кто регистрирует
        // организацию. Своё имя не перетираем.
        const person = found.personName ?? "";
        if (person) {
          setName((current) =>
            current.trim() === "" || current === autoPersonRef.current ? person : current,
          );
          autoPersonRef.current = person;
        }
        if (found.personPost && !positionTouchedRef.current) setPositionName(found.personPost);
        setInnState("found");
        toast.success(`Из ЕГРЮЛ: ${found.name}`);
      } catch {
        if (!cancelled) setInnState("missing");
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inn]);

  // Подсказки идут за сферой: у производства и столовой свой «директор».
  const positionOptions = useMemo(
    () =>
      positionSuggestionsFor(
        normalizeSphere(sphere),
        OWNER_POSITION_CATEGORY,
        [],
      ),
    [sphere],
  );

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  // Точки: после «Готово» с двумя и более точками — шаг «Назовите точки».
  const [namingBuildings, setNamingBuildings] = useState<NamingBuilding[] | null>(null);
  const [namingSaving, setNamingSaving] = useState(false);

  const nameOk = organizationName.trim().length >= 2;
  const phoneOk = phoneLooksValid(phone);
  const passwordOk = newPassword.trim().length === 0 || newPassword.trim().length >= 6;
  const busy = saving || demoLoading;
  const canSubmit = nameOk && phoneOk && passwordOk && !busy;

  // Нативные тултипы браузера («Вы пропустили это поле») выключены —
  // они появляются только по клику и выглядят чужеродно. Незаполненное
  // обязательное поле подсвечивается рамкой, «Готово» неактивна.

  /**
   * Сохраняет анкету в свою организацию. Без закрытия модалки и refresh —
   * это делает вызывающий: «Готово» просто закрывает, а «демо» после
   * сохранения ещё создаёт демо-организацию и уводит в неё.
   */
  async function saveProfile(): Promise<{ buildings?: Array<{ id: string; name: string; address: string | null }> } | null> {
    try {
      const res = await fetch("/api/profile/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: organizationName.trim(),
          phone: phone.trim(),
          sphere,
          ownershipKind,
          locationsCount,
          inn: inn.trim(),
          address: address.trim(),
          name: name.trim(),
          newPassword: newPassword.trim(),
          asEmployee,
          positionName: asEmployee ? positionName.trim() : "",
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Не удалось сохранить");
      return (data ?? {}) as { buildings?: Array<{ id: string; name: string; address: string | null }> };
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось сохранить",
      );
      return null;
    }
  }

  async function saveNaming() {
    if (!namingBuildings) return;
    setNamingSaving(true);
    try {
      for (const item of namingBuildings) {
        const name = item.name.trim();
        if (!name || (name === item.initialName && item.address.trim() === item.initialAddress)) continue;
        const res = await fetch(`/api/settings/buildings/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, address: item.address.trim() || null }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Не удалось сохранить «${name}»`);
        }
      }
      toast.success("Точки названы — они уже в шапке и в меню");
      onClose();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setNamingSaving(false);
    }
  }

  const savedMessage = newPassword.trim()
    ? "Готово. Данные сохранены, пароль для входа отправили на почту"
    : "Готово. Данные организации сохранены";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const saved = await saveProfile();
      if (!saved) return;
      toast.success(savedMessage);
      const buildings = saved.buildings ?? [];
      if (buildings.length >= 2) {
        // Имена и адреса сразу: «Точка 1» иначе так и напечатается в PDF.
        setNamingBuildings(
          buildings.map((b) => ({
            id: b.id,
            name: b.name,
            address: b.address ?? "",
            initialName: b.name,
            initialAddress: b.address ?? "",
          })),
        );
        router.refresh();
        return;
      }
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  /**
   * Анкета сохраняется в СВОЮ организацию до создания демо — иначе
   * `/api/profile/complete` (пишет в активную org) переименовал бы демо,
   * а анкета всплыла бы внутри песочницы ещё раз.
   */
  async function submitWithDemo() {
    if (!canSubmit) return;
    setDemoLoading(true);
    try {
      if (!(await saveProfile())) return;
      const res = await fetch("/api/organizations/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sphere }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Не удалось создать демо");
      }
      toast.success("Демо-организация готова");
      onClose();
      router.push("/dashboard?welcome-demo=1");
      router.refresh();
    } catch (err) {
      // Анкета уже сохранена — закрываем модалку, человек остаётся у себя.
      toast.error(
        err instanceof Error ? err.message : "Не удалось создать демо",
      );
      onClose();
      router.refresh();
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    // `data-touch-compact`: анкета сверстана под один экран телефона
    // (поля с подписью в рамке уже ≥ 56px, шрифт 16px), общие правила
    // «крупнее на телефоне» её растягивали и сжимали счётчик «Точек» в ноль.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0b1024]/45 p-3 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="complete-profile-title"
      data-touch-compact=""
    >
      {/* dvh, а не vh: на iPhone Safari vh считается без учёта панелей
          браузера, и низ модалки уезжал под нижнюю панель. */}
      <div className="flex max-h-[94dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-3xl bg-white shadow-[0_40px_100px_-40px_rgba(11,16,36,0.6)]">
        <div className="flex shrink-0 items-start gap-3 px-4 pb-1 pt-3.5 sm:px-5 sm:pt-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <UserRoundPen className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="complete-profile-title"
              className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]"
            >
              {namingBuildings
                ? "Назовите точки"
                : welcome
                  ? "Аккаунт создан!"
                  : "Завершите регистрацию"}
            </h2>
            <p className="mt-0.5 text-[12px] leading-snug text-[#6f7282]">
              {namingBuildings ? (
                "Названия и адреса печатаются в шапке журналов и PDF"
              ) : (
                <>
                  Логин: <span className="text-[#3c4053]">{email}</span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="shrink-0 rounded-lg p-1 text-[#9b9fb3] transition-colors hover:text-[#0b1024]"
          >
            <X className="size-5" />
          </button>
        </div>

        {namingBuildings ? (
          <LocationNamingStep
            items={namingBuildings}
            saving={namingSaving}
            onChange={setNamingBuildings}
            onSkip={() => {
              onClose();
              router.refresh();
            }}
            onSave={() => void saveNaming()}
          />
        ) : (
          <>
        <form
          id="complete-profile-form"
          noValidate
          onSubmit={submit}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 sm:space-y-3 sm:p-5"
        >
          <Field
            label="Название организации"
            required
            error={touched.org && !nameOk ? "Минимум 2 символа" : null}
          >
            <input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, org: true }))}
              aria-required
              placeholder="ООО «Ромашка»"
              maxLength={200}
              className={CONTROL_CLASS}
            />
          </Field>

          {/* Телефон занимает ровно свою ширину — в российском номере
              11 цифр, растягивать поле на всю строку незачем. Рядом (на
              телефоне — строкой под ним) узкое промо TasksFlow: место, где
              человек вводит номер, — единственное, где реклама автосвязки
              уместна, потому что связывает аккаунты именно номер.

              Промо вынесено из <Field>: внутри <label> ссылка и кнопка
              «скопировать» перехватывались бы фокусом инпута. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Field
              label="Телефон"
              required
              className="sm:w-[188px] sm:shrink-0"
              invalid={touched.phone && !phoneOk}
            >
              <input
                {...phoneInputProps(phone, setPhone, {
                  onBlur: () => setTouched((t) => ({ ...t, phone: true })),
                })}
                aria-required
                placeholder={RU_PHONE_PLACEHOLDER}
                maxLength={40}
                className={CONTROL_CLASS}
              />
            </Field>

            <TasksFlowPromoHint
              campaign="register_nudge"
              compact
              className="min-w-0 flex-1"
            />
          </div>

          {/* Тот, кто завёл организацию, — тоже сотрудник, и без должности
              он висит в команде безымянной строкой. Галочка и должность в
              одной строке: по умолчанию «да», «Директор» — верно для
              большинства, а снять галочку дешевле, чем искать экран. */}
          <div className="flex items-stretch gap-2">
            <label
              title="Появитесь в списке команды с должностью и сможете подтверждать заполненные журналы"
              className={`flex cursor-pointer items-center gap-2 rounded-2xl border px-3 transition-colors ${
                asEmployee
                  ? "shrink-0 border-[#5566f6]/40 bg-[#f5f6ff]"
                  : "min-w-0 flex-1 border-[#dcdfed] bg-white py-3"
              }`}
            >
              <input
                type="checkbox"
                checked={asEmployee}
                onChange={(e) => setAsEmployee(e.target.checked)}
                className="size-4 shrink-0 cursor-pointer accent-[#5566f6]"
              />
              <span className="whitespace-nowrap text-[14px] font-medium text-[#0b1024]">
                Я сотрудник
              </span>
              {!asEmployee ? (
                <span className="truncate text-[12px] text-[#6f7282]">
                  без должности в команде
                </span>
              ) : null}
            </label>

            {asEmployee ? (
              <Field label="Должность" className="min-w-0 flex-1">
                <input
                  value={positionName}
                  onChange={(e) => {
                    positionTouchedRef.current = true;
                    setPositionName(e.target.value);
                  }}
                  list="owner-position-suggestions"
                  maxLength={120}
                  placeholder={DEFAULT_OWNER_POSITION}
                  className={CONTROL_CLASS}
                />
                <datalist id="owner-position-suggestions">
                  {positionOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </Field>
            ) : null}
          </div>

          {/* Остальное необязательно и стоит парами по смыслу, чтобы анкета
              помещалась в первый экран телефона. */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Сфера">
              <SelectShell>
                <select
                  value={sphere}
                  onChange={(e) => {
                    sphereTouchedRef.current = true;
                    setSphere(e.target.value);
                  }}
                  className={SELECT_CLASS}
                >
                  {ORG_SPHERES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </SelectShell>
            </Field>

            <Field label="Тип">
              <SelectShell>
                <select
                  value={ownershipKind}
                  onChange={(e) => {
                    ownershipTouchedRef.current = true;
                    setOwnershipKind(e.target.value);
                  }}
                  className={SELECT_CLASS}
                >
                  {ORG_OWNERSHIP.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </SelectShell>
            </Field>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2">
            <Field label="Точек" plain>
              {/* -my-1: кнопки счётчика 32px, а строка значения в соседних
                  полях 24px — вытягиваем поле до общей высоты, зона нажатия
                  остаётся 32px. */}
              <span className="-my-1 block">
                <NumberStepper
                  value={locationsCount}
                  onChange={setLocationsCount}
                  min={1}
                  max={MAX_LOCATIONS}
                  ariaLabel="Количество точек"
                />
              </span>
            </Field>

            <Field label="ИНН">
              {/* Иконка справа обещает автозаполнение: лупа до ввода, спиннер,
                  галочка или предупреждение после. */}
              <span className="flex items-center gap-1">
                <input
                  value={inn}
                  onChange={(e) => {
                    setInn(e.target.value.replace(/\D/g, ""));
                    setInnState("idle");
                  }}
                  inputMode="numeric"
                  placeholder="7701234567"
                  maxLength={12}
                  className={CONTROL_CLASS}
                />
                {innState === "loading" ? (
                  <Loader2
                    className="size-4 shrink-0 animate-spin text-[#5566f6]"
                    aria-label="Ищем в ЕГРЮЛ"
                  />
                ) : innState === "found" ? (
                  <Check
                    className="size-4 shrink-0 text-[#116b2a]"
                    aria-label="Найдено в ЕГРЮЛ"
                  />
                ) : innState === "missing" ? (
                  <CircleAlert
                    className="size-4 shrink-0 text-[#a13a32]"
                    aria-label="По этому ИНН ничего не нашли"
                  />
                ) : (
                  <span
                    title="Введите ИНН: название, адрес, руководителя и реквизиты подставим из ЕГРЮЛ"
                    className="flex shrink-0 text-[#9b9fb3]"
                  >
                    <Search className="size-4" aria-label="Подставим данные из ЕГРЮЛ по ИНН" />
                  </span>
                )}
              </span>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Ваше имя">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Мария Иванова"
                maxLength={100}
                className={CONTROL_CLASS}
              />
            </Field>

            {/* Пароль виден открытым текстом: его нужно запомнить или
                записать. Кнопка справа подбирает другой; можно и напечатать
                свой — от 6 знаков. */}
            <Field
              label="Пароль для входа"
              error={
                touched.password && !passwordOk ? "Минимум 6 знаков" : null
              }
            >
              <span className="flex items-center gap-1">
                <input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  type="text"
                  autoComplete="new-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={200}
                  className={`${CONTROL_CLASS} font-mono tracking-[0.08em]`}
                />
                <button
                  type="button"
                  onClick={() => setNewPassword(suggestPassword())}
                  aria-label="Подобрать другой пароль"
                  title="Другой пароль"
                  className="-my-0.5 -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-[#5566f6] transition-colors hover:bg-[#eef1ff] hover:text-[#3848c7]"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              </span>
            </Field>
          </div>

          {/* Единственное пояснение: что произойдёт с точками. */}
          {locationsCount > 1 ? (
            <p className="text-[12px] leading-snug text-[#6f7282]">
              Создадим {locationsCount}{" "}
              {locationsCount % 10 >= 2 && locationsCount % 10 <= 4 && (locationsCount % 100 < 12 || locationsCount % 100 > 14)
                ? "точки"
                : "точек"}
              : журналы по каждой отдельно, сотрудники общие. Названия и
              адреса — в настройках.
            </p>
          ) : null}
        </form>

        <div className="shrink-0 border-t border-[#eef0f6] p-4 sm:p-5">
          {/* Демо слева с подписью под своей кнопкой — чтобы «7 дней» не
              читалось как условие для «Готово». «Готово» справа, как
              основное действие. Обе активны по одним условиям: анкета
              сохраняется первой, демо — отдельная организация после. */}
          <div className="grid grid-cols-2 items-start gap-2">
            <div>
              <button
                type="button"
                onClick={submitWithDemo}
                disabled={!canSubmit}
                data-testid="complete-profile-demo"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:border-[#eef0f6] disabled:text-[#9b9fb3] disabled:hover:bg-white"
              >
                {demoLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin text-[#5566f6]" />
                    Готовим…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4 text-[#5566f6]" />
                    Показать демо
                  </>
                )}
              </button>
              <p className="mt-1.5 whitespace-nowrap text-center text-[11px] leading-snug text-[#9b9fb3]">
                Отдельная организация, 7 дней
              </p>
            </div>
            <button
              type="submit"
              form="complete-profile-form"
              disabled={!canSubmit}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-semibold text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c9cef7] disabled:shadow-none"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Готово
            </button>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

type NamingBuilding = {
  id: string;
  name: string;
  address: string;
  initialName: string;
  initialAddress: string;
};

/**
 * Шаг «Назовите точки» после анкеты: строка на точку — название и адрес.
 * Компактно: две колонки, без подписей у полей (плейсхолдеры), «Позже»
 * рядом с «Сохранить» — всё в первом экране телефона при 2–4 точках,
 * дальше список прокручивается внутри окна.
 */
function LocationNamingStep({
  items,
  saving,
  onChange,
  onSkip,
  onSave,
}: {
  items: NamingBuilding[];
  saving: boolean;
  onChange: (next: NamingBuilding[]) => void;
  onSkip: () => void;
  onSave: () => void;
}) {
  const inputClass =
    "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
  return (
    <>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-3 pt-2 sm:px-5">
        {items.map((item, index) => (
          <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2">
            <input
              type="text"
              value={item.name}
              onChange={(e) =>
                onChange(items.map((it, i) => (i === index ? { ...it, name: e.target.value } : it)))
              }
              placeholder={`Точка ${index + 1}`}
              aria-label={`Название точки ${index + 1}`}
              className={inputClass}
            />
            <input
              type="text"
              value={item.address}
              onChange={(e) =>
                onChange(items.map((it, i) => (i === index ? { ...it, address: e.target.value } : it)))
              }
              placeholder="Адрес"
              aria-label={`Адрес точки ${index + 1}`}
              className={inputClass}
            />
          </div>
        ))}
        <p className="text-[12px] leading-snug text-[#6f7282]">
          Сотрудники общие; кому с какой точки приходят задачи — в карточке сотрудника.
        </p>
      </div>
      <div className="shrink-0 border-t border-[#eef0f6] p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Позже
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || items.some((it) => !it.name.trim())}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-semibold text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Сохранить
          </button>
        </div>
      </div>
    </>
  );
}

// text-[16px] во всех полях анкеты: ниже 16px iOS Safari зумит
// страницу при фокусе и обратно масштаб не возвращает.
//
// Контролы — без своей рамки: рамку и фокус-кольцо рисует `Field`
// вокруг подписи и значения. Иначе внутри поля видна вторая
// скруглённая область.
const CONTROL_CLASS =
  "h-6 w-full border-0 bg-transparent p-0 text-[16px] leading-6 text-[#0b1024] placeholder:text-[#c1c5d6] focus:outline-none focus:ring-0";

const SELECT_CLASS = `${CONTROL_CLASS} appearance-none truncate pr-6`;

/** Обёртка нативного select со стрелкой — как в форме настроек. */
function SelectShell({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative block">
      {children}
      <ChevronDown className="pointer-events-none absolute right-0 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
    </span>
  );
}

/**
 * Поле с подписью внутри рамки.
 *
 * Подпись стоит там же, где обычно живёт плейсхолдер, но не исчезает
 * при вводе: заполнив анкету наполовину, человек всё ещё видит, что
 * это за поле. Заодно форма стала на строку короче каждого поля — на
 * ноутбуке она помещалась впритык.
 *
 * Рамка и фокус-кольцо принадлежат этому контейнеру (`focus-within`), а
 * не самому контролу — иначе внутри было бы две рамки.
 */
function Field({
  label,
  required,
  error,
  invalid = false,
  plain = false,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  /** Красная рамка без текста — когда формат и так виден в плейсхолдере. */
  invalid?: boolean;
  /**
   * Обернуть в <div>, а не в <label>. Нужно, когда внутри не один
   * инпут, а группа контролов (счётчик «−/значение/+»): <label>
   * форвардит и :hover, и клик на свой первый контрол, поэтому наводка
   * куда угодно по полю подсвечивала кнопку «−», а клик по подписи её
   * нажимал. Контролы внутри подписаны своим aria-label.
   */
  plain?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const Tag = plain ? "div" : "label";
  return (
    <Tag className={`block ${className}`}>
      <span
        className={`flex flex-col gap-0.5 rounded-2xl border bg-white px-3.5 py-2 transition-[border-color,box-shadow] focus-within:ring-4 ${
          error || invalid
            ? "border-[#ff8d7d] focus-within:border-[#d2453d] focus-within:ring-[#d2453d]/15"
            : "border-[#dcdfed] focus-within:border-[#5566f6] focus-within:ring-[#5566f6]/15"
        }`}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium leading-none text-[#6f7282]">
          {label}
          {required ? (
            <span className="size-1.5 rounded-full bg-[#d2453d]" aria-hidden />
          ) : null}
        </span>
        {children}
      </span>
      {error ? (
        <span className="mt-1 block text-[12px] text-[#d2453d]">{error}</span>
      ) : null}
    </Tag>
  );
}
