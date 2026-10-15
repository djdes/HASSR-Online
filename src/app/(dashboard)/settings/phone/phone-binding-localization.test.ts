import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { phoneAutolinkReason, phoneResponseError } from "./phone-binding-client";

for (const locale of ["ru", "en", "uz"] as const) {
  test(`phone feedback uses safe ${locale} descriptors and preserves customer names`, async () => {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "phoneBinding", onError: error => { throw error; } });
    const names = ["Customer O‘tkir <b>literal</b>", "Телефон не указан"];
    for (const name of names) {
      assert.equal(phoneResponseError({ errorCode: "PHONE_DUPLICATE", errorParams: { name }, error: "RAW SERVER TEXT" }, t), t("errors.duplicatePhone", { name }));
    }
    for (const response of [null, { error: "RAW SERVER TEXT" }, { errorCode: "UNKNOWN", error: "RAW SERVER TEXT" }, { errorCode: "PHONE_DUPLICATE", errorParams: { name: 42 } }]) {
      assert.equal(phoneResponseError(response, t), t("toast.saveFailed"));
    }
    assert.equal(phoneResponseError({errorCode:"PHONE_UNAUTHORIZED"}, t), t("errors.unauthorized"));
    assert.equal(phoneResponseError({errorCode:"PHONE_INVALID_REQUEST"}, t), t("errors.invalidRequest"));
    assert.equal(phoneResponseError({errorCode:"PHONE_INVALID_FORMAT"}, t), t("errors.invalidPhone"));

    for (const [reason, expected] of [
      ["no-integration", t("autolink.noIntegration")],
      ["no-tf-user-with-phone", t("autolink.noEmployee")],
      ["commission-member", t("autolink.commissionMember")],
      ["already-linked", t("autolink.alreadyLinked")],
      ["invalid-phone", t("autolink.invalidPhone")],
      ["crypto-error", t("autolink.cryptoError")],
      ["tasksflow-503", t("autolink.tasksflowStatus", {status:"503"})],
      ["tasksflow-create-409", t("autolink.tasksflowCreateStatus", {status:"409"})],
      ["RAW PROVIDER SECRET", t("autolink.unavailable")],
      ["tasksflow-999", t("autolink.unavailable")],
    ]) assert.equal(phoneAutolinkReason({ok:false, reason}, t), expected);
    assert.equal(phoneAutolinkReason({ok:true, linked:false}, t), t("autolink.unknownReason"));
    assert.equal(phoneAutolinkReason({ok:false, reason:"RAW", reasonCode:"tasksflow-status", reasonParams:{status:429}}, t), t("autolink.tasksflowStatus", {status:"429"}));
    for (const status of [NaN, Infinity, "503", 0, 999, 503.5]) {
      assert.equal(phoneAutolinkReason({ok:false, reason:"RAW", reasonCode:"tasksflow-status", reasonParams:{status}}, t), t("autolink.unavailable"));
    }
  });
}
