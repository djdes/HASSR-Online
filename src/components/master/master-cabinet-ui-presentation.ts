export const MASTER_CABINET_UI_ERRORS = {
  loadAccess: "errors.loadAccess",
  loadFailed: "errors.loadFailed",
  createInvalid: "errors.createInvalid",
  createAccess: "errors.createAccess",
  createConflict: "errors.createConflict",
  createRateLimited: "errors.createRateLimited",
  createFailed: "errors.createFailed",
  openFailed: "errors.openFailed",
} as const;

export type MasterCabinetListErrorKey =
  | typeof MASTER_CABINET_UI_ERRORS.loadAccess
  | typeof MASTER_CABINET_UI_ERRORS.loadFailed;

export type MasterCabinetCreateErrorKey =
  | typeof MASTER_CABINET_UI_ERRORS.createInvalid
  | typeof MASTER_CABINET_UI_ERRORS.createAccess
  | typeof MASTER_CABINET_UI_ERRORS.createConflict
  | typeof MASTER_CABINET_UI_ERRORS.createRateLimited
  | typeof MASTER_CABINET_UI_ERRORS.createFailed;

export function masterCabinetListErrorKey(status: number): MasterCabinetListErrorKey {
  return status === 401 || status === 403
    ? MASTER_CABINET_UI_ERRORS.loadAccess
    : MASTER_CABINET_UI_ERRORS.loadFailed;
}

export function masterCabinetCreateErrorKey(status: number): MasterCabinetCreateErrorKey {
  switch (status) {
    case 400:
      return MASTER_CABINET_UI_ERRORS.createInvalid;
    case 401:
    case 403:
      return MASTER_CABINET_UI_ERRORS.createAccess;
    case 409:
      return MASTER_CABINET_UI_ERRORS.createConflict;
    case 429:
      return MASTER_CABINET_UI_ERRORS.createRateLimited;
    default:
      return MASTER_CABINET_UI_ERRORS.createFailed;
  }
}

export function masterCabinetOpenErrorKey(): typeof MASTER_CABINET_UI_ERRORS.openFailed {
  return MASTER_CABINET_UI_ERRORS.openFailed;
}
