import type { MessageContract } from "@/i18n/message-contract";

type StepPrefixes<T> = {
  [K in keyof T & string]: T[K] extends { title: string; body: string }
    ? K
    : T[K] extends object ? `${K}.${StepPrefixes<T[K]>}` : never;
}[keyof T & string];

export type WalkthroughStepCopyKey = StepPrefixes<MessageContract["journalControls"]["walkthroughs"]>;
export type WalkthroughTranslator = (key: `${WalkthroughStepCopyKey}.${"title" | "body"}`) => string;

// Stable identifiers only. Full filling guides can reuse this projection's keys
// when their remaining content is localized; array positions are source order,
// never translated labels or persisted answers.
export const FILLING_GUIDE_WALKTHROUGH_COPY_KEYS = {
  "health_check": [
    "guides.health_check.askSymptoms",
    "guides.health_check.recordDecision",
    "guides.health_check.signAndTime"
  ],
  "cold_equipment_control": [
    "guides.cold_equipment_control.placeThermometer",
    "guides.cold_equipment_control.waitForReading",
    "guides.cold_equipment_control.recordTemperature",
    "guides.cold_equipment_control.correctDeviation"
  ],
  "cleaning": [
    "guides.cleaning.clearArea",
    "guides.cleaning.washSurfaces",
    "guides.cleaning.rinseSurfaces",
    "guides.cleaning.recordCleaning"
  ],
  "finished_product": [
    "guides.finished_product.checkAppearance",
    "guides.finished_product.measureServingTemperature",
    "guides.finished_product.checkSmell",
    "guides.finished_product.tasteDish"
  ],
  "incoming_control": [
    "guides.incoming_control.compareDeliveryNote",
    "guides.incoming_control.checkLabels",
    "guides.incoming_control.measureTemperature",
    "guides.incoming_control.inspectPackaging"
  ],
  "intensive_cooling": [
    "guides.intensive_cooling.recordStart",
    "guides.intensive_cooling.placeInChiller",
    "guides.intensive_cooling.checkEveryHalfHour",
    "guides.intensive_cooling.recordFinish"
  ],
  "fryer_oil": [
    "guides.fryer_oil.recordStart",
    "guides.fryer_oil.checkOil",
    "guides.fryer_oil.recordDecision"
  ],
  "disinfectant_usage": [
    "guides.disinfectant_usage.prepareSolution",
    "guides.disinfectant_usage.treatSurface",
    "guides.disinfectant_usage.rinseSurface",
    "guides.disinfectant_usage.recordTreatment"
  ],
  "ppe_issuance": [
    "guides.ppe_issuance.identifyNeeds",
    "guides.ppe_issuance.issueForSignature",
    "guides.ppe_issuance.recordReplacement"
  ],
  "staff_training": [
    "guides.staff_training.giveBriefing",
    "guides.staff_training.checkUnderstanding",
    "guides.staff_training.recordTraining"
  ],
  "med_books": [
    "guides.med_books.registerBook",
    "guides.med_books.trackValidity",
    "guides.med_books.updateAfterExamination"
  ],
  "equipment_cleaning": [
    "guides.equipment_cleaning.disassembleEquipment",
    "guides.equipment_cleaning.washParts",
    "guides.equipment_cleaning.rinseParts",
    "guides.equipment_cleaning.disinfectParts"
  ],
  "perishable_rejection": [
    "guides.perishable_rejection.checkDocuments",
    "guides.perishable_rejection.checkExpiry",
    "guides.perishable_rejection.measureTemperature",
    "guides.perishable_rejection.inspectQuality"
  ],
  "complaint_register": [
    "guides.complaint_register.receiveComplaint",
    "guides.complaint_register.recordDetails",
    "guides.complaint_register.notifyManager",
    "guides.complaint_register.recordActions"
  ],
  "daily_samples": [
    "guides.daily_samples.prepareContainers",
    "guides.daily_samples.labelSample",
    "guides.daily_samples.refrigerateSample",
    "guides.daily_samples.recordSample"
  ],
  "vitaminization": [
    "guides.vitaminization.coolDish",
    "guides.vitaminization.measureDose",
    "guides.vitaminization.mixAndServe",
    "guides.vitaminization.recordAddition"
  ],
  "ration_control": [
    "guides.ration_control.calculateActual",
    "guides.ration_control.recordNormAndActual",
    "guides.ration_control.explainDeviation"
  ],
  "transport_temperature": [
    "guides.transport_temperature.measureAtLoading",
    "guides.transport_temperature.measureAtUnloading",
    "guides.transport_temperature.reportDeviation"
  ],
  "tableware_breakage": [
    "guides.tableware_breakage.stopNearbyWork",
    "guides.tableware_breakage.collectFragments",
    "guides.tableware_breakage.recordBreakage"
  ],
  "pool_water_control": [
    "guides.pool_water_control.takeSample",
    "guides.pool_water_control.measureIndicators",
    "guides.pool_water_control.checkClarity",
    "guides.pool_water_control.recordAndCompare"
  ],
  "inventory_condition": [
    "guides.inventory_condition.walkArea",
    "guides.inventory_condition.inspectEachItem",
    "guides.inventory_condition.removeDamagedItems",
    "guides.inventory_condition.recordInspection"
  ],
  "instrument_sterilization": [
    "guides.instrument_sterilization.prepareInstruments",
    "guides.instrument_sterilization.packWithIndicator",
    "guides.instrument_sterilization.runCycle",
    "guides.instrument_sterilization.checkIndicator"
  ],
  "medical_waste_b": [
    "guides.medical_waste_b.collectSeparately",
    "guides.medical_waste_b.disinfectWaste",
    "guides.medical_waste_b.weighAndLabel",
    "guides.medical_waste_b.recordWaste"
  ],
  "batch_release": [
    "guides.batch_release.takeSample",
    "guides.batch_release.checkProduct",
    "guides.batch_release.decideRelease",
    "guides.batch_release.recordRelease"
  ],
  "accident_journal": [
    "guides.accident_journal.ensureSafety",
    "guides.accident_journal.assessFoodImpact",
    "guides.accident_journal.notifyManager",
    "guides.accident_journal.describeIncident"
  ],
  "uv_lamp_runtime": [
    "guides.uv_lamp_runtime.prepareArea",
    "guides.uv_lamp_runtime.switchOnLamp",
    "guides.uv_lamp_runtime.waitExposureTime",
    "guides.uv_lamp_runtime.switchOffAndVentilate"
  ],
  "general_cleaning": [
    "guides.general_cleaning.checkSchedule",
    "guides.general_cleaning.clearRoom",
    "guides.general_cleaning.cleanTopToBottom",
    "guides.general_cleaning.cleanRefrigerators"
  ],
  "cleaning_ventilation_checklist": [
    "guides.cleaning_ventilation_checklist.inspectHoodMonthly",
    "guides.cleaning_ventilation_checklist.cleanHood",
    "guides.cleaning_ventilation_checklist.checkAirflow",
    "guides.cleaning_ventilation_checklist.recordChecklist"
  ],
  "glass_control": [
    "guides.glass_control.inspectInventory",
    "guides.glass_control.findDefects",
    "guides.glass_control.checkLampCovers",
    "guides.glass_control.recordOutcome"
  ],
  "equipment_maintenance": [
    "guides.equipment_maintenance.checkSchedule",
    "guides.equipment_maintenance.performMaintenance",
    "guides.equipment_maintenance.recordMaintenance",
    "guides.equipment_maintenance.fileReport"
  ],
  "equipment_calibration": [
    "guides.equipment_calibration.registerInstruments",
    "guides.equipment_calibration.checkInterval",
    "guides.equipment_calibration.sendForVerification",
    "guides.equipment_calibration.recordVerification"
  ],
  "breakdown_history": [
    "guides.breakdown_history.createEquipmentCard",
    "guides.breakdown_history.recordBreakdown",
    "guides.breakdown_history.analyseFrequency",
    "guides.breakdown_history.assessServiceLife"
  ],
  "metal_impurity": [
    "guides.metal_impurity.cleanMagnet",
    "guides.metal_impurity.processBatch",
    "guides.metal_impurity.weighParticles",
    "guides.metal_impurity.decideAction"
  ],
  "traceability_test": [
    "guides.traceability_test.scheduleDrill",
    "guides.traceability_test.traceToIngredients",
    "guides.traceability_test.traceToDishes",
    "guides.traceability_test.recordDuration"
  ],
  "product_writeoff": [
    "guides.product_writeoff.recordReason",
    "guides.product_writeoff.formCommission",
    "guides.product_writeoff.weighAndDescribe",
    "guides.product_writeoff.disposeProduct"
  ],
  "incoming_raw_materials_control": [
    "guides.incoming_raw_materials_control.checkDocuments",
    "guides.incoming_raw_materials_control.measurePerishables",
    "guides.incoming_raw_materials_control.inspectQuality",
    "guides.incoming_raw_materials_control.recordBatchAndExpiry"
  ],
  "sanitary_day_control": [
    "guides.sanitary_day_control.planDay",
    "guides.sanitary_day_control.emptyAndDefrost",
    "guides.sanitary_day_control.deepClean",
    "guides.sanitary_day_control.arrangePestControl"
  ],
  "audit_plan": [
    "guides.audit_plan.defineAuditAreas",
    "guides.audit_plan.appointAuditors",
    "guides.audit_plan.setDates",
    "guides.audit_plan.prepareChecklists"
  ],
  "audit_protocol": [
    "guides.audit_protocol.openMeeting",
    "guides.audit_protocol.collectEvidence",
    "guides.audit_protocol.recordNonconformities",
    "guides.audit_protocol.closeMeeting"
  ],
  "audit_report": [
    "guides.audit_report.writeSummary",
    "guides.audit_report.listNonconformities",
    "guides.audit_report.planCorrectiveActions",
    "guides.audit_report.submitToManagement"
  ],
  "training_plan": [
    "guides.training_plan.defineTopics",
    "guides.training_plan.groupStaff",
    "guides.training_plan.setFrequency",
    "guides.training_plan.chooseFormat"
  ],
  "glass_items_list": [
    "guides.glass_items_list.walkAllAreas",
    "guides.glass_items_list.listAllItems",
    "guides.glass_items_list.assignNumbers",
    "guides.glass_items_list.recordLocation"
  ],
  "pest_control": [
    "guides.pest_control.inspectMonthly",
    "guides.pest_control.recordFindings",
    "guides.pest_control.scheduleTreatment",
    "guides.pest_control.fileReports"
  ],
  "ccp_monitoring": [
    "guides.ccp_monitoring.takePoint",
    "guides.ccp_monitoring.measure",
    "guides.ccp_monitoring.record",
    "guides.ccp_monitoring.actOnDeviation"
  ]
} as const satisfies Record<string, readonly WalkthroughStepCopyKey[]>;

