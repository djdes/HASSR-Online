"use client";

import type { TourAnchor } from "@/lib/tour-anchors";
import { useSubmitLock } from "@/lib/use-submit-lock";

import { type ReactNode, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  DateField,
  FloatingInputField,
  FloatingLabelField,
} from "@/components/journals/journal-dialog-field";
import {
  JOURNAL_DIALOG_ACTIONS_CLASS,
  JOURNAL_DIALOG_BODY_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_ERROR_CLASS,
  JOURNAL_DIALOG_FIELDS_CLASS,
  JOURNAL_DIALOG_FOOTER_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_SUBMIT_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  getColdEquipmentCreatePeriodBounds,
} from "@/lib/cold-equipment-document";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  getClimateCreatePeriodBounds,
} from "@/lib/climate-document";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  defaultCleaningDocumentConfig,
  getCleaningCreatePeriodBounds,
} from "@/lib/cleaning-document";
import {
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  getFinishedProductCreatePeriodBounds,
} from "@/lib/finished-product-document";
import {
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  getAcceptanceDocumentDefaultConfig,
} from "@/lib/acceptance-document";
import {
  getRegisterDocumentCreatePeriodBounds,
  isRegisterDocumentTemplate,
} from "@/lib/register-document";
import { resolveJournalPeriod, resolveJournalPeriodKind } from "@/lib/journal-period";
import { getUserPositionLabel } from "@/lib/user-roles";
import { useJournalCreateDefaults } from "@/components/journals/journal-create-defaults";
import { isStaffDocumentTemplate } from "@/lib/journal-document-helpers";
import { buildDocumentAutoTitle } from "@/lib/journal-document-title";
import { ControlPeriodicityField } from "@/components/journals/control-periodicity-field";
import { getDefaultControlPeriodicity } from "@/lib/control-periodicity";
import { CreateDocumentEmptyState } from "@/components/journals/create-document-empty-state";
import { PositionEmployeePicker } from "@/components/shared/position-select";
import {
  getTrackedDocumentCreateMode,
  isSourceStyleTrackedTemplate,
} from "@/lib/tracked-document";
import {
  UV_LAMP_RUNTIME_TEMPLATE_CODE,
  buildUvRuntimeDocumentTitle,
  defaultUvSpecification,
} from "@/lib/uv-lamp-runtime-document";
import {
  MED_BOOK_TEMPLATE_CODE,
} from "@/lib/med-book-document";
import {
  PERISHABLE_REJECTION_TEMPLATE_CODE,
  getPerishableRejectionCreatePeriodBounds,
} from "@/lib/perishable-rejection-document";
import {
  PRODUCT_WRITEOFF_DOCUMENT_TITLE,
  PRODUCT_WRITEOFF_TEMPLATE_CODE,
  getProductWriteoffCreatePeriodBounds,
} from "@/lib/product-writeoff-document";
import {
  STAFF_TRAINING_TEMPLATE_CODE,
  getStaffTrainingCreatePeriodBounds,
} from "@/lib/staff-training-document";
import {
  FRYER_OIL_TEMPLATE_CODE,
  defaultFryerOilDocumentConfig,
} from "@/lib/fryer-oil-document";
import {
  EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
  getMaintenanceCreatePeriodBounds,
} from "@/lib/equipment-maintenance-document";
import {
  EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
  getCalibrationCreatePeriodBounds,
} from "@/lib/equipment-calibration-document";
import {
  SANITARY_DAY_CHECKLIST_TEMPLATE_CODE,
  defaultSdcConfig,
} from "@/lib/sanitary-day-checklist-document";
import {
  EQUIPMENT_CLEANING_TEMPLATE_CODE,
  EQUIPMENT_CLEANING_VARIANT_LABELS,
  getDefaultEquipmentCleaningConfig,
  getEquipmentCleaningCreatePeriodBounds,
  type EquipmentCleaningFieldVariant,
} from "@/lib/equipment-cleaning-document";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/**
 * «Добавлять пустых строк при печати» — тот же набор значений, что в
 * «Настройках журнала» здоровья (`health-documents-client.tsx`).
 */
interface Props {
  templateCode: string;
  templateName: string;
  users: {
    id: string;
    name: string;
    role: string;
    positionTitle?: string | null;
    jobPosition?: { name: string; categoryKey: string } | null;
  }[];
  triggerClassName?: string;
  triggerLabel?: string;
  triggerIcon?: ReactNode;
  /** `data-tour` на кнопке-триггере — анкор спотлайт-тура «Как заполнить?». */
  triggerDataTour?: TourAnchor;
  /**
   * uv_lamp_runtime: следующий свободный номер бактерицидной установки.
   * Считается на списке документов журнала — диалог сам список не видит.
   */
  nextLampNumber?: string;
  /**
   * Ответственный, который стоит в диалоге сразу после открытия. Если не
   * передан — берётся из контекста страницы журнала (основной ответственный
   * из «Ответственные за журналы»). Подставляется только туда, где выбор
   * ответственного виден: запрос всегда содержит ровно то, что человек
   * видел в окне.
   */
  defaultResponsibleUserId?: string | null;
}

