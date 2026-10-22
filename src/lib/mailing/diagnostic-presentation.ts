/** UI metadata only: one module instance, same object, same realm/process. */
export type MailingDiagnostic =
  | { version: 1; code: "request.kindUnknown"; params: { kind: string } }
  | { version: 1; code: "request.draftOnly"; params: Record<string, never> }
  | { version: 1; code: "request.campaignMissing"; params: Record<string, never> }
  | { version: 1; code: "request.alreadyLaunched"; params: Record<string, never> }
  | { version: 1; code: "request.noChannels"; params: Record<string, never> }
  | { version: 1; code: "request.noRecipients"; params: Record<string, never> }
  | { version: 1; code: "request.scheduleMissing"; params: Record<string, never> }
  | { version: 1; code: "request.scheduleTooSoon"; params: Record<string, never> }
  | { version: 1; code: "request.scheduleTooFar"; params: { days: number } }
  | { version: 1; code: "request.noEligibleRecipients"; params: Record<string, never> }
  | { version: 1; code: "request.saveDraftFirst"; params: Record<string, never> }
  | { version: 1; code: "request.userMissing"; params: Record<string, never> }
  | { version: 1; code: "request.testRecipientCreateFailed"; params: Record<string, never> }
  | { version: 1; code: "message.subjectRequired"; params: Record<string, never> }
  | { version: 1; code: "message.subjectMax"; params: { max: number } }
  | { version: 1; code: "message.bodyRequired"; params: Record<string, never> }
  | { version: 1; code: "message.bodyMax"; params: { max: number } }
  | { version: 1; code: "message.buttonTextRequired"; params: Record<string, never> }
  | { version: 1; code: "message.buttonTextMax"; params: { max: number } }
  | { version: 1; code: "message.buttonUrlRequired"; params: Record<string, never> }
  | { version: 1; code: "message.buttonUrlInvalid"; params: Record<string, never> }
  | { version: 1; code: "kp.existingRequired"; params: Record<string, never> }
  | { version: 1; code: "kp.codeFormat"; params: { code: string } }
  | { version: 1; code: "kp.discountPositive"; params: Record<string, never> }
  | { version: 1; code: "kp.percentLimit"; params: { max: number } }
  | { version: 1; code: "kp.fixedLimit"; params: { max: number } }
  | { version: 1; code: "kp.daysRange"; params: { min: number; max: number } }
  | { version: 1; code: "kp.codeMissing"; params: { code: string } }
  | { version: 1; code: "kp.personalCodeNotShared"; params: { code: string } }
  | { version: 1; code: "kp.singleUseCodeNotShared"; params: { code: string } }
  | { version: 1; code: "kp.codeUnavailable"; params: { code: string } }
  | { version: 1; code: "server.failure"; params: Record<string, never> }
  | { version: 1; code: "http.status"; params: { status: number } };

const diagnostics = new WeakMap<object, MailingDiagnostic>();

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function ownDataKeys(value: unknown, keys: readonly string[]): value is object {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}

