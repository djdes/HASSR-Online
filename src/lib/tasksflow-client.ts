/**
 * Thin REST client for tasksflow.ru API.
 *
 * Auth: `Authorization: Bearer tfk_…`. Keys are per-company in TasksFlow,
 * created at /api/api-keys. We store the plaintext encrypted in our
 * `TasksFlowIntegration.apiKeyEncrypted` and pass it on every call.
 *
 * The client is **stateless** — instantiate per request via
 * `tasksflowClientFor(integration)`. Don't share instances across orgs.
 *
 * Response shapes here are typed against TasksFlow API.md (commit at the
 * time of writing). If TasksFlow changes its contract, only this file
 * needs an update.
 */
import { decryptSecret } from "@/lib/integration-crypto";

export type TasksFlowUser = {
  id: number;
  phone: string;
  name: string | null;
  isAdmin: boolean;
  bonusBalance: number;
  createdAt: number;
  companyId?: number | null;
};

export type TasksFlowTask = {
  id: number;
  title: string;
  workerId: number | null;
  requiresPhoto: boolean;
  photoUrl?: string | null;
  photoUrls?: string[] | null;
  examplePhotoUrl?: string | null;
  isCompleted: boolean;
  isRecurring: boolean;
  weekDays?: number[] | null;
  monthDay?: number | null;
  price: number;
  category?: string | null;
  description?: string | null;
  companyId?: number | null;
};

export type CreateTaskInput = {
  title: string;
  workerId: number;
  requiresPhoto?: boolean;
  isRecurring?: boolean;
  weekDays?: number[];
  monthDay?: number | null;
  price?: number;
  category?: string;
  description?: string;
  /**
   * Phase 1 двухстадийной верификации (TasksFlow). Когда задан — задача
   * после /complete от сотрудника НЕ закрывается, а ждёт approve от
   * verifier'а. Ставим = TF-id «ответственного по журналу» (берётся из
   * journal-responsibles на стороне WeSetup при bulk-assign-today).
   * Если verifier == workerId — не передаём (no self-verify).
   */
  verifierWorkerId?: number | null;
  /**
   * Stringified JSON {kind,baseUrl,integrationId,documentId,rowKey,...}.
   * TF использует как маркер «journal task» — TaskFormFiller open'ится
   * (с pipeline и WeSetup-formfiller'ом) вместо обычного TaskViewDialog.
   * Шейп описан в TasksFlow shared/journal-link.ts. Передаётся в
   * createTask (когда это override-задача с известным rowKey) или
   * updateTask second-step (когда rowKey надо проставить позже).
   */
  journalLink?: string | null;
};

export type CreateUserInput = {
  phone: string;
  name?: string;
  /** Если true — TasksFlow создаст юзера как admin (видит всё в компании).
   * При повторном create на существующего юзера TF auto-promote'нет его
   * в admin (см. handler в TasksFlow server/routes.ts). */
  isAdmin?: boolean;
  /** Должность («Шеф-повар», «Уборщик», ...). TasksFlow хранит её в
   * users.position и показывает в UI (Dashboard секции «ФИО · Должность»
   * + сортировка). При повторном create с другим position обновляется
   * на стороне TF без полной пересинхронизации. */
  position?: string | null;
};

export class TasksFlowError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: unknown,
    message?: string
  ) {
    super(
      message ||
        // Текст доходит до клиента (`err.message` в ответах кабинета): без адреса
        // и с понятным названием сервиса задач (владелец, 2026-11-23).
        `Программный модуль ответил ошибкой ${status}${
          typeof body === "object" && body && "message" in body
            ? `: ${(body as { message: unknown }).message}`
            : ""
        }`
    );
    this.name = "TasksFlowError";
  }
}

type ClientConfig = {
  baseUrl: string;
  apiKey: string;
  /** Per-call timeout. Defaults to 15s. */
  timeoutMs?: number;
};

class TasksFlowClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(cfg: ClientConfig) {
    // Strip trailing slash so we can safely append `/api/...`.
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.apiKey = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    opts?: { idempotencyKey?: string }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          // П-19 spec'а 2026-05-09: Idempotency-Key на каждой мутирующей
          // команде. TasksFlow со временем должен принимать его (Phase 2.1+).
          // Сейчас header игнорируется TF'ом, но мы шлём proactively —
          // когда TF поддержит, retries станут безопасными без изменений
          // в Wesetup.
          ...(opts?.idempotencyKey
            ? { "Idempotency-Key": opts.idempotencyKey }
            : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (res.status === 204) {
        if (!res.ok) {
          throw new TasksFlowError(res.status, url, null);
        }
        return undefined as T;
      }
      const contentType = res.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");
      let parsed: unknown;
      if (isJson) {
        try {
          parsed = await res.json();
        } catch {
          throw new TasksFlowError(
            res.ok ? 502 : res.status,
            url,
            null,
            `Программный модуль прислал повреждённый ответ (код ${res.status})`
          );
        }
      } else {
        parsed = await res.text().catch(() => "");
        if (res.ok) {
          throw new TasksFlowError(
            502,
            url,
            parsed,
            `Программный модуль прислал неожиданный ответ (код ${res.status})`
          );
        }
      }
      if (!res.ok) {
        throw new TasksFlowError(res.status, url, parsed);
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof TasksFlowError) throw err;
      const reason =
        err instanceof Error ? err.message : "unknown network error";
      throw new TasksFlowError(0, url, null, `Network: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Cheap connectivity probe. We hit `/api/users` because there's no
   * dedicated whoami; a 200 with at least one user means the key is
   * valid and scoped to a company. Returns the raw users so the caller
   * can also infer `companyId`.
   */
  ping(): Promise<TasksFlowUser[]> {
    return this.request<TasksFlowUser[]>("GET", "/api/users");
  }

  listUsers(): Promise<TasksFlowUser[]> {
    return this.request<TasksFlowUser[]>("GET", "/api/users");
  }

  createUser(input: CreateUserInput): Promise<TasksFlowUser> {
    return this.request<TasksFlowUser>("POST", "/api/users", input);
  }

  listTasks(): Promise<TasksFlowTask[]> {
    return this.request<TasksFlowTask[]>("GET", "/api/tasks");
  }

  getTask(id: number): Promise<TasksFlowTask> {
    return this.request<TasksFlowTask>("GET", `/api/tasks/${id}`);
  }

  createTask(
    input: CreateTaskInput,
    opts?: { idempotencyKey?: string },
  ): Promise<TasksFlowTask> {
    return this.request<TasksFlowTask>("POST", "/api/tasks", input, opts);
  }

  /**
   * Phase E.UI: пушим в TF факт reject ячейки/документа со стороны
   * WeSetup-verifier'а. На стороне TF в storage пишутся
   * verification_status='rejected' + reject_reason; задача снова
   * становится active (isCompleted=false), и worker видит на ней
   * красный баннер «Возвращено: …».
   */
  markReturned(taskId: number, reason: string): Promise<TasksFlowTask> {
    return this.request<TasksFlowTask>(
      "POST",
      `/api/tasks/${taskId}/mark-returned`,
      { reason },
    );
  }

  updateTask(
    id: number,
    patch: Partial<CreateTaskInput>,
    opts?: { idempotencyKey?: string },
  ): Promise<TasksFlowTask> {
    return this.request<TasksFlowTask>("PUT", `/api/tasks/${id}`, patch, opts);
  }

  deleteTask(id: number, opts?: { idempotencyKey?: string }): Promise<void> {
    return this.request<void>("DELETE", `/api/tasks/${id}`, undefined, opts);
  }

  completeTask(
    id: number,
    opts?: { idempotencyKey?: string },
  ): Promise<TasksFlowTask> {
    return this.request<TasksFlowTask>(
      "POST",
      `/api/tasks/${id}/complete`,
      {},
      opts,
    );
  }

  uncompleteTask(
    id: number,
    opts?: { idempotencyKey?: string },
  ): Promise<TasksFlowTask> {
    return this.request<TasksFlowTask>(
      "POST",
      `/api/tasks/${id}/uncomplete`,
      {},
      opts,
    );
  }

  /**
   * Push manager-scope в TasksFlow. После этого вызова на стороне
   * TF user-id `managerTfUserId` видит в /api/tasks и /api/users
   * только задачи/воркеров из `subordinateTfUserIds` + свои.
   *
   * Источник истины — WeSetup ManagerScope. Этот метод не сохраняет
   * иерархию на стороне TF, только отражает её для read-фильтрации.
   */
  setManagedWorkers(
    managerTfUserId: number,
    subordinateTfUserIds: number[]
  ): Promise<{ ok: boolean; count: number }> {
    return this.request("PUT", `/api/admin/users/${managerTfUserId}/managed-workers`, {
      workerIds: subordinateTfUserIds,
    });
  }

  /**
   * Прописывает обратное подключение TasksFlow → WeSetup. Без него
   * TF не может загружать task-form / catalog / complete-with-values
   * (см. resolveWesetupTarget в TF server/routes.ts) — пользователь
   * получает «WeSetup-интеграция не настроена для этой компании».
   *
   * `wesetupApiKey` — это тот же TFK-ключ, который WeSetup хранит у
   * себя. TF использует его обратно как Bearer для запросов к
   * /api/integrations/tasksflow/task-form и т.п.
   */
  setWesetupBridge(args: {
    name?: string;
    email?: string | null;
    wesetupBaseUrl: string;
    wesetupApiKey: string;
  }): Promise<unknown> {
    return this.request("PUT", "/api/companies/me", args);
  }

  /**
   * Phase 2.10 (П-17 спека 2026-05-09): получить audit-events из TasksFlow.
   * Wesetup при рендере объединённого audit-report'а merge'ит эти события
   * с собственным AuditLog'ом по timestamp'у.
   */
  /**
   * Hot-fix endpoint: обнулить отрицательные bonus_balance в текущей
   * компании (артефакты pre-ef3e8ec sibling-claim bug'а).
   */
  resetNegativeBalances(): Promise<{
    reset: number;
    users: Array<{
      id: number;
      phone: string;
      name: string | null;
      wasBalance: number;
    }>;
  }> {
    return this.request("POST", "/api/admin/reset-negative-balances", {});
  }

  getAudit(opts?: {
    /** Unix sec нижняя граница (default: TF берёт now-30d). */
    since?: number;
    /** Конкретные tasks (если знаем что искать). */
    taskIds?: number[];
    /** Default 500, max 5000. */
    limit?: number;
  }): Promise<{
    events: Array<{
      id: number;
      companyId: number | null;
      actorWorkerId: number | null;
      taskId: number | null;
      action: string;
      payload: unknown;
      createdAt: number;
    }>;
    count: number;
  }> {
    const params = new URLSearchParams();
    if (opts?.since !== undefined) params.set("since", String(opts.since));
    if (opts?.taskIds && opts.taskIds.length > 0) {
      params.set("taskIds", opts.taskIds.join(","));
    }
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.request(
      "GET",
      `/api/audit${qs ? `?${qs}` : ""}`,
    );
  }
}

/** Build a client from a stored integration row (decrypts the API key). */
export function tasksflowClientFor(integration: {
  baseUrl: string;
  apiKeyEncrypted: string;
}): TasksFlowClient {
  return new TasksFlowClient({
    baseUrl: integration.baseUrl,
    apiKey: decryptSecret(integration.apiKeyEncrypted),
  });
}

/** Build a client directly from a plaintext key — used during connect. */
export function tasksflowClient(baseUrl: string, apiKey: string): TasksFlowClient {
  return new TasksFlowClient({ baseUrl, apiKey });
}

export type TasksFlowClientType = TasksFlowClient;

/**
 * Normalize a raw phone string to the format TasksFlow stores
 * (`+7XXXXXXXXXX`). Returns null if the number can't be coerced — caller
 * should treat null as "no link possible".
 */
export function normalizeRussianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`;
  }

  // TasksFlow historically accepts both +7XXXXXXXXX and +7XXXXXXXXXX.
  // If the user already typed the leading 7 with only 9 subscriber digits,
  // keep that country code instead of producing a broken +77... number.
  if (digits.length === 10 && digits.startsWith("7")) {
    return `+7${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `+7${digits}`;
  }

  if (digits.length === 9) {
    return `+7${digits}`;
  }

  return null;
}
