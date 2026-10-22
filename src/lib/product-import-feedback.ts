type SimpleErrorKey =
  | "errors.generic"
  | "errors.unauthorized"
  | "errors.managementRequired"
  | "errors.fileRequired"
  | "errors.empty"
  | "errors.nameColumnRequired"
  | "errors.noProducts"
  | "errors.failed";

export type ProductImportFeedback =
  | { key: SimpleErrorKey }
  | { key: "errors.tooLarge"; values: { limitMB: number } }
  | { key: "errors.tooManyRows"; values: { count: number; limit: number } };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeCount(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

/** Keep only known producer semantics; translate when rendering, never while awaiting a response. */
export function getProductImportFeedback(body: unknown): ProductImportFeedback {
  const fallback: ProductImportFeedback = { key: "errors.generic" };
  if (!record(body) || !Object.hasOwn(body, "errorCode")) return fallback;
  switch (body.errorCode) {
    case "PRODUCT_IMPORT_UNAUTHORIZED": return { key: "errors.unauthorized" };
    case "PRODUCT_IMPORT_MANAGEMENT_REQUIRED": return { key: "errors.managementRequired" };
    case "PRODUCT_IMPORT_FILE_REQUIRED": return { key: "errors.fileRequired" };
    case "PRODUCT_IMPORT_EMPTY": return { key: "errors.empty" };
    case "PRODUCT_IMPORT_NAME_COLUMN_REQUIRED": return { key: "errors.nameColumnRequired" };
    case "PRODUCT_IMPORT_NO_PRODUCTS": return { key: "errors.noProducts" };
    case "PRODUCT_IMPORT_FAILED": return { key: "errors.failed" };
    case "PRODUCT_IMPORT_TOO_LARGE": {
      const params = body.params;
      return Object.hasOwn(body, "params") && record(params) && Object.hasOwn(params, "limitMB") && safeCount(params.limitMB, 1)
        ? { key: "errors.tooLarge", values: { limitMB: params.limitMB } }
        : fallback;
    }
    case "PRODUCT_IMPORT_TOO_MANY_ROWS": {
      const params = body.params;
      return Object.hasOwn(body, "params") && record(params) && Object.hasOwn(params, "count") && Object.hasOwn(params, "limit") && safeCount(params.count, 0) && safeCount(params.limit, 1)
        ? { key: "errors.tooManyRows", values: { count: params.count, limit: params.limit } }
        : fallback;
    }
    default: return fallback;
  }
}