/** Never invoke untrusted getters or parse a message/status to guess its reason. */
export function parseMailingDiagnostic(value: unknown): MailingDiagnostic | null {
  try {
    if (!ownDataKeys(value, ["version", "code", "params"]) || ownData(value, "version") !== 1) return null;
    const code = ownData(value, "code");
    const params = ownData(value, "params");
    switch (code) {
    case "request.kindUnknown": {
      if (!ownDataKeys(params, ["kind"])) return null;
      const kind = ownData(params, "kind");
      if (!((typeof kind === "string"))) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ kind }) });
    }
    case "request.draftOnly": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "request.campaignMissing": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "request.alreadyLaunched": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "request.noChannels": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "request.noRecipients": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "request.scheduleMissing": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "request.scheduleTooSoon": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "request.scheduleTooFar": {
      if (!ownDataKeys(params, ["days"])) return null;
      const days = ownData(params, "days");
      if (!(days === 60)) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ days }) });
    }
    case "request.noEligibleRecipients": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "request.saveDraftFirst": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "request.userMissing": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "request.testRecipientCreateFailed": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "message.subjectRequired": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "message.subjectMax": {
      if (!ownDataKeys(params, ["max"])) return null;
      const max = ownData(params, "max");
      if (!(max === 150)) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ max }) });
    }
    case "message.bodyRequired": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "message.bodyMax": {
      if (!ownDataKeys(params, ["max"])) return null;
      const max = ownData(params, "max");
      if (!(max === 5000)) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ max }) });
    }
    case "message.buttonTextRequired": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "message.buttonTextMax": {
      if (!ownDataKeys(params, ["max"])) return null;
      const max = ownData(params, "max");
      if (!(max === 40)) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ max }) });
    }
    case "message.buttonUrlRequired": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "message.buttonUrlInvalid": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "kp.existingRequired": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "kp.codeFormat": {
      if (!ownDataKeys(params, ["code"])) return null;
      const parameterCode = ownData(params, "code");
      if (!((typeof parameterCode === "string" && parameterCode.length <= 64))) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ code: parameterCode }) });
    }
    case "kp.discountPositive": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "kp.percentLimit": {
      if (!ownDataKeys(params, ["max"])) return null;
      const max = ownData(params, "max");
      if (!(max === 100)) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ max }) });
    }
    case "kp.fixedLimit": {
      if (!ownDataKeys(params, ["max"])) return null;
      const max = ownData(params, "max");
      if (!(max === 100000)) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ max }) });
    }
    case "kp.daysRange": {
      if (!ownDataKeys(params, ["min", "max"])) return null;
      const min = ownData(params, "min");
      const max = ownData(params, "max");
      if (!(min === 1 && max === 90)) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ min, max }) });
    }
    case "kp.codeMissing": {
      if (!ownDataKeys(params, ["code"])) return null;
      const parameterCode = ownData(params, "code");
      if (!((typeof parameterCode === "string" && /^[A-Z0-9_-]{3,32}$/.test(parameterCode)))) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ code: parameterCode }) });
    }
    case "kp.personalCodeNotShared": {
      if (!ownDataKeys(params, ["code"])) return null;
      const parameterCode = ownData(params, "code");
      if (!((typeof parameterCode === "string" && /^[A-Z0-9_-]{3,32}$/.test(parameterCode)))) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ code: parameterCode }) });
    }
    case "kp.singleUseCodeNotShared": {
      if (!ownDataKeys(params, ["code"])) return null;
      const parameterCode = ownData(params, "code");
      if (!((typeof parameterCode === "string" && /^[A-Z0-9_-]{3,32}$/.test(parameterCode)))) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ code: parameterCode }) });
    }
    case "kp.codeUnavailable": {
      if (!ownDataKeys(params, ["code"])) return null;
      const parameterCode = ownData(params, "code");
      if (!((typeof parameterCode === "string" && /^[A-Z0-9_-]{3,32}$/.test(parameterCode)))) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ code: parameterCode }) });
    }
    case "server.failure": {
      if (!ownDataKeys(params, [])) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({  }) });
    }
    case "http.status": {
      if (!ownDataKeys(params, ["status"])) return null;
      const status = ownData(params, "status");
      if (!((typeof status === "number" && Number.isInteger(status) && status >= 0 && status <= 599))) return null;
      return Object.freeze({ version: 1, code, params: Object.freeze({ status }) });
    }
      default: return null;
    }
  } catch {
    // Proxies/revoked proxies are untrusted metadata, not a new request failure.
    return null;
  }
}

/** Return the exact original object; add no fields, symbols or prototype changes. */
export function withMailingDiagnostic<const T extends object>(value: T, presentation: unknown): T {
  const diagnostic = parseMailingDiagnostic(presentation);
  if (diagnostic) diagnostics.set(value, diagnostic);
  return value;
}

export function mailingDiagnostic(value: unknown): MailingDiagnostic | null {
  return value !== null && (typeof value === "object" || typeof value === "function") ? diagnostics.get(value) ?? null : null;
}

/** Only an explicit own-data HTTP field crosses the server/client boundary. */
export function mailingDiagnosticFromResponse(value: unknown): MailingDiagnostic | null {
  try {
    return value && typeof value === "object" ? parseMailingDiagnostic(ownData(value, "presentation")) : null;
  } catch {
    return null;
  }
}

/** Capture exactly the template interpolation already used by the legacy error. */
export function captureMailingDisplay(value: unknown, receive: (display: string, raw: unknown) => void): string {
  const display = `${value}`;
  receive(display, value);
  return display;
}