/**
 * Период по умолчанию для журналов без собственной ветки ниже.
 *
 * ПОЧЕМУ: раньше сюда падал полумесячный период гигиены, и годовые
 * журналы (аварии, жалобы, СИЗ, дезинсекция, перечень стекла…) открывались
 * на «1–15 сентября», хотя и автоназвание (`buildDocumentAutoTitle`), и
 * ночное автосоздание считают их годовыми. Документ назывался «2026 год»,
 * а жил две недели. Теперь источник периода один — `journal-period.ts`.
 */
function resolveCreatePeriodBounds(templateCode: string) {
  const period = resolveJournalPeriod(templateCode);
  return {
    dateFrom: period.dateFrom.toISOString().slice(0, 10),
    dateTo: period.dateTo.toISOString().slice(0, 10),
  };
}

/**
 * Показывает ли диалог каскад «Должность → Сотрудник». Журналы, у которых
 * ответственный задаётся не при создании (медкнижки, списания, обучение,
 * ТО/поверка, уборка, уборка оборудования), каскад не показывают.
 */
function showResponsiblePickerFor(templateCode: string): boolean {
  return ![
    MED_BOOK_TEMPLATE_CODE,
    PRODUCT_WRITEOFF_TEMPLATE_CODE,
    STAFF_TRAINING_TEMPLATE_CODE,
    EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
    EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
    CLEANING_DOCUMENT_TEMPLATE_CODE,
    EQUIPMENT_CLEANING_TEMPLATE_CODE,
  ].includes(templateCode);
}

