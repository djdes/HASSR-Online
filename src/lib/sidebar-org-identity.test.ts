import assert from "node:assert/strict";
import test from "node:test";
import { sidebarOrgIdentity } from "@/lib/sidebar-org-identity";

const snapshot = { inn: "7701234567", nameShort: "ООО «Кафе у дома»" };

test("sidebarOrgIdentity: краткое из ЕГРЮЛ → название для журналов → название компании", () => {
  assert.deepEqual(sidebarOrgIdentity({ inn: "7701234567", legalProfileJson: snapshot, journalShortName: "Кафе" }, "Кафе у дома"), {
    name: "ООО «Кафе у дома»",
    inn: "7701234567",
  });
  assert.deepEqual(sidebarOrgIdentity({ journalShortName: "ИП  Петров " }, "Кафе"), { name: "ИП Петров", inn: null });
  assert.deepEqual(sidebarOrgIdentity({}, "Кафе"), { name: "Кафе", inn: null });
  assert.deepEqual(sidebarOrgIdentity(null, "WeSetup"), { name: "WeSetup", inn: null });
});

test("sidebarOrgIdentity: ИНН из организации, иначе из снимка; только 10 или 12 цифр", () => {
  assert.equal(sidebarOrgIdentity({ legalProfileJson: snapshot }, "Кафе").inn, "7701234567");
  assert.equal(sidebarOrgIdentity({ inn: " 7701 234567 " }, "Кафе").inn, "7701234567");
  assert.equal(sidebarOrgIdentity({ inn: "500100732259" }, "Кафе").inn, "500100732259");
  assert.equal(sidebarOrgIdentity({ inn: "12345" }, "Кафе").inn, null);
});

test("sidebarOrgIdentity: снимок другого ИНН не подмешивается", () => {
  // ИНН сменили, ЕГРЮЛ не обновили: старое юрлицо рядом с новым ИНН не показываем.
  assert.deepEqual(sidebarOrgIdentity({ inn: "7807654321", legalProfileJson: snapshot }, "Кафе"), {
    name: "Кафе",
    inn: "7807654321",
  });
});
