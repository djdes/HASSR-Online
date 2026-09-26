/**
 * TasksFlow adapter for «Журнал температуры и влажности»
 * (climate_control).
 *
 * Climate entries pack many sub-values into `entry.data.measurements`:
 *   measurements[roomId][time][temperature|humidity] = number | null
 *
 * One TF task = one measurement run. The worker enters a temperature
 * (and optionally humidity) for every enabled room, tagged with the
 * nearest control-time slot from the document config. Re-completion
 * updates that slot in place so readiness doesn't flip back to «не
 * заполнено».
 *
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = JournalDocumentEntry upsert for today, merging
 *                    the submitted values into `measurements[roomId]
 *                    [nearestControlTime]`.
 *   • form         = dynamic: per-room temp + humidity (if enabled
 *                    in document config), plus a select for which
 *                    control-time slot this run belongs to.
 */
import { db } from "@/lib/db";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  DEFAULT_CLIMATE_CONTROL_TIMES,
  applyRoomDirectoryToClimateConfig,
  normalizeClimateDocumentConfig,
  normalizeClimateEntryData,
  climateCorrectionKey,
  type ClimateDocumentConfig,
  type ClimateEntryData,
  type ClimateMeasurement,
} from "@/lib/climate-document";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import { OFF_NOTE_READING, correctionFromValues, parseOffKeys, type TaskFormField, type TaskFormSchema } from "./task-form";
import { extractEmployeeId as employeeIdFromRowKey, rowKeyForEmployee } from "./row-key";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

/**
 * climate row-keys теперь привязаны к конкретному controlTime — это даёт
 * «несколько задач в день в разное время» (один замер = одна задача,
 * не нужно держать одну гигантскую форму на весь день). Формат:
 *   `employee-<userId>-time-<HH:MM>`
 */
function rowKeyForEmployeeAndTime(empId: string, time: string): string {
  return `${rowKeyForEmployee(empId)}-time-${time}`;
}
function timeFromRowKey(rowKey: string): string | null {
  const m = /-time-(\d{1,2}:\d{2})$/.exec(rowKey);
  return m ? m[1] : null;
}

const TEMPLATE_CODE = CLIMATE_DOCUMENT_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function tempKey(roomId: string) {
  return `t_${roomId}`;
}
function humidityKey(roomId: string) {
  return `h_${roomId}`;
}

function buildForm(
  config: ClimateDocumentConfig,
  employeeName: string | null,
  fixedTime: string | null,
): TaskFormSchema {
  const fields: TaskFormField[] = [];

  // controlTime slot is fixed by the task — adapter row-key carries it.
  // Remains in form as a hidden default so old applyRemoteCompletion
  // logic (which reads `values.controlTime`) keeps working.
  const times = config.controlTimes.length
    ? config.controlTimes
    : [...DEFAULT_CLIMATE_CONTROL_TIMES];
  const time = fixedTime && times.includes(fixedTime) ? fixedTime : times[0];
  fields.push({
    type: "select",
    key: "controlTime",
    label: "Время замера",
    required: true,
    options: [{ value: time, label: time }],
    defaultValue: time,
  });

  for (const room of config.rooms) {
    if (room.temperature.enabled) {
      const { min, max } = room.temperature;
      const rangeSuffix =
        typeof min === "number" && typeof max === "number"
          ? ` · норма ${min}…${max}`
          : "";
      fields.push({
        type: "number",
        key: tempKey(room.id),
        label: `${room.name} — t°${rangeSuffix}`,
        unit: "°C",
        min: -40,
        max: 60,
        step: 0.1,
        required: true,
      });
    }
    if (room.humidity.enabled) {
      const { min, max } = room.humidity;
      const rangeSuffix =
        typeof min === "number" && typeof max === "number"
          ? ` · норма ${min}…${max}`
          : "";
      fields.push({
        type: "number",
        key: humidityKey(room.id),
        label: `${room.name} — влажность${rangeSuffix}`,
        unit: "%",
        min: 0,
        max: 100,
        step: 1,
      });
    }
  }

  return {
    intro:
      (employeeName ? `${employeeName}, ` : "") +
      "снимите показания температуры (и влажности — где включено) по " +
      "каждому помещению и выберите время замера.",
    submitLabel: "Сохранить замер",
    fields,
  };
}

function pickNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Уже записанные сегодня показания этого срока — в поля (см. холодильники). */
async function prefillFromToday(
  form: TaskFormSchema,
  config: ClimateDocumentConfig,
  documentId: string,
  employeeId: string | null,
  slot: string,
  todayKey: string
): Promise<void> {
  const date = new Date(`${todayKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return;
  const entries = await db.journalDocumentEntry.findMany({
    where: { documentId, date },
    select: { employeeId: true, data: true },
  });
  if (entries.length === 0) return;
  const own = entries.find((entry) => entry.employeeId === employeeId) ?? null;
  const ordered = own ? [own, ...entries.filter((entry) => entry !== own)] : entries;
  const datas = ordered.map((entry) => normalizeClimateEntryData(entry.data ?? null));
  let filled = 0;
  const prefilledOff: string[] = [];
  for (const field of form.fields) {
    if (field.type !== "number") continue;
    const room = config.rooms.find((candidate) => tempKey(candidate.id) === field.key || humidityKey(candidate.id) === field.key);
    if (!room) continue;
    const metric = field.key === tempKey(room.id) ? "temperature" : "humidity";
    for (const data of datas) {
      const value = data.measurements[room.id]?.[slot]?.[metric];
      if (typeof value === "number" && Number.isFinite(value)) {
        field.defaultValue = value;
        filled += 1;
        break;
      }
      if (data.corrections?.[climateCorrectionKey(room.id, slot, metric)] === OFF_NOTE_READING) {
        prefilledOff.push(field.key);
        filled += 1;
        break;
      }
    }
  }
  if (prefilledOff.length > 0) form.prefilledOff = prefilledOff;
  if (filled > 0) {
    form.notice = `Сегодня в ${slot} уже записано. Значения подставлены — проверьте и измените, что нужно.`;
  }
}

export const climateAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Температура и влажность",
    description:
      "Замер температуры и влажности по помещениям в назначенное время.",
    iconName: "thermometer",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row) {
    return `Климат · ${row.label}`;
  },

  descriptionForRow(_row, doc) {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "Снимите показания по помещениям на это время.",
    ].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const [docs, employees, directoryRooms] = await Promise.all([
      db.journalDocument.findMany({
        where: {
          organizationId,
          status: "active",
          template: { code: TEMPLATE_CODE },
        },
        select: {
          id: true,
          title: true,
          dateFrom: true,
          dateTo: true,
          config: true,
        },
        orderBy: { dateFrom: "desc" },
      }),
      db.user.findMany({
        where: { organizationId, isActive: true, ...NOT_COMMISSION_WHERE },
        select: { id: true, name: true, role: true, positionTitle: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
      // 2026-09-04: имена/нормы помещений — из справочника Room.
      db.room.findMany({
        where: { building: { organizationId } },
        select: { id: true, name: true, climateNorms: true },
      }),
    ]);
    return docs.map<AdapterDocument>((doc) => {
      const config = applyRoomDirectoryToClimateConfig(
        normalizeClimateDocumentConfig(doc.config),
        directoryRooms,
      );
      const times = config.controlTimes.length
        ? config.controlTimes
        : [...DEFAULT_CLIMATE_CONTROL_TIMES];
      // Один row = (employee × time). Если в конфиге задано 3 controlTime
      // (10:00, 14:00, 17:00), то на каждого сотрудника создастся 3 task'и
      // — каждая закрывается отдельно по факту замера. Это решает проблему
      // «одна задача висит весь день», когда сотрудник не может частично
      // завершить.
      const rows: AdapterRow[] = [];
      for (const emp of employees) {
        for (const time of times) {
          rows.push({
            rowKey: rowKeyForEmployeeAndTime(emp.id, time),
            label: `${emp.name} · ${time}`,
            sublabel: emp.positionTitle ?? undefined,
            responsibleUserId: emp.id,
          });
        }
      }
      return {
        documentId: doc.id,
        documentTitle: doc.title,
        period: { from: toDateKey(doc.dateFrom), to: toDateKey(doc.dateTo) },
        rows,
      };
    });
  },

  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm({ documentId, rowKey, todayKey }) {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { config: true, organizationId: true },
    });
    if (!doc) return null;
    const employee = await findTaskEmployee({
      employeeId: employeeIdFromRowKey(rowKey),
      organizationId: doc.organizationId,
    });
    const directoryRooms = await db.room.findMany({
      where: { building: { organizationId: doc.organizationId } },
      select: { id: true, name: true, climateNorms: true },
    });
    const config = applyRoomDirectoryToClimateConfig(
      normalizeClimateDocumentConfig(doc.config),
      directoryRooms,
    );
    const form = buildForm(config, employee?.name ?? null, timeFromRowKey(rowKey));
    if (todayKey) {
      const slotField = form.fields.find((field) => field.key === "controlTime");
      const slot = slotField && slotField.type === "select" && typeof slotField.defaultValue === "string" ? slotField.defaultValue : null;
      if (slot) await prefillFromToday(form, config, documentId, employeeIdFromRowKey(rowKey), slot, todayKey);
    }
    return form;
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, todayKey, values }) {
    if (!completed) return false;
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return false;
    const dateObj = new Date(`${todayKey}T00:00:00.000Z`);
    if (Number.isNaN(dateObj.getTime())) return false;

    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { config: true, organizationId: true },
    });
    if (!doc) return false;
    const employee = await findTaskEmployee({ employeeId, organizationId: doc.organizationId });
    if (!employee) return false;
    const config = normalizeClimateDocumentConfig(doc.config);

    const times = config.controlTimes.length
      ? config.controlTimes
      : [...DEFAULT_CLIMATE_CONTROL_TIMES];
    // Сначала пытаемся взять controlTime из rowKey (новый формат
    // `employee-X-time-HH:MM`), потом из values (legacy form), потом
    // первый по списку конфига.
    const rowTime = timeFromRowKey(rowKey);
    const requestedTime =
      rowTime && times.includes(rowTime)
        ? rowTime
        : typeof values?.controlTime === "string" && times.includes(values.controlTime)
        ? values.controlTime
        : times[0];

    // Preserve any previous measurements for other control-times /
    // rooms on the same day — overwrite only the requested slot.
    const existing = await db.journalDocumentEntry.findUnique({
      where: {
        documentId_employeeId_date: { documentId, employeeId, date: dateObj },
      },
      select: { data: true },
    });
    const currentData: ClimateEntryData = normalizeClimateEntryData(
      existing?.data ?? null
    );
    const measurements: Record<string, Record<string, ClimateMeasurement>> = {
      ...currentData.measurements,
    };
    // «Нет показания» — прочерк с пометкой; комментарий к отклонению — к тем
    // метрикам, что вне нормы. Прежние пометки записи сохраняем.
    const off = parseOffKeys(values ?? null);
    const correction = correctionFromValues(values ?? null);
    const corrections: Record<string, string> = { ...(currentData.corrections ?? {}) };
    const between = (value: number | null, min: number | null, max: number | null) =>
      typeof value === "number" && ((typeof min === "number" && value < Math.min(min, max ?? min)) || (typeof max === "number" && value > Math.max(max, min ?? max)));

    for (const room of config.rooms) {
      const priorRoom = measurements[room.id] ?? {};
      const priorSlot: ClimateMeasurement =
        priorRoom[requestedTime] ?? { temperature: null, humidity: null };
      const tempOff = off.has(tempKey(room.id));
      const humOff = off.has(humidityKey(room.id));
      const nextTemp = room.temperature.enabled
        ? tempOff ? null : pickNumber(values?.[tempKey(room.id)])
        : priorSlot.temperature;
      const nextHum = room.humidity.enabled
        ? humOff ? null : pickNumber(values?.[humidityKey(room.id)])
        : priorSlot.humidity;
      const tKey = climateCorrectionKey(room.id, requestedTime, "temperature");
      const hKey = climateCorrectionKey(room.id, requestedTime, "humidity");
      if (tempOff) corrections[tKey] = OFF_NOTE_READING;
      else if (corrections[tKey] === OFF_NOTE_READING) delete corrections[tKey];
      if (humOff) corrections[hKey] = OFF_NOTE_READING;
      else if (corrections[hKey] === OFF_NOTE_READING) delete corrections[hKey];
      if (correction && room.temperature.enabled && between(nextTemp, room.temperature.min, room.temperature.max)) corrections[tKey] = correction;
      if (correction && room.humidity.enabled && between(nextHum, room.humidity.min, room.humidity.max)) corrections[hKey] = correction;
      measurements[room.id] = {
        ...priorRoom,
        [requestedTime]: {
          temperature: nextTemp,
          humidity: nextHum,
        },
      };
    }

    const data: ClimateEntryData = {
      responsibleTitle: currentData.responsibleTitle,
      measurements,
      ...(Object.keys(corrections).length > 0 ? { corrections } : {}),
      // Фото замеров с QR-плаката (снимок дисплея) остаются: форма их не присылает.
      ...(currentData.readingPhotos ? { readingPhotos: currentData.readingPhotos } : {}),
    };

    await db.journalDocumentEntry.upsert({
      where: {
        documentId_employeeId_date: { documentId, employeeId, date: dateObj },
      },
      create: { documentId, employeeId, date: dateObj, data },
      update: { data },
    });
    return true;
  },
};