export function CreateDocumentDialog({
  templateCode,
  templateName,
  users,
  triggerClassName,
  triggerLabel = "Создать документ",
  triggerIcon,
  triggerDataTour,
  nextLampNumber = "1",
  defaultResponsibleUserId: defaultResponsibleUserIdProp,
}: Props) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  // Двойной тап по кнопке успевал отправить два одинаковых запроса:
  // setState применяется только к следующему рендеру. Замок синхронный.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState("");
  /** Найденный сервером документ на тот же период (ответ 409). */
  const [duplicate, setDuplicate] = useState<{ id: string; title: string } | null>(null);

  const defaultPeriod = useMemo(
    () =>
      templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
        ? getColdEquipmentCreatePeriodBounds()
        : templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE
          ? getClimateCreatePeriodBounds()
          : templateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
            ? getCleaningCreatePeriodBounds()
            : templateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE
              ? getFinishedProductCreatePeriodBounds()
              : templateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE
                ? getMaintenanceCreatePeriodBounds()
              : templateCode === EQUIPMENT_CALIBRATION_TEMPLATE_CODE
                ? getCalibrationCreatePeriodBounds()
              : templateCode === STAFF_TRAINING_TEMPLATE_CODE
                ? getStaffTrainingCreatePeriodBounds()
              : templateCode === PERISHABLE_REJECTION_TEMPLATE_CODE
                ? getPerishableRejectionCreatePeriodBounds()
                : templateCode === EQUIPMENT_CLEANING_TEMPLATE_CODE
                  ? getEquipmentCleaningCreatePeriodBounds()
                : templateCode === PRODUCT_WRITEOFF_TEMPLATE_CODE
                  ? getProductWriteoffCreatePeriodBounds()
                : isRegisterDocumentTemplate(templateCode)
                ? getRegisterDocumentCreatePeriodBounds()
                : resolveCreatePeriodBounds(templateCode),
    [templateCode]
  );

  const isStaffJournal = isStaffDocumentTemplate(templateCode);
  const isCleaningJournal = templateCode === CLEANING_DOCUMENT_TEMPLATE_CODE;
  const isClimateJournal = templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE;
  const isColdEquipmentJournal = templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE;
  const isSourceStyleTrackedJournal = isSourceStyleTrackedTemplate(templateCode);
  const isAcceptanceJournal = templateCode === ACCEPTANCE_DOCUMENT_TEMPLATE_CODE;
  const isUvRuntimeJournal = templateCode === UV_LAMP_RUNTIME_TEMPLATE_CODE;
  const isMedBookJournal = templateCode === MED_BOOK_TEMPLATE_CODE;
  const isPerishableRejectionJournal = templateCode === PERISHABLE_REJECTION_TEMPLATE_CODE;
  const isEquipmentCleaningJournal = templateCode === EQUIPMENT_CLEANING_TEMPLATE_CODE;
  const isProductWriteoffJournal = templateCode === PRODUCT_WRITEOFF_TEMPLATE_CODE;
  const isStaffTrainingJournal = templateCode === STAFF_TRAINING_TEMPLATE_CODE;
  const isEquipmentMaintenanceJournal = templateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE;
  const isEquipmentCalibrationJournal = templateCode === EQUIPMENT_CALIBRATION_TEMPLATE_CODE;
  /**
   * «График и учет генеральных уборок» — ГОДОВОЙ документ (см.
   * `YEARLY_JOURNAL_CODES` в `journal-period.ts`): период всегда
   * 1 января — 31 декабря. Поэтому «Дата окончания» в диалоге не нужна,
   * а должность + ФИО ответственного из каскада уходят в блок
   * «УТВЕРЖДАЮ» бланка (`approveRole` / `approveEmployee`).
   */
  const isGeneralCleaningJournal = templateCode === "general_cleaning";
  const trackedCreateMode = getTrackedDocumentCreateMode(templateCode);
  /**
   * Поле «Название документа» есть ВЕЗДЕ и всегда первое (эталон
   * cleaning-02b): раньше climate_control и cold_equipment_control
   * открывались вообще без него и владелец не понимал, что создаётся.
   */
  const showDateFields = !isColdEquipmentJournal;

  /**
   * Название документа. Собирается из названия журнала и ПЕРИОДА
   * («Гигиенический журнал — 1–15 сентября 2026»), см.
   * `buildDocumentAutoTitle` (годовые журналы → «2026 год»,
   * бессрочные — без периода). Пересчитывается при смене дат, но
   * только пока человек не правил поле руками (`titleTouched`) —
   * правил, значит знает лучше.
   * Поле остаётся обязательным: если человек стёр значение, при сабмите
   * рамка краснеет и под ней появляется «Поле не заполнено».
   */
  const [title, setTitle] = useState(() =>
    buildDocumentAutoTitle({
      templateCode,
      journalName: templateName,
      dateFrom: defaultPeriod.dateFrom,
      dateTo: defaultPeriod.dateTo,
    })
  );
  const [titleTouched, setTitleTouched] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [dateFrom, setDateFrom] = useState(defaultPeriod.dateFrom);
  const [dateTo, setDateTo] = useState(defaultPeriod.dateTo);

  /**
   * Единая точка смены периода: кроме самой даты обновляет автоназвание.
   * Через `useEffect` это делать нельзя — эффект перетирал бы поле после
   * ручной правки на любом ре-рендере.
   */
  function applyPeriod(next: { dateFrom?: string; dateTo?: string }) {
    const nextFrom = next.dateFrom ?? dateFrom;
    const nextTo = next.dateTo ?? dateTo;
    if (next.dateFrom !== undefined) setDateFrom(next.dateFrom);
    if (next.dateTo !== undefined) setDateTo(next.dateTo);
    // Период поменяли — прежняя находка «уже есть документ» устарела.
    setDuplicate(null);
    if (titleTouched) return;
    setTitle(
      buildDocumentAutoTitle({
      templateCode,
        journalName: templateName,
        dateFrom: nextFrom,
        dateTo: nextTo,
      })
    );
    setTitleError("");
  }

  /** Ручная правка названия — с этого момента автоподстановка молчит. */
  function handleTitleChange(value: string) {
    setTitle(value);
    setTitleTouched(true);
    if (titleError) setTitleError("");
  }
  /**
   * Ответственный по умолчанию — только тот, кого руководитель сам
   * назначил в «Ответственные за журналы» (и только если он есть в списке
   * сотрудников окна). «Первого попавшегося» не подставляем: раньше сюда
   * падала первая должность из списка (в uv_lamp_runtime это был
   * «Кондитер»), и владелец создавал документ на случайного человека, не
   * заметив подстановки. Никого не назначили — «Выберите должность».
   */
  const createDefaults = useJournalCreateDefaults();
  const defaultResponsibleUser = useMemo(() => {
    if (!showResponsiblePickerFor(templateCode)) return null;
    const id =
      defaultResponsibleUserIdProp !== undefined
        ? defaultResponsibleUserIdProp
        : createDefaults.defaultResponsibleUserId;
    return id ? users.find((user) => user.id === id) ?? null : null;
  }, [createDefaults.defaultResponsibleUserId, defaultResponsibleUserIdProp, templateCode, users]);
  const [responsibleUserId, setResponsibleUserId] = useState(
    () => defaultResponsibleUser?.id ?? ""
  );
  const [responsibleTitle, setResponsibleTitle] = useState(() =>
    defaultResponsibleUser ? getUserPositionLabel(defaultResponsibleUser) : ""
  );
  const [trackedAreaName, setTrackedAreaName] = useState("");
  /**
   * Номер бактерицидной установки — СЛЕДУЮЩИЙ СВОБОДНЫЙ (U7 аудита).
   * Раньше здесь всегда стояла «1», и вторая установка создавалась
   * дублем. `nextLampNumber` считает список документов журнала
   * (`uv-lamp-runtime-documents-client.tsx`), сюда приходит готовым.
   */
  const [trackedLampNumber, setTrackedLampNumber] = useState(nextLampNumber);
  /**
   * «Добавлять пустых строк при печати» убрано из создания документа
   * (решение владельца 2026-08-27): при создании про печать никто не
   * думает, а поле удлиняло окно. Дефолт — 0; настройка осталась там,
   * где она по месту — в «Настройках журнала» и в диалоге печати.
   * Сервер и печать поле по-прежнему понимают, старые документы целы.
   */
  const PRINT_EMPTY_ROWS_DEFAULT = 0;
  const [fpFieldNameMode, setFpFieldNameMode] = useState<"dish" | "semi">("dish");
  const [fpInspectorMode, setFpInspectorMode] = useState<"inspector_name" | "commission_signatures">(
    "inspector_name"
  );
  // Переключатели колонок стартуют с общего набора организации (если он
  // задан «Применить ко всем документам»), иначе — как раньше.
  const columnDefaultsForCreate = createDefaults.columnDefaults ?? {};
  const startsVisible = (code: string, key: string, fallback: boolean) => {
    const common = columnDefaultsForCreate[code];
    return common ? !common.hidden.includes(key) : fallback;
  };
  const [fpShowProductTemp, setFpShowProductTemp] = useState(() => startsVisible("finished_product", "temp", false));
  const [fpShowCorrectiveAction, setFpShowCorrectiveAction] = useState(() =>
    startsVisible("finished_product", "corrective", false)
  );
  const [fpShowOxygenLevel, setFpShowOxygenLevel] = useState(() => startsVisible("finished_product", "oxygen", false));
  const [fpShowCourierTime, setFpShowCourierTime] = useState(() => startsVisible("finished_product", "courier", false));
  const [fpShowFooterNote, setFpShowFooterNote] = useState(false);
  const [fpFooterNote, setFpFooterNote] = useState("");
  const [medBookIncludeVaccinations, setMedBookIncludeVaccinations] = useState(true);
  const [productWriteoffActNumber, setProductWriteoffActNumber] = useState("1");
  const [productWriteoffComment, setProductWriteoffComment] = useState("");
  const [equipmentCleaningVariant, setEquipmentCleaningVariant] =
    useState<EquipmentCleaningFieldVariant>("rinse_temperature");
  const [cleaningVentilation] = useState(true);
  /** Бракераж скоропортящейся: колонка «Примечание» в составе таблицы (P2). */
  const [perishableShowNote, setPerishableShowNote] = useState(() =>
    startsVisible("perishable_rejection", "note", true)
  );
  /** Приёмка продукции: опциональная колонка «Соответствие внешнего вида
   *  упаковки, маркировки требованиям НД» (I1 аудита). */
  const [acceptanceShowPackaging, setAcceptanceShowPackaging] = useState(false);
  // «Периодичность контроля» — редактируемая с самого создания (эталон
  // печатает её в шапке документа). Дефолт берём из реестра по коду журнала.
  const [controlPeriodicity, setControlPeriodicity] = useState(() =>
    getDefaultControlPeriodicity(templateCode)
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Название обязательно везде, где поле показано (у uv_lamp_runtime
    // заголовок собирается из номера установки и участка).
    if (!isUvRuntimeJournal && !title.trim()) {
      setTitleError("Поле не заполнено");
      setError("");
      return;
    }
    setTitleError("");
    await createDocument(false);
  }

  /**
   * `force` — «всё равно создать» после того, как сервер ответил 409
   * «за этот период уже есть документ». Без этого второй бланк на период
   * нельзя было завести вообще: сервер отказывал, а кнопки подтверждения
   * в окне не было, и человек упирался в красную строку.
   */
  async function createDocument(force: boolean) {
    if (!acquire()) return;
    setError("");
    setDuplicate(null);

    try {
      // Уходит ровно выбранный человек. Если выбрали только должность —
      // сервер сам возьмёт сотрудника этой должности (с проверкой, что он из
      // организации); «первого по роли» здесь больше не подставляем.
      const selectedResponsibleUser = showResponsiblePicker ? responsibleUserId : "";

      const res = await fetch("/api/journal-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateCode,
          force,
          title: isUvRuntimeJournal
            ? buildUvRuntimeDocumentTitle({
                lampNumber: trackedLampNumber.trim() || "1",
                areaName: trackedAreaName.trim(),
                spec: defaultUvSpecification(),
              })
            : title.trim(),
          dateFrom,
          dateTo,
          responsibleUserId: selectedResponsibleUser || undefined,
          responsibleTitle: responsibleTitle || undefined,
          controlPeriodicity,
          config: isStaffJournal
            ? { printEmptyRows: PRINT_EMPTY_ROWS_DEFAULT }
            : isPerishableRejectionJournal
            ? { showNote: perishableShowNote }
            : isCleaningJournal
            ? {
                ...defaultCleaningDocumentConfig(users),
                ventilationEnabled: cleaningVentilation,
              }
            : isEquipmentCleaningJournal
            ? {
                ...getDefaultEquipmentCleaningConfig(),
                fieldVariant: equipmentCleaningVariant,
              }
            : isEquipmentMaintenanceJournal
            ? { year: Number(dateFrom.slice(0, 4)), documentDate: dateFrom }
            : isEquipmentCalibrationJournal
            ? { year: Number(dateFrom.slice(0, 4)), documentDate: dateFrom, rows: [], approveRole: responsibleTitle || "Управляющий", approveEmployee: "" }
            : isGeneralCleaningJournal
            ? {
                year: Number(dateFrom.slice(0, 4)),
                documentDate: dateFrom,
                approveRole: responsibleTitle || "Управляющий",
                approveEmployeeId: selectedResponsibleUser || null,
                approveEmployee:
                  users.find((user) => user.id === selectedResponsibleUser)?.name || "",
                responsibleRole: responsibleTitle || "Управляющий",
                responsibleEmployeeId: selectedResponsibleUser || null,
                responsibleEmployee:
                  users.find((user) => user.id === selectedResponsibleUser)?.name || "",
              }
            : isStaffTrainingJournal
            ? { showSignatureField: medBookIncludeVaccinations }
            : isMedBookJournal
            ? {
                includeVaccinations: medBookIncludeVaccinations,
              }
            : isAcceptanceJournal
              ? {
                  ...getAcceptanceDocumentDefaultConfig(users),
                  showPackagingCompliance: acceptanceShowPackaging,
                  defaultResponsibleTitle: responsibleTitle || null,
                  defaultResponsibleUserId: selectedResponsibleUser || null,
                }
              : templateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE
              ? {
                  fieldNameMode: fpFieldNameMode,
                  inspectorMode: fpInspectorMode,
                  showProductTemp: fpShowProductTemp,
                  showCorrectiveAction: fpShowCorrectiveAction,
                  showOxygenLevel: fpShowOxygenLevel,
                  showCourierTime: fpShowCourierTime,
                  // Решение «выпускать / не выпускать» должно быть видно в таблице и в печати.
                  showReleaseAllowed: true,
                  footerNote: fpShowFooterNote ? fpFooterNote.trim() : "",
                }
            : templateCode === FRYER_OIL_TEMPLATE_CODE
              ? defaultFryerOilDocumentConfig()
              : templateCode === PRODUCT_WRITEOFF_TEMPLATE_CODE
              ? {
                  documentName: title.trim() || PRODUCT_WRITEOFF_DOCUMENT_TITLE,
                  actNumber: productWriteoffActNumber || "1",
                  documentDate: dateFrom,
                  comment: productWriteoffComment,
                }
              : templateCode === SANITARY_DAY_CHECKLIST_TEMPLATE_CODE
              ? defaultSdcConfig()
              : isSourceStyleTrackedJournal && (trackedAreaName.trim() || isUvRuntimeJournal)
                ? isUvRuntimeJournal
                  ? {
                      lampNumber: trackedLampNumber.trim() || "1",
                      areaName: trackedAreaName.trim(),
                      spec: {
                        ...defaultUvSpecification(),
                        // U4: дата ввода установки в эксплуатацию по
                        // умолчанию = дата начала документа (эталон).
                        commissioningDate: dateFrom,
                      },
                    }
                  : { areaName: trackedAreaName.trim() }
                : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // 409 — «на этот период уже есть документ». Это не ошибка ввода,
        // а развилка: открыть существующий или завести второй осознанно.
        if (res.status === 409 && data?.existing?.id) {
          setDuplicate({ id: String(data.existing.id), title: String(data.existing.title || "") });
          setError("");
          return;
        }
        throw new Error(data?.error || "Ошибка создания");
      }

      const { document: doc } = await res.json();
      setOpen(false);
      router.push(`/journals/${templateCode}/documents/${doc.id}`);
      router.refresh();
    } catch (err) {
      setError(humanizeFetchError(err, "Ошибка"));
    } finally {
      release();
    }
  }

  /**
   * Компактный (source-style) набор полей. Раньше флаг заодно менял
   * ширину/паддинги/кегль заголовка — теперь геометрия у всех диалогов
   * ОДНА (JOURNAL_DIALOG_* токены), флаг отвечает только за состав полей.
   */
  const isCompactSourceModal =
    isStaffJournal ||
    isSourceStyleTrackedJournal ||
    isMedBookJournal ||
    isPerishableRejectionJournal ||
    isProductWriteoffJournal ||
    isStaffTrainingJournal ||
    isEquipmentMaintenanceJournal ||
    isEquipmentCalibrationJournal ||
    isCleaningJournal ||
    isEquipmentCleaningJournal;
  /**
   * Каскад «Должность → Сотрудник». Журналы, у которых ответственный
   * задаётся не при создании (медкнижки, списания, обучение, ТО/поверка,
   * уборка оборудования), каскад не показывают.
   *
   * perishable_rejection каскад ПОКАЗЫВАЕТ: в карточке списка и в шапке
   * документа есть «Ответственный», а задать его было негде.
   */
  const showResponsiblePicker = showResponsiblePickerFor(templateCode);
  /**
   * Бессрочные журналы (дез. средства, стеклоконтроль, интенсивное
   * охлаждение, чек-лист сан-дня) живут одним документом без конца —
   * `journal-period.ts` даёт им `dateTo = 31.12.2099`. Показывать такую
   * «Дату окончания» нельзя: она читается как опечатка.
   */
  const isPerpetualJournal = resolveJournalPeriodKind(templateCode) === "perpetual";
  const showDateTo =
    !isClimateJournal &&
    !isColdEquipmentJournal &&
    !isGeneralCleaningJournal &&
    !isPerpetualJournal;
  /**
   * Период у «штатных» журналов (гигиена, здоровье, контроль гигиены рук)
   * считается автоматически на 15 дней — поля даты у них нет. Раньше на
   * это место вставлялась серая плашка-объяснялка; на эталоне её нет,
   * и она только удлиняла окно.
   */
  const usesAutoPeriod = isStaffJournal || trackedCreateMode === "staff";
  const showCompactDateFrom =
    !usesAutoPeriod && !isMedBookJournal && !isCleaningJournal;
  // Онбординг-гейт: без сотрудников создавать документ нечему —
  // не будет ни ответственного, ни строк. Показываем инструкцию.
  const hasNoEmployees = users.length === 0;

  /**
   * При открытии возвращаем автоназвание, если поле пустое (человек
   * стёр его и передумал). Название журнала в префиксе оставляем и у
   * кадровых журналов: владелец просит именно «Гигиенический журнал — …».
   */
  function handleOpenChange(next: boolean) {
    if (!next) {
      setDuplicate(null);
      setError("");
    }
    if (next && !title.trim()) {
      setTitleTouched(false);
      setTitle(
        buildDocumentAutoTitle({
      templateCode,
          journalName: templateName,
          dateFrom,
          dateTo,
        })
      );
    }
    setOpen(next);
  }

  const trigger = (
    <DialogTrigger asChild>
      <Button className={cn(triggerClassName)} data-tour={triggerDataTour}>
        {triggerIcon || <Plus className="size-4" />}
        {triggerLabel}
      </Button>
    </DialogTrigger>
  );

  const header = (
    <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
      {/* Заголовок ВСЕГДА короткий: название журнала и так предзаполнено
          в первом поле, а «Создать документ: <длинное имя>» ломалось
          на 2-3 строки. */}
      <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
        Создание документа
      </DialogTitle>
    </DialogHeader>
  );

  if (hasNoEmployees) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {trigger}
        <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
          {header}
          <div className={JOURNAL_DIALOG_BODY_CLASS}>
            <CreateDocumentEmptyState onNavigate={() => setOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  /*
   * Холодильное оборудование: на эталоне подпись селекта полная —
   * «Должность ответственного за снятие показателей» (X5 аудита);
   * у нас хвост был потерян.
   */
  const responsiblePicker = (
    <PositionEmployeePicker
      users={users}
      value={{ positionTitle: responsibleTitle, userId: responsibleUserId }}
      onChange={(next) => {
        setResponsibleTitle(next.positionTitle);
        setResponsibleUserId(next.userId);
      }}
      positionLabel={
        isColdEquipmentJournal
          ? "Должность ответственного за снятие показателей"
          : "Должность ответственного"
      }
      employeeLabel="Ответственный"
      variant="floating"
    />
  );

  /** Тумблер состава документа: подпись + Switch справа, как на эталоне. */
  const fieldToggle = (
    key: string,
    label: string,
    checked: boolean,
    onChange: (value: boolean) => void,
    hint?: string
  ) => (
    <div key={key} className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[14px] leading-[1.35] text-[#0b1024]">{label}</div>
        {hint ? (
          <div className="mt-1 text-[12px] leading-[1.35] text-[#8a8fa3]">{hint}</div>
        ) : null}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5 shrink-0"
        aria-label={label}
      />
    </div>
  );

  const periodicityAndSubmit = (
    <>
      <ControlPeriodicityField
        value={controlPeriodicity}
        onChange={setControlPeriodicity}
      />

    </>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger}
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        {header}

        <form
          id={formId}
          onSubmit={handleSubmit}
          className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}
        >
          {error && <p className={JOURNAL_DIALOG_ERROR_CLASS}>{error}</p>}

          {/* Документ на этот период уже есть. Раньше на этом месте была
              только красная строка «Откройте его или выберите другой
              период» — без ссылки и без возможности всё же завести
              второй бланк. Теперь оба выхода здесь. */}
          {duplicate && (
            <div className="rounded-2xl border border-[#ffd8a8] bg-[#fff8ed] p-4">
              <div className="text-[14px] font-medium text-[#0b1024]">
                За этот период уже есть документ
              </div>
              <div className="mt-1 text-[13px] leading-[1.45] text-[#6f7282]">
                «{duplicate.title}». Записи за одни и те же дни попадут в разные
                бланки, и ни один не будет выглядеть заполненным.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="h-10 rounded-xl bg-[#5566f6] px-4 text-[14px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
                  onClick={() => {
                    setOpen(false);
                    router.push(
                      `/journals/${templateCode}/documents/${duplicate.id}`
                    );
                  }}
                >
                  Открыть существующий
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  className="h-10 rounded-xl border-[#dcdfed] px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                  onClick={() => void createDocument(true)}
                >
                  Всё равно создать
                </Button>
              </div>
            </div>
          )}

          {isCompactSourceModal ? (
            <>
              {trackedCreateMode === "uv" ? (
                <>
                  <FloatingInputField
                    id="uv-lamp-number"
                    label="Бактерицидная установка №"
                    value={trackedLampNumber}
                    onChange={setTrackedLampNumber}
                    required
                  />
                  <FloatingInputField
                    id="tracked-area-name"
                    label="Наименование цеха/участка применения"
                    value={trackedAreaName}
                    onChange={setTrackedAreaName}
                  />
                </>
              ) : (
                <FloatingInputField
                  id="doc-title"
                  label="Название документа"
                  placeholder="Введите название документа"
                  selectOnFocus
                  value={title}
                  onChange={handleTitleChange}
                  error={titleError || undefined}
                />
              )}

              {/* M2: на живом эталоне (med_books-3-create.png) под полем
                  названия стоит ТУМБЛЕР слева и подпись справа, дефолт —
                  включён. Значение уходит в `config.includeVaccinations`
                  и решает, есть ли в документе и в PDF раздел «Прививки». */}
              {isMedBookJournal && (
                <label className="flex items-center gap-3 text-[14px] text-[#3c4053]">
                  <Switch
                    checked={medBookIncludeVaccinations}
                    onCheckedChange={(value) =>
                      setMedBookIncludeVaccinations(value === true)
                    }
                    className="shrink-0"
                    aria-label={'Включить раздел «Прививки»'}
                  />
                  Включить раздел «Прививки»
                </label>
              )}

              {showCompactDateFrom && (
                <DateField
                  id="compact-date-from"
                  /* P8: у генеральных уборок документ — это ОДИН акт на
                     дату, а не период, поэтому лейбл «Дата документа».
                     Правка уже была сделана в ветке на строке ~788, но
                     general_cleaning попадает СЮДА (showCompactDateFrom),
                     и на проде подпись оставалась «Дата начала». */
                  label={isGeneralCleaningJournal ? "Дата документа" : "Дата начала"}
                  value={dateFrom}
                  onChange={(value) =>
                    applyPeriod(
                      isEquipmentCleaningJournal
                        ? { dateFrom: value, dateTo: value }
                        : { dateFrom: value }
                    )
                  }
                />
              )}

              {isPerishableRejectionJournal && (
                <>
                  <DateField
                    id="perishable-date-to"
                    label="Дата окончания"
                    value={dateTo}
                    onChange={(value) => applyPeriod({ dateTo: value })}
                  />
                  <FloatingLabelField label="Добавить поля">
                    <div className="flex flex-col gap-3 pt-2">
                      {fieldToggle(
                        "perishable-note",
                        "«Примечание»",
                        perishableShowNote,
                        setPerishableShowNote
                      )}
                    </div>
                  </FloatingLabelField>
                </>
              )}

              {(isEquipmentMaintenanceJournal || isEquipmentCalibrationJournal) && (
                <FloatingLabelField label="Год" htmlFor="doc-year">
                  <select
                    id="doc-year"
                    value={dateFrom.slice(0, 4)}
                    onChange={(e) =>
                      // ТО и поверки — годовой документ: смена года двигает
                      // обе границы. Раньше `dateTo` оставался в прошлом
                      // году, и период документа получался вывернутым.
                      applyPeriod({
                        dateFrom: `${e.target.value}-01-01`,
                        dateTo: `${e.target.value}-12-31`,
                      })
                    }
                    className="h-7 w-full border-0 bg-transparent p-0 text-[15px] text-[#0b1024] outline-none"
                  >
                    {Array.from({ length: 10 }, (_, i) =>
                      String(new Date().getFullYear() - 3 + i)
                    ).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </FloatingLabelField>
              )}

              {isEquipmentCleaningJournal && (
                <FloatingLabelField label="Колонка контроля">
                  <div className="flex flex-col gap-2 pt-1 text-[14px] text-[#0b1024]">
                    {(
                      Object.keys(
                        EQUIPMENT_CLEANING_VARIANT_LABELS
                      ) as EquipmentCleaningFieldVariant[]
                    ).map((variant) => (
                      <label key={variant} className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          checked={equipmentCleaningVariant === variant}
                          onChange={() => setEquipmentCleaningVariant(variant)}
                          className="size-4 accent-[#5566f6]"
                        />
                        {EQUIPMENT_CLEANING_VARIANT_LABELS[variant]}
                      </label>
                    ))}
                  </div>
                </FloatingLabelField>
              )}

              {isProductWriteoffJournal && (
                <>
                  <FloatingInputField
                    id="product-writeoff-act-number"
                    label="№ акта"
                    value={productWriteoffActNumber}
                    onChange={setProductWriteoffActNumber}
                    required
                  />
                  <FloatingInputField
                    id="product-writeoff-comment"
                    label="Комментарий"
                    value={productWriteoffComment}
                    onChange={setProductWriteoffComment}
                  />
                </>
              )}

              {isStaffTrainingJournal && (
                <label className="flex items-center gap-3 text-[14px] text-[#3c4053]">
                  <Checkbox
                    checked={medBookIncludeVaccinations}
                    onCheckedChange={(checked) =>
                      setMedBookIncludeVaccinations(checked === true)
                    }
                  />
                  Добавить поле «Подпись инструктируемого»
                </label>
              )}

              {showResponsiblePicker && responsiblePicker}

              {isAcceptanceJournal && (
                <FloatingLabelField label="Добавить поля">
                  <div className="flex flex-col gap-3 pt-2">
                    {fieldToggle(
                      "acceptance-packaging",
                      "«Соответствие внешнего вида упаковки, маркировки требованиям НД»",
                      acceptanceShowPackaging,
                      setAcceptanceShowPackaging
                    )}
                  </div>
                </FloatingLabelField>
              )}

              {periodicityAndSubmit}
            </>
          ) : (
            <>
              <FloatingInputField
                id="doc-title-main"
                label="Название документа"
                placeholder="Введите название документа"
                selectOnFocus
                value={title}
                onChange={handleTitleChange}
                error={titleError || undefined}
              />

              {showDateFields && (
                <>
                  <DateField
                    id="doc-from"
                    label={
                      isGeneralCleaningJournal ? "Дата документа" : "Дата начала"
                    }
                    value={dateFrom}
                    onChange={(value) => applyPeriod({ dateFrom: value })}
                  />
                  {showDateTo && (
                    <DateField
                      id="doc-to"
                      label="Дата окончания"
                      value={dateTo}
                      onChange={(value) => applyPeriod({ dateTo: value })}
                    />
                  )}
                </>
              )}

              {!isCleaningJournal && responsiblePicker}

              {isCleaningJournal && (
                <p className="text-[13px] leading-[1.4] text-[#6f7282]">
                  Ответственных за уборку и контроль можно настроить внутри
                  документа.
                </p>
              )}

              {templateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE && (
                <>
                  {/* Раньше обе радиогруппы назывались «Название поля» —
                      различить их было нельзя. */}
                  <FloatingLabelField label="Колонка наименования">
                    <div className="flex flex-col gap-2 pt-1 text-[14px] text-[#0b1024]">
                      <label className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          checked={fpFieldNameMode === "dish"}
                          onChange={() => setFpFieldNameMode("dish")}
                          className="size-4 accent-[#5566f6]"
                        />
                        Наименование блюд (изделий)
                      </label>
                      <label className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          checked={fpFieldNameMode === "semi"}
                          onChange={() => setFpFieldNameMode("semi")}
                          className="size-4 accent-[#5566f6]"
                        />
                        Наименование полуфабриката
                      </label>
                    </div>
                  </FloatingLabelField>

                  {/* Тумблеры вместо чекбоксов (F4) и РАЗДЕЛЁННЫЕ опции
                      «Т ºС внутри продукта» / «Корректирующие действия»
                      (F5): раньше первый чекбокс включал только
                      showProductTemp, а подпись обещала обе колонки, а
                      второй назывался «Примечание», но писал в
                      showCorrectiveAction — колонка примечаний при этом
                      не появлялась вовсе. Теперь каждый тумблер = ровно
                      одна колонка таблицы. */}
                  <FloatingLabelField label="Добавить поля">
                    <div className="flex flex-col gap-3 pt-2">
                      {fieldToggle(
                        "fp-temp",
                        "«Т ºС внутри продукта»",
                        fpShowProductTemp,
                        setFpShowProductTemp
                      )}
                      {fieldToggle(
                        "fp-corrective",
                        "«Корректирующие действия»",
                        fpShowCorrectiveAction,
                        setFpShowCorrectiveAction
                      )}
                      {fieldToggle(
                        "fp-note",
                        "«Примечание»",
                        fpShowFooterNote,
                        setFpShowFooterNote,
                        "Печатается текстом под таблицей"
                      )}
                      {fieldToggle(
                        "fp-oxygen",
                        "«Остаточный уровень кислорода, % об.»",
                        fpShowOxygenLevel,
                        setFpShowOxygenLevel
                      )}
                      {fieldToggle(
                        "fp-courier",
                        "«Время передачи блюд курьеру»",
                        fpShowCourierTime,
                        setFpShowCourierTime
                      )}
                    </div>
                  </FloatingLabelField>

                  <FloatingLabelField label="Кто подписывает">
                    <div className="flex flex-col gap-2 pt-1 text-[14px] text-[#0b1024]">
                      <label className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          checked={fpInspectorMode === "inspector_name"}
                          onChange={() => setFpInspectorMode("inspector_name")}
                          className="size-4 accent-[#5566f6]"
                        />
                        ФИО лица, проводившего бракераж
                      </label>
                      <label className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          checked={fpInspectorMode === "commission_signatures"}
                          onChange={() =>
                            setFpInspectorMode("commission_signatures")
                          }
                          className="size-4 accent-[#5566f6]"
                        />
                        Подписи членов бракеражной комиссии
                      </label>
                    </div>
                  </FloatingLabelField>

                  {fpShowFooterNote && (
                    <FloatingInputField
                      label="Примечание"
                      value={fpFooterNote}
                      onChange={setFpFooterNote}
                      placeholder="Печатается под таблицей"
                    />
                  )}
                </>
              )}

              {periodicityAndSubmit}
            </>
          )}
        </form>
        {/* Футер вне скролл-зоны: тело диалога скроллится (max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh]),
            и кнопка внутри него уезжала за экран на длинных формах.
            Сабмит остаётся через нативный submit — кнопка привязана к
            форме атрибутом form=. */}
        <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
          <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
            <Button
              type="submit"
              form={formId}
              disabled={isSubmitting}
              className={JOURNAL_DIALOG_SUBMIT_CLASS}
            >
              {isSubmitting ? "Создание..." : "Создать"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