export const MANUAL_WALKTHROUGH_COPY_KEYS = {
  "hygiene": {
    "create-document": "manual.hygiene.create-document",
    "open-document": "manual.hygiene.open-document",
    "add-staff": "manual.hygiene.add-staff",
    "staff-card": "manual.hygiene.staff-card",
    "status-cell": "manual.hygiene.status-cell",
    "temperature-cell": "manual.hygiene.temperature-cell",
    "autofill": "manual.hygiene.autofill",
    "finish": "manual.hygiene.finish"
  },
  "climate_control": {
    "create-document": "manual.climate_control.create-document",
    "open-document": "manual.climate_control.open-document",
    "add-room": "manual.climate_control.add-room",
    "journal-settings": "manual.climate_control.journal-settings",
    "autofill": "manual.climate_control.autofill",
    "view-toggle": "manual.climate_control.view-toggle",
    "add-row": "manual.climate_control.add-row",
    "measure-input": "manual.climate_control.measure-input",
    "finish": "manual.climate_control.finish"
  }
} as const satisfies Record<string, Record<string, WalkthroughStepCopyKey>>;

export const GENERIC_WALKTHROUGH_COPY_KEYS = {
  "create-document": "generic.create-document",
  "document-card": "generic.document-card",
  "view-toggle": "generic.view-toggle",
  "add-row": "generic.add-row",
  "fill-cells": "generic.fill-cells",
  "autofill": "generic.autofill",
  "more-actions": "generic.more-actions"
} as const satisfies Record<string, WalkthroughStepCopyKey>;
