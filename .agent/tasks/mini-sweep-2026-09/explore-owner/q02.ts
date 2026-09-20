import { db } from "../tg-session";
async function main() {
  const codes = ["hygiene","health_check","climate_control","cleaning","general_cleaning","finished_product","perishable_rejection","incoming_control","fryer_oil","equipment_maintenance","equipment_calibration","complaint_register","audit_plan","audit_protocol","disinfectant_usage","cleaning_ventilation_checklist","sanitary_day_control","incoming_raw_materials_control","pest_control","training_plan","product_writeoff","breakdown_history"];
  for (const c of codes) {
    const d: any = await db.journalDocument.findFirst({ where: { organizationId: "e2e-org-a", template: { code: c } }, orderBy: { createdAt: "desc" } });
    console.log(c + " -> " + (d ? d.id : "NONE"));
  }
  await db.$disconnect();
}
main().then(()=>process.exit(0), e=>{console.error(e);process.exit(1);});
