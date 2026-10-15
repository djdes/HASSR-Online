export const CHANGE_TYPES = ["recipe", "process", "packaging", "supplier", "equipment"] as const;
export const CHANGE_STATUSES = ["requested", "risk_review", "testing", "approved", "rejected", "implemented"] as const;

export function changeErrorKey(error: unknown, status?: number) {
  if (error === "Не авторизован" || status === 401) return "unauthorized";
  if (error === "Заголовок обязателен") return "titleRequired";
  return "saveFailed";
}

export function readChangeFormData(form: Pick<FormData, "get">, changeType: string) {
  return {
    title: form.get("title"), changeType,
    description: form.get("description") || null,
    riskAssessment: form.get("riskAssessment") || null,
  };
}
