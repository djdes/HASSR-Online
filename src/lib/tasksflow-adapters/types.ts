/**
 * Adapter contract for plugging a WeSetup journal into the TasksFlow
 * integration. One adapter = one journal type. Add a new adapter →
 * register it in `index.ts` → it shows up in:
 *   • GET /api/integrations/tasksflow/journals-catalog
 *   • POST /api/integrations/tasksflow/bind-row
 *   • PATCH /api/journal-documents/[id] auto-sync
 *   • POST /api/integrations/tasksflow/sync-tasks (pull completions)
 *
 * Without doubling-up code per journal.
 *
 * **Mental model:** TasksFlow tasks are recurring (weekly cron-ish).
 * Adapters expose «assignable things» (rows) and translate completion
 * events back to the journal's native cell/entry model.
 */

import type { TasksFlowIntegration } from "@prisma/client";
import type { TaskFormSchema, TaskFormValues } from "./task-form";

/** Recurring schedule for a TasksFlow task. */
export type TaskSchedule = {
  weekDays: number[]; // 0=Sun ... 6=Sat (matches TasksFlow schema.ts)
  monthDay?: number | null;
};

/** A single «thing that can be assigned» surfaced in the picker. */
export type AdapterRow = {
  /** Stable per-document id used as the join key in TaskLink.rowKey. */
  rowKey: string;
  /** Short human label (top line in picker, also task title fallback). */
  label: string;
  /** Optional sublabel (role / role title / date). */
  sublabel?: string;
  /** WeSetup user id of the cleaner / responsible person. Drives the
   *  TasksFlow workerId via the integration's user-link table. */
  responsibleUserId: string | null;
  /** Optional badge (e.g. "СанПиН", "ХАССП") rendered in picker. */
  badge?: string;
  /**
   * Per-row override проверяющего (Phase E verifier). Если задан,
   * bulk-assign использует ИМЕННО этого юзера как verifier для
   * supervisor-task'а вместо document-wide doc.verifierUserId.
   *
   * Используется в cleaning rooms-mode когда разные комнаты должен
   * проверять разный контролёр (например, кухню — шеф, гостевую —
   * заведующая). null/undefined = fallback на document-wide.
   */
  verifierUserId?: string | null;
  /**
   * Если true — TasksFlow задача создаётся с requiresPhoto=true,
   * worker не сможет нажать «Сделал» без фото. Cleaning адаптер
   * выставляет это, если Room.requirePhoto или хоть один scope-step
   * имеет per-step requirePhoto override.
   *
   * Без явного флага = false (сохраняем back-compat для других журналов).
   */
  requiresPhoto?: boolean;
};

/** A journal document grouping rows. */
export type AdapterDocument = {
  documentId: string;
  documentTitle: string;
  period: { from: string; to: string };
  rows: AdapterRow[];
};

/**
 * Static metadata shown in the picker even before any rows load —
 * lets the TasksFlow UI render journal tabs / icons immediately.
 */
export type AdapterMeta = {
  templateCode: string;
  /** Human title shown as the tab label in TasksFlow picker. */
  label: string;
  /** Short description rendered under the tab name. */
  description?: string;
  /** Lucide icon name (lowercase) for the TasksFlow tab. */
  iconName?: string;
};

export type JournalAdapter = {
  meta: AdapterMeta;

  /**
   * Default recurring schedule for a row. Implementations may inspect
   * the row to tune (e.g. skip weekends if document config says so).
   */
  scheduleForRow(row: AdapterRow, doc: AdapterDocument): TaskSchedule;

  /**
   * Build the title shown in TasksFlow for a row's task.
   * Defaults to row.label if not implemented.
   */
  titleForRow?(row: AdapterRow, doc: AdapterDocument): string;

  /**
   * Build a multi-line description rendered in TasksFlow task view.
   * Optional — adapters that don't need it can return undefined.
   */
  descriptionForRow?(
    row: AdapterRow,
    doc: AdapterDocument
  ): string | undefined;

  /**
   * Walk the org's active journal documents of this template and
   * return the assignable rows. Pure read — no mutations.
   */
  listDocumentsForOrg(organizationId: string): Promise<AdapterDocument[]>;

  /**
   * Diff existing TaskLinks against the current document state and
   * decide which TasksFlow tasks to create / update / delete. Called
   * by the PATCH hook after a journal save and by the manual sync.
   * Returns the same `CleaningSyncReport` shape (renamed sync report).
   */
  syncDocument(input: {
    integration: TasksFlowIntegration;
    documentId: string;
  }): Promise<JournalSyncReport>;

  /**
   * Apply a remote completion to the journal's native model. For
   * cleaning this writes a cell in the matrix; for transactional
   * journals (equipment_cleaning, etc.) it could append a new entry.
   *
   * Returns true when the document was actually modified.
   */
  applyRemoteCompletion(input: {
    documentId: string;
    rowKey: string;
    completed: boolean;
    todayKey: string;
    /**
     * Structured form values collected from the employee via
     * TaskFormSchema. Undefined for cleaning's pure tick-mark flow.
     */
    values?: TaskFormValues;
  }): Promise<boolean>;

  /**
   * Optional: when present, TasksFlow renders a form (dropdown, number,
   * text, etc.) on the employee's task screen. Employee fills the form,
   * payload flies back to `applyRemoteCompletion(values)`. When absent,
   * TasksFlow shows a plain «Выполнено» button — cleaning-style.
   *
   * `documentId` and `rowKey` are the exact pair the task was bound to
   * — lets adapters tailor the form per row (e.g. different employee's
   * name in the intro text).
   */
  getTaskForm?(input: {
    documentId: string;
    rowKey: string;
    /** День (YYYY-MM-DD по часовому поясу организации): адаптер может
     *  подставить уже записанные сегодня значения как `defaultValue`. */
    todayKey?: string;
  }): Promise<TaskFormSchema | null>;
};

export type JournalSyncReport = {
  created: number;
  updated: number;
  deleted: number;
  skippedNoLink: string[];
  errors: Array<{ rowKey: string; message: string }>;
};

export const EMPTY_SYNC_REPORT: JournalSyncReport = {
  created: 0,
  updated: 0,
  deleted: 0,
  skippedNoLink: [],
  errors: [],
};
