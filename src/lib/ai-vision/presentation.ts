import type { VisionErrorCode } from "./shared";

const ERROR_KEYS = {
  bad_request: "errors.bad_request",
  too_large: "errors.too_large",
  bad_type: "errors.bad_type",
  limit: "errors.limit",
  not_configured: "errors.not_configured",
  timeout: "errors.timeout",
  failed: "errors.failed",
} as const satisfies Record<VisionErrorCode, string>;

/** Server messages may be legacy Russian; display stable codes in the viewer's locale. */
export function visionErrorMessageKey(code: unknown, status: number) {
  if (status === 401) return "errors.unauthorized";
  if (status === 403) return "errors.forbidden";
  if (typeof code === "string" && Object.hasOwn(ERROR_KEYS, code)) {
    return ERROR_KEYS[code as VisionErrorCode];
  }
  return "recognitionFailed";
}
