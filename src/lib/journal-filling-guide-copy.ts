import type { MessageContract } from "@/i18n/message-contract";
import { FILLING_GUIDE_WALKTHROUGH_COPY_KEYS, type WalkthroughTranslator } from "./journal-walkthrough-copy";

type LeafKeys<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafKeys<T[K]>}`;
}[keyof T & string];

export type FillingGuideMessageKey = LeafKeys<MessageContract["journalFillingGuides"]>;
export type FillingGuideTranslator = (key: FillingGuideMessageKey) => string;
export type FillingGuideTranslators = {
  guide: FillingGuideTranslator;
  walkthrough: WalkthroughTranslator;
};

// Ordered source pointers map to semantic message keys, never display text.
// Tests compare all Russian leaves and detect schema/source-order drift.
export const FILLING_GUIDE_COPY_KEYS = {
  "hygiene": {
    "summary": "hygiene.summary",
    "materials.0": "hygiene.materials.journal",
    "materials.1": "hygiene.materials.gloves",
    "materials.2": "hygiene.materials.staffList",
    "steps.0.title": "hygiene.steps.gatherStaff.title",
    "steps.0.detail": "hygiene.steps.gatherStaff.detail",
    "steps.1.title": "hygiene.steps.askWellbeing.title",
    "steps.1.detail": "hygiene.steps.askWellbeing.detail",
    "steps.2.title": "hygiene.steps.recordResult.title",
    "steps.2.detail": "hygiene.steps.recordResult.detail",
    "steps.3.title": "hygiene.steps.sign.title",
    "steps.3.detail": "hygiene.steps.sign.detail",
    "completionCriteria": "hygiene.completionCriteria",
    "commonMistakes.0": "hygiene.mistakes.skippedEmployee",
    "commonMistakes.1": "hygiene.mistakes.cutWithoutGlove",
    "commonMistakes.2": "hygiene.mistakes.backdatedEntry",
    "regulationRef": "hygiene.regulationRef"
  },
  "health_check": {
    "summary": "health_check.summary",
    "materials.0": "health_check.materials.journal",
    "materials.1": "health_check.materials.staffList",
    "materials.2": "health_check.materials.thermometer",
    "completionCriteria": "health_check.completionCriteria",
    "commonMistakes.0": "health_check.mistakes.skippedEmployee",
    "commonMistakes.1": "health_check.mistakes.uncheckedHealthy",
    "commonMistakes.2": "health_check.mistakes.clearingFever",
    "regulationRef": "health_check.regulationRef"
  },
  "cold_equipment_control": {
    "summary": "cold_equipment_control.summary",
    "materials.0": "cold_equipment_control.materials.thermometer",
    "materials.1": "cold_equipment_control.materials.journal",
    "materials.2": "cold_equipment_control.materials.equipmentList",
    "completionCriteria": "cold_equipment_control.completionCriteria",
    "commonMistakes.0": "cold_equipment_control.mistakes.measureThroughDoor",
    "commonMistakes.1": "cold_equipment_control.mistakes.uncheckedApproval",
    "commonMistakes.2": "cold_equipment_control.mistakes.noCorrectiveAction",
    "regulationRef": "cold_equipment_control.regulationRef"
  },
  "climate_control": {
    "summary": "climate_control.summary",
    "materials.0": "climate_control.materials.meter",
    "materials.1": "climate_control.materials.journal",
    "materials.2": "climate_control.materials.roomList",
    "steps.0.title": "climate_control.steps.placeMeter.title",
    "steps.0.detail": "climate_control.steps.placeMeter.detail",
    "steps.1.title": "climate_control.steps.recordReadings.title",
    "steps.1.detail": "climate_control.steps.recordReadings.detail",
    "steps.2.title": "climate_control.steps.correctDeviation.title",
    "steps.2.detail": "climate_control.steps.correctDeviation.detail",
    "completionCriteria": "climate_control.completionCriteria",
    "commonMistakes.0": "climate_control.mistakes.oneRoomOnly",
    "commonMistakes.1": "climate_control.mistakes.ignoredHumidity",
    "commonMistakes.2": "climate_control.mistakes.noCorrectiveAction",
    "regulationRef": "climate_control.regulationRef"
  },
  "cleaning": {
    "summary": "cleaning.summary",
    "materials.0": "cleaning.materials.detergents",
    "materials.1": "cleaning.materials.tools",
    "materials.2": "cleaning.materials.journal",
    "completionCriteria": "cleaning.completionCriteria",
    "commonMistakes.0": "cleaning.mistakes.sharedMop",
    "commonMistakes.1": "cleaning.mistakes.insufficientContactTime",
    "commonMistakes.2": "cleaning.mistakes.missingCheckerSignature",
    "regulationRef": "cleaning.regulationRef"
  },
  "finished_product": {
    "summary": "finished_product.summary",
    "materials.0": "finished_product.materials.thermometer",
    "materials.1": "finished_product.materials.journal",
    "materials.2": "finished_product.materials.recipeStandards",
    "steps.4.title": "finished_product.steps.decideRelease.title",
    "steps.4.detail": "finished_product.steps.decideRelease.detail",
    "completionCriteria": "finished_product.completionCriteria",
    "commonMistakes.0": "finished_product.mistakes.sharedSpoon",
    "commonMistakes.1": "finished_product.mistakes.warmHotDish",
    "commonMistakes.2": "finished_product.mistakes.missingReworkReason",
    "regulationRef": "finished_product.regulationRef"
  },
  "incoming_control": {
    "summary": "incoming_control.summary",
    "materials.0": "incoming_control.materials.deliveryNote",
    "materials.1": "incoming_control.materials.conformityDocuments",
    "materials.2": "incoming_control.materials.qualityCertificate",
    "materials.3": "incoming_control.materials.thermometer",
    "materials.4": "incoming_control.materials.journal",
    "steps.4.title": "incoming_control.steps.decideReceipt.title",
    "steps.4.detail": "incoming_control.steps.decideReceipt.detail",
    "completionCriteria": "incoming_control.completionCriteria",
    "commonMistakes.0": "incoming_control.mistakes.noTemperatureCheck",
    "commonMistakes.1": "incoming_control.mistakes.missingBatch",
    "commonMistakes.2": "incoming_control.mistakes.acceptingExpired",
    "regulationRef": "incoming_control.regulationRef"
  },
  "intensive_cooling": {
    "summary": "intensive_cooling.summary",
    "materials.0": "intensive_cooling.materials.thermometer",
    "materials.1": "intensive_cooling.materials.journal",
    "materials.2": "intensive_cooling.materials.chiller",
    "steps.4.title": "intensive_cooling.steps.explainDelay.title",
    "steps.4.detail": "intensive_cooling.steps.explainDelay.detail",
    "completionCriteria": "intensive_cooling.completionCriteria",
    "commonMistakes.0": "intensive_cooling.mistakes.sealedHotContainer",
    "commonMistakes.1": "intensive_cooling.mistakes.missingStartTime",
    "commonMistakes.2": "intensive_cooling.mistakes.exceededDuration",
    "regulationRef": "intensive_cooling.regulationRef"
  },
  "fryer_oil": {
    "summary": "fryer_oil.summary",
    "materials.0": "fryer_oil.materials.tester",
    "materials.1": "fryer_oil.materials.journal",
    "materials.2": "fryer_oil.materials.freshOil",
    "completionCriteria": "fryer_oil.completionCriteria",
    "commonMistakes.0": "fryer_oil.mistakes.darkOil",
    "commonMistakes.1": "fryer_oil.mistakes.unwashedFryer",
    "regulationRef": "fryer_oil.regulationRef"
  },
  "disinfectant_usage": {
    "summary": "disinfectant_usage.summary",
    "materials.0": "disinfectant_usage.materials.disinfectant",
    "materials.1": "disinfectant_usage.materials.measuringDevice",
    "materials.2": "disinfectant_usage.materials.journal",
    "completionCriteria": "disinfectant_usage.completionCriteria",
    "commonMistakes.0": "disinfectant_usage.mistakes.undilutedSolution",
    "commonMistakes.1": "disinfectant_usage.mistakes.insufficientContactTime",
    "commonMistakes.2": "disinfectant_usage.mistakes.noRinsing",
    "regulationRef": "disinfectant_usage.regulationRef"
  },
  "ppe_issuance": {
    "summary": "ppe_issuance.summary",
    "materials.0": "ppe_issuance.materials.journal",
    "materials.1": "ppe_issuance.materials.ppe",
    "materials.2": "ppe_issuance.materials.staffList",
    "completionCriteria": "ppe_issuance.completionCriteria",
    "commonMistakes.0": "ppe_issuance.mistakes.unsignedIssue",
    "commonMistakes.1": "ppe_issuance.mistakes.noReplacement",
    "regulationRef": "ppe_issuance.regulationRef"
  },
  "staff_training": {
    "summary": "staff_training.summary",
    "materials.0": "staff_training.materials.journal",
    "materials.1": "staff_training.materials.programme",
    "materials.2": "staff_training.materials.staffList",
    "completionCriteria": "staff_training.completionCriteria",
    "commonMistakes.0": "staff_training.mistakes.signingForEveryone",
    "commonMistakes.1": "staff_training.mistakes.missingInduction",
    "regulationRef": "staff_training.regulationRef"
  },
  "med_books": {
    "summary": "med_books.summary",
    "materials.0": "med_books.materials.register",
    "materials.1": "med_books.materials.books",
    "completionCriteria": "med_books.completionCriteria",
    "commonMistakes.0": "med_books.mistakes.expiredBook",
    "commonMistakes.1": "med_books.mistakes.untrackedExpiry",
    "regulationRef": "med_books.regulationRef"
  },
  "equipment_cleaning": {
    "summary": "equipment_cleaning.summary",
    "materials.0": "equipment_cleaning.materials.detergent",
    "materials.1": "equipment_cleaning.materials.disinfectant",
    "materials.2": "equipment_cleaning.materials.tools",
    "materials.3": "equipment_cleaning.materials.ppe",
    "materials.4": "equipment_cleaning.materials.thermometer",
    "steps.4.title": "equipment_cleaning.steps.dryAndAssemble.title",
    "steps.4.detail": "equipment_cleaning.steps.dryAndAssemble.detail",
    "steps.5.title": "equipment_cleaning.steps.recordCleaning.title",
    "steps.5.detail": "equipment_cleaning.steps.recordCleaning.detail",
    "completionCriteria": "equipment_cleaning.completionCriteria",
    "commonMistakes.0": "equipment_cleaning.mistakes.noPrewash",
    "commonMistakes.1": "equipment_cleaning.mistakes.immediateRinsing",
    "commonMistakes.2": "equipment_cleaning.mistakes.mixingChemicals",
    "commonMistakes.3": "equipment_cleaning.mistakes.missingRinseTemperature",
    "regulationRef": "equipment_cleaning.regulationRef"
  },
  "perishable_rejection": {
    "summary": "perishable_rejection.summary",
    "materials.0": "perishable_rejection.materials.deliveryNote",
    "materials.1": "perishable_rejection.materials.qualityDocuments",
    "materials.2": "perishable_rejection.materials.thermometer",
    "materials.3": "perishable_rejection.materials.journal",
    "steps.4.title": "perishable_rejection.steps.decideReceipt.title",
    "steps.4.detail": "perishable_rejection.steps.decideReceipt.detail",
    "completionCriteria": "perishable_rejection.completionCriteria",
    "commonMistakes.0": "perishable_rejection.mistakes.noTemperatureCheck",
    "commonMistakes.1": "perishable_rejection.mistakes.trustingVerbalAssurance",
    "commonMistakes.2": "perishable_rejection.mistakes.missingBatch",
    "commonMistakes.3": "perishable_rejection.mistakes.lateEntry",
    "regulationRef": "perishable_rejection.regulationRef"
  },
  "complaint_register": {
    "summary": "complaint_register.summary",
    "materials.0": "complaint_register.materials.journal",
    "materials.1": "complaint_register.materials.feedbackBook",
    "materials.2": "complaint_register.materials.managerContact",
    "steps.4.title": "complaint_register.steps.contactComplainant.title",
    "steps.4.detail": "complaint_register.steps.contactComplainant.detail",
    "completionCriteria": "complaint_register.completionCriteria",
    "commonMistakes.0": "complaint_register.mistakes.ignoredMinorComplaint",
    "commonMistakes.1": "complaint_register.mistakes.unexplainedRejection",
    "commonMistakes.2": "complaint_register.mistakes.hiddenPoisoningComplaint",
    "commonMistakes.3": "complaint_register.mistakes.forgottenPromise",
    "regulationRef": "complaint_register.regulationRef"
  },
  "daily_samples": {
    "summary": "daily_samples.summary",
    "materials.0": "daily_samples.materials.jars",
    "materials.1": "daily_samples.materials.spoons",
    "materials.2": "daily_samples.materials.labels",
    "materials.3": "daily_samples.materials.refrigerator",
    "steps.4.title": "daily_samples.steps.disposeAfterRetention.title",
    "steps.4.detail": "daily_samples.steps.disposeAfterRetention.detail",
    "completionCriteria": "daily_samples.completionCriteria",
    "commonMistakes.0": "daily_samples.mistakes.sharedJar",
    "commonMistakes.1": "daily_samples.mistakes.earlyDisposal",
    "commonMistakes.2": "daily_samples.mistakes.missingLabel",
    "regulationRef": "daily_samples.regulationRef"
  },
  "vitaminization": {
    "summary": "vitaminization.summary",
    "materials.0": "vitaminization.materials.vitamin",
    "materials.1": "vitaminization.materials.measure",
    "materials.2": "vitaminization.materials.menuPlan",
    "completionCriteria": "vitaminization.completionCriteria",
    "commonMistakes.0": "vitaminization.mistakes.hotDish",
    "commonMistakes.1": "vitaminization.mistakes.estimatedDose",
    "commonMistakes.2": "vitaminization.mistakes.weeklyBackdating",
    "regulationRef": "vitaminization.regulationRef"
  },
  "ration_control": {
    "summary": "ration_control.summary",
    "materials.0": "ration_control.materials.consumptionRecords",
    "materials.1": "ration_control.materials.norms",
    "materials.2": "ration_control.materials.calculator",
    "completionCriteria": "ration_control.completionCriteria",
    "commonMistakes.0": "ration_control.mistakes.totalInsteadOfPerPerson",
    "commonMistakes.1": "ration_control.mistakes.skippedDeficits",
    "regulationRef": "ration_control.regulationRef"
  },
  "transport_temperature": {
    "summary": "transport_temperature.summary",
    "materials.0": "transport_temperature.materials.thermometer",
    "materials.1": "transport_temperature.materials.deliveryNotes",
    "completionCriteria": "transport_temperature.completionCriteria",
    "commonMistakes.0": "transport_temperature.mistakes.measuringAir",
    "commonMistakes.1": "transport_temperature.mistakes.loadingOnly",
    "regulationRef": "transport_temperature.regulationRef"
  },
  "tableware_breakage": {
    "summary": "tableware_breakage.summary",
    "materials.0": "tableware_breakage.materials.cleaningTools",
    "materials.1": "tableware_breakage.materials.fragmentContainer",
    "materials.2": "tableware_breakage.materials.gloves",
    "completionCriteria": "tableware_breakage.completionCriteria",
    "commonMistakes.0": "tableware_breakage.mistakes.ordinaryBag",
    "commonMistakes.1": "tableware_breakage.mistakes.uncheckedNearbyFood",
    "regulationRef": "tableware_breakage.regulationRef"
  },
  "pool_water_control": {
    "summary": "pool_water_control.summary",
    "materials.0": "pool_water_control.materials.tester",
    "materials.1": "pool_water_control.materials.thermometer",
    "materials.2": "pool_water_control.materials.flask",
    "completionCriteria": "pool_water_control.completionCriteria",
    "commonMistakes.0": "pool_water_control.mistakes.nearDosingNozzle",
    "commonMistakes.1": "pool_water_control.mistakes.openingBeforeResults",
    "commonMistakes.2": "pool_water_control.mistakes.missingVisitorCount",
    "regulationRef": "pool_water_control.regulationRef"
  },
  "inventory_condition": {
    "summary": "inventory_condition.summary",
    "materials.0": "inventory_condition.materials.inventoryList",
    "materials.1": "inventory_condition.materials.lighting",
    "materials.2": "inventory_condition.materials.withdrawnBox",
    "completionCriteria": "inventory_condition.completionCriteria",
    "commonMistakes.0": "inventory_condition.mistakes.usingCrackedBoard",
    "commonMistakes.1": "inventory_condition.mistakes.uncheckedOtherShift",
    "regulationRef": "inventory_condition.regulationRef"
  },
  "instrument_sterilization": {
    "summary": "instrument_sterilization.summary",
    "materials.0": "instrument_sterilization.materials.instruments",
    "materials.1": "instrument_sterilization.materials.packaging",
    "materials.2": "instrument_sterilization.materials.indicator",
    "materials.3": "instrument_sterilization.materials.steriliser",
    "completionCriteria": "instrument_sterilization.completionCriteria",
    "commonMistakes.0": "instrument_sterilization.mistakes.noPrecleaning",
    "commonMistakes.1": "instrument_sterilization.mistakes.openingEarly",
    "commonMistakes.2": "instrument_sterilization.mistakes.unrecordedFailedIndicator",
    "regulationRef": "instrument_sterilization.regulationRef"
  },
  "medical_waste_b": {
    "summary": "medical_waste_b.summary",
    "materials.0": "medical_waste_b.materials.yellowPackaging",
    "materials.1": "medical_waste_b.materials.disinfectant",
    "materials.2": "medical_waste_b.materials.scales",
    "materials.3": "medical_waste_b.materials.gloves",
    "completionCriteria": "medical_waste_b.completionCriteria",
    "commonMistakes.0": "medical_waste_b.mistakes.needlesInGeneralWaste",
    "commonMistakes.1": "medical_waste_b.mistakes.overfilledSharps",
    "regulationRef": "medical_waste_b.regulationRef"
  },
  "batch_release": {
    "summary": "batch_release.summary",
    "materials.0": "batch_release.materials.sample",
    "materials.1": "batch_release.materials.specification",
    "materials.2": "batch_release.materials.documents",
    "completionCriteria": "batch_release.completionCriteria",
    "commonMistakes.0": "batch_release.mistakes.uncheckedLabel",
    "commonMistakes.1": "batch_release.mistakes.unrecordedRejection",
    "regulationRef": "batch_release.regulationRef"
  },
  "accident_journal": {
    "summary": "accident_journal.summary",
    "materials.0": "accident_journal.materials.log",
    "materials.1": "accident_journal.materials.contacts",
    "materials.2": "accident_journal.materials.footage",
    "steps.4.title": "accident_journal.steps.investigate.title",
    "steps.4.detail": "accident_journal.steps.investigate.body",
    "completionCriteria": "accident_journal.completionCriteria",
    "commonMistakes.0": "accident_journal.mistakes.servingUnsafeFood",
    "commonMistakes.1": "accident_journal.mistakes.noSanitaryNotification",
    "commonMistakes.2": "accident_journal.mistakes.formalCause",
    "commonMistakes.3": "accident_journal.mistakes.falseDate",
    "regulationRef": "accident_journal.regulationRef"
  },
  "uv_lamp_runtime": {
    "summary": "uv_lamp_runtime.summary",
    "materials.0": "uv_lamp_runtime.materials.log",
    "materials.1": "uv_lamp_runtime.materials.passport",
    "materials.2": "uv_lamp_runtime.materials.timer",
    "steps.4.title": "uv_lamp_runtime.steps.recordHours.title",
    "steps.4.detail": "uv_lamp_runtime.steps.recordHours.body",
    "completionCriteria": "uv_lamp_runtime.completionCriteria",
    "commonMistakes.0": "uv_lamp_runtime.mistakes.peoplePresent",
    "commonMistakes.1": "uv_lamp_runtime.mistakes.noHourTracking",
    "commonMistakes.2": "uv_lamp_runtime.mistakes.noVentilation",
    "commonMistakes.3": "uv_lamp_runtime.mistakes.wrongLamp",
    "regulationRef": "uv_lamp_runtime.regulationRef"
  },
  "general_cleaning": {
    "summary": "general_cleaning.summary",
    "materials.0": "general_cleaning.materials.schedule",
    "materials.1": "general_cleaning.materials.log",
    "materials.2": "general_cleaning.materials.chemicals",
    "materials.3": "general_cleaning.materials.tools",
    "materials.4": "general_cleaning.materials.ppe",
    "steps.4.title": "general_cleaning.steps.recordCleaning.title",
    "steps.4.detail": "general_cleaning.steps.recordCleaning.body",
    "completionCriteria": "general_cleaning.completionCriteria",
    "commonMistakes.0": "general_cleaning.mistakes.dailyAsDeep",
    "commonMistakes.1": "general_cleaning.mistakes.monthlyOnly",
    "commonMistakes.2": "general_cleaning.mistakes.untreatedWalls",
    "commonMistakes.3": "general_cleaning.mistakes.falseSignature",
    "regulationRef": "general_cleaning.regulationRef"
  },
  "cleaning_ventilation_checklist": {
    "summary": "cleaning_ventilation_checklist.summary",
    "materials.0": "cleaning_ventilation_checklist.materials.checklist",
    "materials.1": "cleaning_ventilation_checklist.materials.contract",
    "materials.2": "cleaning_ventilation_checklist.materials.reports",
    "materials.3": "cleaning_ventilation_checklist.materials.tools",
    "steps.4.title": "cleaning_ventilation_checklist.steps.quarterlyContractor.title",
    "steps.4.detail": "cleaning_ventilation_checklist.steps.quarterlyContractor.body",
    "completionCriteria": "cleaning_ventilation_checklist.completionCriteria",
    "commonMistakes.0": "cleaning_ventilation_checklist.mistakes.dirtyGreaseTraps",
    "commonMistakes.1": "cleaning_ventilation_checklist.mistakes.exteriorOnly",
    "commonMistakes.2": "cleaning_ventilation_checklist.mistakes.noContractor",
    "regulationRef": "cleaning_ventilation_checklist.regulationRef"
  },
  "glass_control": {
    "summary": "glass_control.summary",
    "materials.0": "glass_control.materials.log",
    "materials.1": "glass_control.materials.inventory",
    "completionCriteria": "glass_control.completionCriteria",
    "commonMistakes.0": "glass_control.mistakes.noInventory",
    "commonMistakes.1": "glass_control.mistakes.crackedDishes",
    "commonMistakes.2": "glass_control.mistakes.unprotectedLamps",
    "regulationRef": "glass_control.regulationRef"
  },
  "equipment_maintenance": {
    "summary": "equipment_maintenance.summary",
    "materials.0": "equipment_maintenance.materials.log",
    "materials.1": "equipment_maintenance.materials.passports",
    "materials.2": "equipment_maintenance.materials.contract",
    "materials.3": "equipment_maintenance.materials.reports",
    "completionCriteria": "equipment_maintenance.completionCriteria",
    "commonMistakes.0": "equipment_maintenance.mistakes.waitForFailure",
    "commonMistakes.1": "equipment_maintenance.mistakes.unqualifiedWork",
    "commonMistakes.2": "equipment_maintenance.mistakes.noLog",
    "regulationRef": "equipment_maintenance.regulationRef"
  },
  "equipment_calibration": {
    "summary": "equipment_calibration.summary",
    "materials.0": "equipment_calibration.materials.log",
    "materials.1": "equipment_calibration.materials.certificates",
    "materials.2": "equipment_calibration.materials.inventory",
    "steps.4.title": "equipment_calibration.steps.labelInstruments.title",
    "steps.4.detail": "equipment_calibration.steps.labelInstruments.body",
    "completionCriteria": "equipment_calibration.completionCriteria",
    "commonMistakes.0": "equipment_calibration.mistakes.unverifiedUse",
    "commonMistakes.1": "equipment_calibration.mistakes.selfVerification",
    "commonMistakes.2": "equipment_calibration.mistakes.noLabel",
    "regulationRef": "equipment_calibration.regulationRef"
  },
  "breakdown_history": {
    "summary": "breakdown_history.summary",
    "materials.0": "breakdown_history.materials.card",
    "materials.1": "breakdown_history.materials.contract",
    "materials.2": "breakdown_history.materials.reports",
    "completionCriteria": "breakdown_history.completionCriteria",
    "commonMistakes.0": "breakdown_history.mistakes.noCard",
    "commonMistakes.1": "breakdown_history.mistakes.undocumentedRepair",
    "regulationRef": "breakdown_history.regulationRef"
  },
  "metal_impurity": {
    "summary": "metal_impurity.summary",
    "materials.0": "metal_impurity.materials.log",
    "materials.1": "metal_impurity.materials.detector",
    "materials.2": "metal_impurity.materials.scales",
    "materials.3": "metal_impurity.materials.container",
    "steps.4.title": "metal_impurity.steps.recordFindings.title",
    "steps.4.detail": "metal_impurity.steps.recordFindings.body",
    "completionCriteria": "metal_impurity.completionCriteria",
    "commonMistakes.0": "metal_impurity.mistakes.dirtyMagnet",
    "commonMistakes.1": "metal_impurity.mistakes.ignoredLargeObject",
    "regulationRef": "metal_impurity.regulationRef"
  },
  "traceability_test": {
    "summary": "traceability_test.summary",
    "materials.0": "traceability_test.materials.log",
    "materials.1": "traceability_test.materials.invoices",
    "materials.2": "traceability_test.materials.productLogs",
    "materials.3": "traceability_test.materials.sales",
    "steps.4.title": "traceability_test.steps.recordResults.title",
    "steps.4.detail": "traceability_test.steps.recordResults.body",
    "completionCriteria": "traceability_test.completionCriteria",
    "commonMistakes.0": "traceability_test.mistakes.noTest",
    "commonMistakes.1": "traceability_test.mistakes.noBatchNumbers",
    "commonMistakes.2": "traceability_test.mistakes.fakeExercise",
    "regulationRef": "traceability_test.regulationRef"
  },
  "product_writeoff": {
    "summary": "product_writeoff.summary",
    "materials.0": "product_writeoff.materials.form",
    "materials.1": "product_writeoff.materials.register",
    "materials.2": "product_writeoff.materials.stamp",
    "materials.3": "product_writeoff.materials.scales",
    "steps.4.title": "product_writeoff.steps.fileReport.title",
    "steps.4.detail": "product_writeoff.steps.fileReport.body",
    "completionCriteria": "product_writeoff.completionCriteria",
    "commonMistakes.0": "product_writeoff.mistakes.noReport",
    "commonMistakes.1": "product_writeoff.mistakes.backdatedReport",
    "commonMistakes.2": "product_writeoff.mistakes.takingHome",
    "regulationRef": "product_writeoff.regulationRef"
  },
  "incoming_raw_materials_control": {
    "summary": "incoming_raw_materials_control.summary",
    "materials.0": "incoming_raw_materials_control.materials.log",
    "materials.1": "incoming_raw_materials_control.materials.invoices",
    "materials.2": "incoming_raw_materials_control.materials.certificates",
    "materials.3": "incoming_raw_materials_control.materials.thermometer",
    "materials.4": "incoming_raw_materials_control.materials.returnForm",
    "steps.4.title": "incoming_raw_materials_control.steps.acceptOrReturn.title",
    "steps.4.detail": "incoming_raw_materials_control.steps.acceptOrReturn.body",
    "completionCriteria": "incoming_raw_materials_control.completionCriteria",
    "commonMistakes.0": "incoming_raw_materials_control.mistakes.trustingWithoutMeasurement",
    "commonMistakes.1": "incoming_raw_materials_control.mistakes.noBatchRecord",
    "commonMistakes.2": "incoming_raw_materials_control.mistakes.noDeclaration",
    "regulationRef": "incoming_raw_materials_control.regulationRef"
  },
  "sanitary_day_control": {
    "summary": "sanitary_day_control.summary",
    "materials.0": "sanitary_day_control.materials.schedule",
    "materials.1": "sanitary_day_control.materials.log",
    "materials.2": "sanitary_day_control.materials.reports",
    "materials.3": "sanitary_day_control.materials.chemicals",
    "steps.4.title": "sanitary_day_control.steps.recordWork.title",
    "steps.4.detail": "sanitary_day_control.steps.recordWork.body",
    "completionCriteria": "sanitary_day_control.completionCriteria",
    "commonMistakes.0": "sanitary_day_control.mistakes.unrecordedWork",
    "commonMistakes.1": "sanitary_day_control.mistakes.tooInfrequent",
    "commonMistakes.2": "sanitary_day_control.mistakes.noGuestNotice",
    "regulationRef": "sanitary_day_control.regulationRef"
  },
  "audit_plan": {
    "summary": "audit_plan.summary",
    "materials.0": "audit_plan.materials.plan",
    "materials.1": "audit_plan.materials.auditors",
    "materials.2": "audit_plan.materials.checklists",
    "steps.4.title": "audit_plan.steps.approvePlan.title",
    "steps.4.detail": "audit_plan.steps.approvePlan.body",
    "completionCriteria": "audit_plan.completionCriteria",
    "commonMistakes.0": "audit_plan.mistakes.noPlan",
    "commonMistakes.1": "audit_plan.mistakes.selfAudit",
    "commonMistakes.2": "audit_plan.mistakes.noTrainingRecord",
    "regulationRef": "audit_plan.regulationRef"
  },
  "audit_protocol": {
    "summary": "audit_protocol.summary",
    "materials.0": "audit_protocol.materials.checklist",
    "materials.1": "audit_protocol.materials.form",
    "materials.2": "audit_protocol.materials.recordingTools",
    "materials.3": "audit_protocol.materials.camera",
    "steps.4.title": "audit_protocol.steps.signProtocol.title",
    "steps.4.detail": "audit_protocol.steps.signProtocol.body",
    "completionCriteria": "audit_protocol.completionCriteria",
    "commonMistakes.0": "audit_protocol.mistakes.noInspection",
    "commonMistakes.1": "audit_protocol.mistakes.noPhotos",
    "commonMistakes.2": "audit_protocol.mistakes.missingSignature",
    "regulationRef": "audit_protocol.regulationRef"
  },
  "audit_report": {
    "summary": "audit_report.summary",
    "materials.0": "audit_report.materials.protocol",
    "materials.1": "audit_report.materials.template",
    "materials.2": "audit_report.materials.register",
    "steps.4.title": "audit_report.steps.followUp.title",
    "steps.4.detail": "audit_report.steps.followUp.body",
    "completionCriteria": "audit_report.completionCriteria",
    "commonMistakes.0": "audit_report.mistakes.formalActions",
    "commonMistakes.1": "audit_report.mistakes.unverifiedClosure",
    "commonMistakes.2": "audit_report.mistakes.noManagementReport",
    "regulationRef": "audit_report.regulationRef"
  },
  "training_plan": {
    "summary": "training_plan.summary",
    "materials.0": "training_plan.materials.plan",
    "materials.1": "training_plan.materials.programmes",
    "materials.2": "training_plan.materials.staffList",
    "materials.3": "training_plan.materials.log",
    "steps.4.title": "training_plan.steps.approveAndMonitor.title",
    "steps.4.detail": "training_plan.steps.approveAndMonitor.body",
    "completionCriteria": "training_plan.completionCriteria",
    "commonMistakes.0": "training_plan.mistakes.paperOnlyPlan",
    "commonMistakes.1": "training_plan.mistakes.delayedNewStaffTraining",
    "commonMistakes.2": "training_plan.mistakes.noTrainingLog",
    "regulationRef": "training_plan.regulationRef"
  },
  "glass_items_list": {
    "summary": "glass_items_list.summary",
    "materials.0": "glass_items_list.materials.inventory",
    "materials.1": "glass_items_list.materials.marker",
    "steps.4.title": "glass_items_list.steps.updateInventory.title",
    "steps.4.detail": "glass_items_list.steps.updateInventory.body",
    "completionCriteria": "glass_items_list.completionCriteria",
    "commonMistakes.0": "glass_items_list.mistakes.staleInventory",
    "commonMistakes.1": "glass_items_list.mistakes.overlookedSmallItems",
    "commonMistakes.2": "glass_items_list.mistakes.noNumbers",
    "regulationRef": "glass_items_list.regulationRef"
  },
  "pest_control": {
    "summary": "pest_control.summary",
    "materials.0": "pest_control.materials.log",
    "materials.1": "pest_control.materials.contract",
    "materials.2": "pest_control.materials.reports",
    "materials.3": "pest_control.materials.tools",
    "steps.4.title": "pest_control.steps.followUpInspection.title",
    "steps.4.detail": "pest_control.steps.followUpInspection.body",
    "completionCriteria": "pest_control.completionCriteria",
    "commonMistakes.0": "pest_control.mistakes.noLog",
    "commonMistakes.1": "pest_control.mistakes.selfTreatment",
    "commonMistakes.2": "pest_control.mistakes.poisonBaitsIndoors",
    "commonMistakes.3": "pest_control.mistakes.missingReports",
    "regulationRef": "pest_control.regulationRef"
  },
  "ccp_monitoring": {
    "summary": "ccp_monitoring.summary",
    "materials.0": "ccp_monitoring.materials.haccpPlan",
    "materials.1": "ccp_monitoring.materials.instrument",
    "materials.2": "ccp_monitoring.materials.journal",
    "completionCriteria": "ccp_monitoring.completionCriteria",
    "commonMistakes.0": "ccp_monitoring.mistakes.wordsInsteadOfNumber",
    "commonMistakes.1": "ccp_monitoring.mistakes.nameMismatch",
    "commonMistakes.2": "ccp_monitoring.mistakes.releasedWithDeviation",
    "regulationRef": "ccp_monitoring.regulationRef"
  }
} as const satisfies Record<string, Readonly<Record<string, FillingGuideMessageKey>>>;

type SharedPointer = `steps.${number}.${"title" | "detail"}`;
type SharedKey = Parameters<WalkthroughTranslator>[0];

// Reuse the same typed semantic registry as walkthrough projection. Refactoring
// step order changes one registry; no text-based matching is performed at runtime.
export function getSharedFillingGuideCopyKeys(code: string): Readonly<Partial<Record<SharedPointer, SharedKey>>> {
  if (!Object.hasOwn(FILLING_GUIDE_WALKTHROUGH_COPY_KEYS, code)) return {};
  const prefixes = FILLING_GUIDE_WALKTHROUGH_COPY_KEYS[code as keyof typeof FILLING_GUIDE_WALKTHROUGH_COPY_KEYS];
  const keys: Partial<Record<SharedPointer, SharedKey>> = {};
  prefixes.forEach((prefix, index) => {
    keys[`steps.${index}.title`] = `${prefix}.title`;
    keys[`steps.${index}.detail`] = `${prefix}.body`;
  });
  return keys;
}

/** Copy only registered presentation leaves; preserve unregistered metadata. */
export function translateFillingGuideTree<T>(source: T, code: keyof typeof FILLING_GUIDE_COPY_KEYS, t: FillingGuideTranslators): T {
  const ownKeys: Readonly<Record<string, FillingGuideMessageKey>> = FILLING_GUIDE_COPY_KEYS[code];
  const sharedKeys: Readonly<Partial<Record<string, SharedKey>>> = getSharedFillingGuideCopyKeys(code);
  const pointers = [...Object.keys(ownKeys), ...Object.keys(sharedKeys)];
  function visit(value: unknown, pointer: string): unknown {
    if (pointer && !pointers.some(key => key === pointer || key.startsWith(`${pointer}.`))) return value;
    if (typeof value === "string") {
      if (Object.hasOwn(ownKeys, pointer)) return t.guide(ownKeys[pointer]);
      const shared = sharedKeys[pointer];
      return shared ? t.walkthrough(shared) : value;
    }
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${pointer}.${index}`));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, pointer ? `${pointer}.${key}` : key)]));
    }
    return value;
  }
  return visit(source, "") as T;
}
