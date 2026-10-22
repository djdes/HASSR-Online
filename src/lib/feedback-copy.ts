/** Stable compatibility fields for feedback API errors; user-entered content is never translated. */
export type FeedbackFailure =
  | { key: "messageTooShort"; min: number }
  | { key: "messageTooLong" | "phoneTooLong"; max: number }
  | { key: "typeRequired" | "invalidRequest" | "unreadableRequest" | "invalidAttachments" | "submitError" };

type ValidationIssue = {
  code: string;
  path?: readonly PropertyKey[];
  minimum?: number | bigint;
  maximum?: number | bigint;
};

export function feedbackValidationDescriptor(issue: ValidationIssue | undefined) {
  if (issue?.path?.[0] === "type") return { errorCode: "FEEDBACK_TYPE_REQUIRED" };
  if (issue?.path?.[0] === "message" && issue.code === "too_small") {
    return { errorCode: "FEEDBACK_MESSAGE_TOO_SHORT", errorParams: { min: Number(issue.minimum) } };
  }
  if (issue?.path?.[0] === "message" && issue.code === "too_big") {
    return { errorCode: "FEEDBACK_MESSAGE_TOO_LONG", errorParams: { max: Number(issue.maximum) } };
  }
  if (issue?.path?.[0] === "phone" && issue.code === "too_big") {
    return { errorCode: "FEEDBACK_PHONE_TOO_LONG", errorParams: { max: Number(issue.maximum) } };
  }
  return { errorCode: "FEEDBACK_INVALID_REQUEST" };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function limit(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 100_000;
}

/** Whitelist codes and numeric ICU parameters. Never display raw server diagnostics. */
export function feedbackFailure(value: unknown): FeedbackFailure {
  if (!record(value)) return { key: "submitError" };
  const code = own(value, "errorCode");
  switch (code) {
    case "FEEDBACK_TYPE_REQUIRED": return { key: "typeRequired" };
    case "FEEDBACK_INVALID_REQUEST": return { key: "invalidRequest" };
    case "FEEDBACK_UNREADABLE_REQUEST": return { key: "unreadableRequest" };
    case "FEEDBACK_INVALID_ATTACHMENTS": return { key: "invalidAttachments" };
    case "FEEDBACK_MESSAGE_TOO_SHORT":
    case "FEEDBACK_MESSAGE_TOO_LONG":
    case "FEEDBACK_PHONE_TOO_LONG": {
      const params = own(value, "errorParams");
      if (!record(params)) break;
      if (code === "FEEDBACK_MESSAGE_TOO_SHORT") {
        const min = own(params, "min");
        if (limit(min)) return { key: "messageTooShort", min };
      } else {
        const max = own(params, "max");
        if (limit(max)) return { key: code === "FEEDBACK_MESSAGE_TOO_LONG" ? "messageTooLong" : "phoneTooLong", max };
      }
      break;
    }
  }
  return { key: "submitError" };
}
