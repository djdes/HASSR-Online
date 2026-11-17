/**
 * English page blocks for equipment, incident, pool, sterilization, medical
 * waste and internal audit journals (spec journal-page-content-i18n-2026-11).
 * Mirrors EQUIPMENT_PAGE_CONTENT one to one. Fine amounts follow the RF Code
 * of Administrative Offences as amended in November 2026.
 */

import type { JournalPageContent } from "../types";

const NOTE = "Amounts are based on the CAO RF as amended in November 2026.";

const FINE_6_6 =
  "Art. 6.6 of the CAO RF — breach of sanitary and epidemiological requirements for public catering: RUB 20,000 to 40,000 for legal entities, or suspension of operations for up to 90 days;";
const FINE_6_3 =
  "Art. 6.3 of the CAO RF — breach of the law on ensuring sanitary and epidemiological welfare: RUB 10,000 to 20,000 for legal entities, or suspension of operations for up to 90 days;";
const FINE_6_4 =
  "Art. 6.4 of the CAO RF — breach of sanitary and epidemiological requirements for the operation of premises, buildings, structures and equipment: RUB 10,000 to 20,000 for legal entities, or suspension of operations for up to 90 days;";
const FINE_14_43 =
  "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): RUB 20,000 to 30,000 for sole proprietors, RUB 100,000 to 300,000 for legal entities;";
const FINE_14_4 =
  "Art. 14.4 Part 1 of the CAO RF — provision of services of inadequate quality: RUB 20,000 to 30,000 for legal entities;";

export const EQUIPMENT_PAGE_CONTENT_EN: Record<string, JournalPageContent> = {
  equipment_maintenance: {
    sample: {
      caption:
        "This is what a month of records looks like: for each piece of equipment, the type of work, who did it, the result and the date of the next service. Scheduled maintenance and contractor work go into the same table.",
      columns: ["Date", "Equipment", "Work done", "Performed by", "Result", "Next service"],
      rows: [
        ["04.11.2026", "Combi steamer, hot kitchen", "Steam generator cleaned, door seal checked", "TekhServis LLC, Lebedev K. A.", "In working order, report No. 112", "04.02.2027"],
        ["06.11.2026", "Cold room No. 1, storeroom", "Condenser cleaned, refrigerant pressure checked", "Kholod-Servis LLC, Orlov P. S.", "In working order, report No. 87", "06.12.2026"],
        ["10.11.2026", "Dishwasher, washing area", "Filters replaced, rinse temperature checked", "Novikov D. V., technician", "In working order", "10.12.2026"],
        ["14.11.2026", "Meat grinder, meat section", "Knives and plates sharpened, gearbox lubricated", "Novikov D. V., technician", "In working order", "14.01.2027"],
        ["16.11.2026", "Extraction hood, hot kitchen", "Grease filters cleaned", "Kozlov A. A.", "One filter is bent — a new one has been ordered", "23.11.2026"],
      ],
    },
    sections: [
      {
        heading: "Who keeps maintenance records and who is responsible",
        paragraphs: [
          "Records are kept wherever product safety depends on equipment working properly: restaurants, canteens, bakeries, semi-finished product workshops, catering. The responsible person is appointed by order — usually the chief engineer, or the manager or head chef in a small café. They draw up the schedule, call in the service company and check that the work has been done.",
          "The entry is made by whoever did the work: the in-house technician or the contractor’s engineer. If the service company issues its own report, its number goes into the row and the report itself is kept alongside — so the inspector sees both the entry and the source document.",
        ],
      },
      {
        heading: "How to draw up a maintenance schedule",
        bullets: [
          "List all equipment with inventory numbers: cooking, refrigeration, mechanical, dishwashing, ventilation.",
          "Take the service interval for each item from the manufacturer’s data sheet or the service contract — do not guess.",
          "Flag critical equipment: everything that holds temperature (cold rooms, blast freezers, bain-maries) and everything that washes and disinfects.",
          "Spread the dates so that servicing does not fall at peak hours and does not take all refrigeration out of action at once.",
          "Have the schedule approved by management and update it whenever equipment is bought or written off.",
        ],
      },
      {
        heading: "What to do if maintenance is missed or a fault is found",
        paragraphs: [
          "Missed maintenance is no reason to rewrite the date. The row records that the work was not done and why: the engineer did not turn up, a spare part was missing. A new date is set straight away, and for critical equipment monitoring is stepped up in the meantime — for example, the cold room temperature is checked more often.",
          "If a fault is found during servicing, the equipment is taken out of use, tagged “Do not use”, and the entry states where the products were moved. The breakdown is transferred to the breakdown history card, and for a serious deviation a corrective action (CAPA) is opened: cause, measures, deadline and a check of the result.",
        ],
      },
      {
        heading: "What the inspector looks at",
        bullets: [
          "Whether the schedule matches the equipment actually in the kitchen and covers everything critical.",
          "Whether there are overdue dates with no note of the reason and the new date.",
          "Whether there are contractor reports for work marked as done.",
          "Whether the entries tally with other journals: if a cold room was serviced but its temperature has been out of range for weeks, both documents will raise questions.",
        ],
      },
      {
        heading: "Electronic maintenance records instead of paper",
        paragraphs: [
          "In WeSetup the schedule lives in the equipment card, and each item can carry a QR code: the engineer scans it with a phone, records the work done and attaches a photo of the report or the replaced part. The time of the entry is set automatically and edits are visible in the history. The responsible person gets a reminder before maintenance is due, sees overdue items, and before an inspection exports the schedule and records to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "The RF Code of Administrative Offences (CAO RF) has no fine for the lack of a maintenance schedule as such. But monitoring equipment is part of the HACCP procedures required by TR CU 021/2011: without records there is nothing to prove the equipment is in working order, and an inspector treats faulty equipment in use as a violation:",
      items: [FINE_6_4, FINE_6_6, FINE_14_43.replace(/;$/, ".")],
      note: `${NOTE} A faulty refrigerator or dishwasher usually brings claims about the products as well.`,
    },
  },

  breakdown_history: {
    sample: {
      caption:
        "This is the card of one cold room over a year: each breakdown is a separate row with symptoms, cause, repair, downtime and cost. Two refrigerant leaks already show that the fault keeps coming back.",
      columns: ["Date", "What was noticed", "Cause", "What was done", "Downtime", "Cost, RUB", "Performed by"],
      rows: [
        ["12.03.2026", "+9 °C in the cold room instead of +2…+6 °C", "Refrigerant leak at a joint", "Soldering, recharge", "6 h", "8,500", "Kholod-Servis LLC"],
        ["28.07.2026", "Compressor does not start", "Overheating, dirty condenser", "Condenser cleaned, relay replaced", "4 h", "5,200", "Kholod-Servis LLC"],
        ["15.09.2026", "Ice on the evaporator", "Torn door seal", "Door seal replaced", "2 h", "3,900", "Novikov D. V."],
        ["09.11.2026", "+10 °C in the cold room in the morning, products moved", "Repeat refrigerant leak", "Pipe section replaced, recharge", "9 h", "14,300", "Kholod-Servis LLC"],
      ],
    },
    sections: [
      {
        heading: "Why keep a breakdown history if there is a maintenance schedule",
        paragraphs: [
          "The maintenance schedule shows planned work; the breakdown card shows what did not go to plan. Together they give the full history of a piece of equipment: how often it failed and why, what the repairs cost and how many hours the kitchen worked without it. This is exactly the combination that internal and external HACCP auditors look at.",
          "A card is opened for each piece of critical equipment — cold rooms and refrigerated cabinets, blast freezers, combi steamers, dishwashers. It is best kept by whoever is responsible for equipment: the chief engineer, the manager or the head chef.",
        ],
      },
      {
        heading: "How to fill in the card after a repair",
        bullets: [
          "Record the date and how the breakdown was noticed: from the thermometer, by the sound, from a cook’s complaint.",
          "After diagnosis, enter the cause as stated by the engineer — not “it broke”, but the specific component.",
          "State what was done: repair, part replacement, temporary shutdown.",
          "Record the downtime and where products or the process were moved in the meantime.",
          "Enter the cost and the number of the contractor’s report or invoice.",
        ],
      },
      {
        heading: "Repair or replace: how to decide",
        paragraphs: [
          "The decision is based on facts, not gut feeling. Signs that it is time to think about replacement: the same cause keeps recurring, a year of repairs approaches the price of new equipment, downtime leads to products being written off. If a breakdown recurs, the card gets a link to a corrective action (CAPA) with a root cause analysis — otherwise the engineer will keep topping up the refrigerant every quarter.",
          "A summary of all cards also helps with the budget: it shows which section and which type of equipment cost the most.",
        ],
      },
      {
        heading: "What to do with products during a breakdown",
        paragraphs: [
          "The card is about the equipment, but it always needs a record of what happened to the products. If the cold room temperature went out of range, the responsible person estimates how long the products were affected and decides whether to release, reprocess or write them off. This is recorded in the incident journal or in a write-off report, and the card links to that entry.",
        ],
      },
      {
        heading: "An electronic equipment card instead of a folder of reports",
        paragraphs: [
          "In WeSetup the breakdown history is stored in the equipment card next to the maintenance schedule. An employee who notices a fault scans the QR code on the equipment and reports it from a phone with a photo; the responsible person is notified immediately, and the engineer later adds the cause and cost. Every edit is visible in the history, and the card for any period can be exported to PDF for the auditor.",
        ],
      },
    ],
    fines: {
      intro:
        "The breakdown history card is an internal HACCP document, and there is no separate fine for not having one. The risk lies elsewhere: without a record of failures, the inspector may conclude that the equipment control procedures required by TR CU 021/2011 have not been implemented — and faulty equipment in use is a violation in itself:",
      items: [FINE_6_4, FINE_14_43.replace(/;$/, ".")],
      note: NOTE,
    },
  },

  equipment_calibration: {
    sample: {
      caption:
        "This is the list of measuring instruments in a café with a deli counter: for each one, the serial number, location, verification date, expiry date and how verification is confirmed. The thermometer in cold room No. 1 is due to be sent for verification.",
      columns: ["Instrument", "Serial No.", "Where used", "Verified on", "Valid until", "Confirmation"],
      rows: [
        ["Electronic probe thermometer", "TP-30412", "Hot kitchen", "12.01.2026", "11.01.2027", "Entry in the FSIS “Arshin” registry"],
        ["Electronic retail scales", "0458731", "Deli checkout", "20.03.2026", "19.03.2027", "Arshin entry, certificate"],
        ["Refrigerator thermometer", "1123", "Cold room No. 1", "05.12.2025", "04.12.2026", "Entry in the FSIS “Arshin” registry"],
        ["Thermohygrometer", "TG-7781", "Dry goods store", "18.06.2026", "17.06.2027", "Entry in the FSIS “Arshin” registry"],
        ["Platform scales", "220917", "Goods receiving", "02.11.2026", "01.11.2027", "Arshin entry, verification mark"],
      ],
    },
    sections: [
      {
        heading: "Which instruments need verification",
        paragraphs: [
          "Verification is required for measuring instruments used in the field of state regulation of measurement uniformity, as set out in Federal Law No. 102-FZ. In catering and food production this mainly means scales used to weigh goods for customers, and thermometers, probe thermometers and thermohygrometers whose readings the business uses to show it complies with mandatory storage and cooking requirements.",
          "The instrument must be of an approved type, that is, listed in the Federal Information Fund for Ensuring the Uniformity of Measurements. A household thermometer without type approval cannot be verified, and its readings will not be accepted at an inspection. Instruments needed only for internal adjustment can simply be calibrated, but they are worth marking separately in the list.",
        ],
      },
      {
        heading: "How verification is confirmed today",
        paragraphs: [
          "A verification result is valid if it has been entered in the FSIS “Arshin” registry. A paper certificate is issued at the owner’s request, and a verification mark may be applied to the instrument itself. So it is convenient to keep not only the certificate number but also a link to the Arshin entry — the inspector can check the instrument in a minute on the Rosstandart website.",
          "The verification interval is not yours to choose: it is stated in the type description and in the same entry. The “valid until” date in your records must match it.",
        ],
      },
      {
        heading: "How to organise verification step by step",
        bullets: [
          "Compile a list of all measuring instruments with serial numbers and locations.",
          "Look up each instrument in the FSIS “Arshin” registry: the type is approved and verification is valid.",
          "Make an arrangement with an accredited verification body — often the regional centre for standardisation and metrology.",
          "Send instruments in turn so that a verified backup thermometer always stays on site.",
          "When an instrument comes back, enter the new date, expiry and link to the entry.",
        ],
      },
      {
        heading: "What to do if verification has expired or an instrument reads wrong",
        paragraphs: [
          "An instrument whose verification has expired is taken out of use immediately, not “at the end of the month”: its readings cannot be used in temperature journals. A verified backup instrument is put in its place and a note is made in the records. If a thermometer has been dropped, shows obviously wrong values or has a damaged seal, it is also withdrawn and sent for repair and unscheduled verification.",
          "Separately, review the entries made with this instrument after its verification expired: if they include critical values, the responsible person decides whether the products need to be assessed.",
        ],
      },
      {
        heading: "An electronic instrument list instead of a folder of certificates",
        paragraphs: [
          "In WeSetup each measuring instrument has its own card with the serial number, verification expiry, a photo of the certificate or a link to the Arshin entry. Expired and expiring instruments are highlighted in the list, the responsible person gets a reminder in advance, and the change history shows who updated the expiry date and when. The list can be exported to PDF for the inspector.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no fine for the list itself — the penalty is for using instruments without valid verification where it is mandatory. Besides, readings from such an instrument do not prove that temperature requirements were met, and entries in sanitary journals lose their evidential value:",
      items: [
        "Art. 19.19 of the CAO RF — breach of mandatory requirements for ensuring the uniformity of measurements, including the use of unverified measuring instruments; the fine depends on the part of the article and on who the offender is;",
        FINE_6_6.replace(/;$/, "."),
      ],
      note: `${NOTE} Check the amount of the fine under Art. 19.19 in the current version of the code.`,
    },
  },

  accident_journal: {
    sample: {
      caption:
        "This is what a month of incident records looks like: what happened, what was affected, what was done and what was decided about the products. Every row ends with a decision, not just a description.",
      columns: ["Date, time", "What happened", "Affected", "Action taken", "Decision on products", "Responsible"],
      rows: [
        ["02.11.2026, 06:40", "Cold room No. 2 switched off overnight, +11 °C in the morning", "Dairy products, 42 kg", "Products set aside, engineer called", "42 kg written off, report No. 37", "Ivanova M. P."],
        ["09.11.2026, 13:15", "Power cut for 1.5 h", "Hot kitchen, refrigerators", "Cooking stopped, cold room doors kept closed", "Released: no higher than +6 °C in the cold rooms", "Petrov S. A."],
        ["12.11.2026, 10:05", "Ceiling leak above the dry goods store", "Flour, 3 bags", "Bags removed, area cordoned off, building manager called", "3 bags written off, the rest released after inspection", "Ivanova M. P."],
        ["16.11.2026, 18:30", "No hot water", "Washing area", "Dishes washed with water heated in boilers, emergency service called", "Products not affected", "Petrov S. A."],
      ],
    },
    sections: [
      {
        heading: "What counts as an incident or emergency",
        paragraphs: [
          "This is where you record anything that falls outside normal operations and may affect product safety. The list is best set out in the HACCP programme so that staff do not have to decide each time whether to make an entry.",
        ],
        bullets: [
          "Refrigeration failure and temperature going out of the permitted range.",
          "Loss of electricity, cold or hot water, or ventilation.",
          "Leaks, blocked drains, flooding of the storeroom.",
          "Rodents or insects in the production area.",
          "Broken glass near open products, foreign objects in raw materials.",
        ],
      },
      {
        heading: "What to do in the first hours",
        bullets: [
          "Stop the hazardous process: halt cooking, keep refrigerators closed unless necessary, cordon off the area.",
          "Inform the person in charge — the head chef, production manager or general manager.",
          "Protect the products: move them to working equipment, set aside the suspect batch and label it “Do not use”.",
          "Record the facts: time of discovery, thermometer readings, photos.",
          "Call the service company or emergency service and record when the problem was fixed.",
        ],
      },
      {
        heading: "How to decide what happens to the products",
        paragraphs: [
          "The decision is made by the responsible person, not by whoever discovered the incident. It depends on the type of product, the temperature and the time out of range: chilled meat or dairy products left in the warm for several hours are not released, whereas dry goods after a leak can be released if the packaging is intact and dry. If safety cannot be assessed, the products are written off and the report number is entered in the incident row.",
        ],
      },
      {
        heading: "Root cause analysis and corrective actions",
        paragraphs: [
          "Dealing with the incident is only half the job. Next, the responsible person finds the cause and decides how to prevent a repeat: check the cold room alarm, install backup power for recording thermometers, arrange a roof repair. For major cases a corrective action (CAPA) is opened with an owner and a deadline, and the internal audit checks whether it has been completed.",
          "Repeated failures of the same equipment are transferred to the breakdown history card — this is an argument for deciding to replace it.",
        ],
      },
      {
        heading: "Electronic incident records instead of paper",
        paragraphs: [
          "In WeSetup an emergency can be reported from a phone: the employee photographs the thermometer or the leak, the time is set automatically, and the manager is notified in Telegram at once. The responsible person adds the actions and the decision on the products and links the entry to the write-off report and the CAPA. The edit history is kept, and entries for any period can be exported to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate article for not keeping an incident journal — it is an internal HACCP document. Liability arises from the consequences: if products from a refrigerator that failed ended up in dishes or on the shelf, that is a breach of sanitary requirements and of the technical regulation:",
      items: [FINE_6_6, FINE_14_43.replace(/;$/, ".")],
      note: `${NOTE} A record showing that the products were assessed and written off after the incident is the main argument in any dispute.`,
    },
  },

  inventory_condition: {
    sample: {
      caption:
        "This is what one inspection looks like: for each section, which utensils were checked, their condition and what was done with damaged items. Utensils in good condition can be recorded as a group; damaged ones are recorded item by item.",
      columns: ["Date", "Section", "Utensils", "Material", "Condition", "Action taken", "Responsible"],
      rows: [
        ["16.11.2026", "Cold kitchen", "“RV” and “CV” boards — 4 pcs.", "Plastic", "Good", "—", "Ivanova M. P."],
        ["16.11.2026", "Meat section", "“RM” board", "Plastic", "Crack along the edge, deep cuts", "Removed, replaced with a new one", "Ivanova M. P."],
        ["16.11.2026", "Hot kitchen", "Spatulas, ladles — 6 pcs.", "Stainless steel", "Good", "—", "Ivanova M. P."],
        ["16.11.2026", "Pastry section", "5 L container", "Food-grade plastic", "Chipped lid, fragment found", "Removed, disposed of", "Ivanova M. P."],
        ["16.11.2026", "Washing area", "Metal scourer", "Steel", "Coming apart", "Replaced with a plastic brush", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Who inspects utensils and who is responsible",
        paragraphs: [
          "The inspection is done by the head chef, sous-chef or shift lead — someone who knows all the utensils in the area. The responsible person and the frequency are set in the physical hazards procedure of the HACCP programme. A cook who notices a chip mid-shift does not wait for the scheduled inspection: they set the item aside at once and tell the responsible person, who makes the entry.",
        ],
      },
      {
        heading: "Signs that an item must be withdrawn",
        bullets: [
          "Chopping boards: deep cuts, cracks, delamination, chipped corners.",
          "Knives: chips and nicks on the blade, a loose or cracked handle.",
          "Plastic containers and lids: cracks, chips, warping from hot washing.",
          "Metal utensils: rust, peeling coating, burrs, missing rivets and screws.",
          "Sieves, whisks, graters: torn mesh, broken tines, loose wires.",
          "Glass and ceramic ware in production areas: chips and cracks.",
        ],
      },
      {
        heading: "How to inspect so that it does not become a formality",
        paragraphs: [
          "It helps to keep a list of utensils by section and work through it rather than from memory. The list is updated when items are bought or written off; otherwise the inspection quickly turns into ticking “all in order”. Colour coding of boards and knives makes it easier to spot when an item from one section has ended up in another.",
          "If damage is found on an item that has already been used, the responsible person checks the products prepared with it that day: if there is a risk of fragments or shavings getting in, they are not served.",
        ],
      },
      {
        heading: "If a piece has broken off and cannot be found",
        paragraphs: [
          "The most dangerous situation is when a piece is missing from a knife or container and nobody knows where it is. Work in the area is stopped, and the work surfaces, containers and products nearby are inspected. A fragment that is found is recorded; one that is not found is a reason to hold back products from that area. The case is recorded as an emergency, and if it happens again a corrective action is opened: change the material, the supplier or the washing procedure.",
        ],
      },
      {
        heading: "Electronic utensil inspections instead of paper",
        paragraphs: [
          "In WeSetup the list of utensils by section is loaded once, and during an inspection the responsible person marks only deviations from a phone, attaching a photo of the damage. A reminder arrives on the schedule set in the HACCP programme, the time is recorded automatically, and corrections are visible in the history. Before an audit the records can be exported to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for not keeping this journal — it is an internal HACCP procedure. But TR CU 021/2011 requires product safety to be ensured at every stage, and without records there is nothing to show that physical hazards are controlled. A foreign object in a dish is a direct violation:",
      items: [FINE_14_43, FINE_6_6.replace(/;$/, ".")],
      note: NOTE,
    },
  },

  pool_water_control: {
    sample: {
      caption:
        "This is what one day of records looks like at a fitness centre with two pools: a reading before opening and readings during the day, each with temperature, chlorine, pH and the number of visitors since the previous reading. The rows show how the visitor load affects combined chlorine.",
      columns: ["Date, time", "Pool", "Water, °C", "Free chlorine, mg/L", "Combined chlorine, mg/L", "pH", "Visitors", "Responsible"],
      rows: [
        ["16.11.2026, 07:00", "Main", "27.0", "0.4", "0.1", "7.4", "—", "Kuznetsov D. I."],
        ["16.11.2026, 12:00", "Main", "27.5", "0.5", "0.2", "7.3", "48", "Kuznetsov D. I."],
        ["16.11.2026, 17:00", "Main", "27.5", "0.4", "0.2", "7.5", "63", "Kuznetsov D. I."],
        ["16.11.2026, 07:10", "Children’s", "30.0", "0.3", "0.1", "7.4", "—", "Kuznetsov D. I."],
        ["16.11.2026, 13:00", "Children’s", "30.5", "0.4", "0.2", "7.2", "21", "Kuznetsov D. I."],
      ],
    },
    sections: [
      {
        heading: "Who takes the readings and who is responsible",
        paragraphs: [
          "In fitness centres, hotels, spas and children’s centres, readings are taken by the water treatment operator or pool technician, or, where there is none, by a trained administrator. The person responsible for water quality is appointed by order: they check the entries and decide to close the pool if a value is out of range.",
          "Requirements for operating pools are set by SP 2.1.3678-20, and the permitted values and the frequency of readings for a specific site are written into the production control programme. That is what the inspector compares the entries with.",
        ],
      },
      {
        heading: "In-house readings and laboratory testing",
        paragraphs: [
          "The journal entries are routine monitoring that staff carry out themselves with a test kit or photometer. They do not replace laboratory testing: samples for microbiological and chemical parameters are taken by an accredited laboratory at the frequency set in the production control programme. Laboratory reports are kept with the journal — the inspector compares them with the daily figures.",
          "Reagents and test strips must be within their shelf life and the instrument must be in working order, otherwise the figures in the journal prove nothing.",
        ],
      },
      {
        heading: "How to take readings so that the figures are honest",
        bullets: [
          "Take the sample from the same spot every time, below the surface, not at the surface near the chemical inlet.",
          "Measure free and combined chlorine with the same instrument and record the result straight away.",
          "Take the first reading before visitors are let in and the next ones at peak times.",
          "Record the number of visitors between readings: combined chlorine usually rises with the load.",
          "Do not round values “into the norm”: an entry with a deviation and the action taken is worth more than a perfect row of figures.",
        ],
      },
      {
        heading: "What to do if a value is out of range",
        paragraphs: [
          "In case of a deviation, the responsible person adjusts chemical dosing, checks filtration and recirculation, adds fresh water if needed and repeats the reading. If the values do not return to the standard, the pool is closed until the problem is fixed, and the closing and reopening times are recorded. Recurring deviations are a reason to check the water treatment equipment and record a corrective action with an owner and a deadline.",
        ],
      },
      {
        heading: "Electronic pool water records instead of paper",
        paragraphs: [
          "In WeSetup the technician enters a reading from a phone right at the poolside, and the time is set automatically. The reading frequency from the production control programme is set in the document settings, and a reminder arrives if a reading is missed. Corrections are kept in the history, a photo of the test kit can be attached to an entry, and the journal for any period can be exported to PDF for the inspector.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for not keeping the journal, but without it the site cannot prove production control of water quality. The inspector records a breach of sanitary requirements for operating a pool, and a visitor harmed by poor-quality water is entitled to claim compensation:",
      items: [FINE_6_4, FINE_6_3, FINE_14_4.replace(/;$/, ".")],
      note: NOTE,
    },
  },

  instrument_sterilization: {
    sample: {
      caption:
        "This is what a working day of records looks like at a salon with manicure and cosmetology rooms: each load is a separate row with the method, cycle and indicator result. A repeat sterilization after a failed indicator also stays in the journal.",
      columns: ["Date, time", "Instruments", "Method", "Cycle", "Indicator", "Sterilizer", "Responsible"],
      rows: [
        ["16.11.2026, 09:10", "Nippers — 3 pcs., pushers — 2 pcs.", "Dry heat", "180 °C, 60 min", "Passed", "GP-20 dry-heat sterilizer", "Smirnova O. N."],
        ["16.11.2026, 12:40", "Scissors — 2 pcs., nippers — 2 pcs.", "Dry heat", "180 °C, 60 min", "Failed", "GP-20 dry-heat sterilizer", "Smirnova O. N."],
        ["16.11.2026, 14:00", "Same load — repeated", "Dry heat", "180 °C, 60 min", "Passed", "GP-20 dry-heat sterilizer", "Smirnova O. N."],
        ["16.11.2026, 16:30", "Tweezers — 4 pcs., clamps — 2 pcs.", "Steam", "132 °C, 20 min", "Passed", "GK-10 autoclave", "Petrova A. S."],
      ],
    },
    sections: [
      {
        heading: "Who sterilizes and who is responsible",
        paragraphs: [
          "Sterilization records are needed by beauty salons offering manicure, pedicure and cosmetology, tattoo and piercing studios, medical and dental practices — anywhere an instrument may break the skin or mucous membranes. Sterilization is carried out by a trained technician or nurse, and the responsible person is appointed by the manager. If sterilization is outsourced under a contract, the salon keeps the documents on handing over and receiving back the instruments.",
        ],
      },
      {
        heading: "What must happen before loading the sterilizer",
        paragraphs: [
          "Sterilization is the final stage of processing. Before it, instruments go through disinfection and pre-sterilization cleaning: traces of blood, grease and detergent get in the way of the sterilizing agent. Cleaning quality is spot-checked with tests such as the azopyram test — the procedure is set by the production control programme and the instructions for the products used.",
          "After the cycle, instruments are stored in their packaging or in a sterile area; the storage time depends on the type of packaging and is stated in its instructions. The pouch is opened in front of the client — the best proof that the instrument has been processed.",
        ],
      },
      {
        heading: "How to fill in the row for a load",
        bullets: [
          "Time of loading — together with the cycle, it shows that the full cycle was completed.",
          "List of instruments with quantities; if a technician has their own set, say so.",
          "Method and cycle — exactly as in the instructions for the sterilizer and packaging material, no “roughly”.",
          "Indicator result: passed or failed; used indicators are easy to stick in or photograph.",
          "The sterilizer and the surname of whoever ran the cycle.",
        ],
      },
      {
        heading: "If an indicator fails or the sterilizer malfunctions",
        paragraphs: [
          "If an indicator has not changed colour, the whole load is treated as non-sterile: the instruments are repackaged and sterilized again, and both rows stay in the journal. If the repeat cycle also fails, the sterilizer is taken out of use until it has been checked by a service engineer, and appointments continue with a spare set or single-use instruments.",
          "The sterilizer itself undergoes maintenance and performance checks at the intervals set by the manufacturer’s instructions and the production control programme — these documents are also kept with the journal.",
        ],
      },
      {
        heading: "Electronic sterilization records instead of paper",
        paragraphs: [
          "In WeSetup methods and cycles are picked from a list set up for your sterilizers, the time of the entry is set automatically, and a photo of the indicator can be attached to the row. The manager sees the day’s cycles across all rooms, edits are kept in the history, and the journal is exported to PDF in the same layout as the paper form.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate article for not keeping the journal. But without records the salon cannot prove that instruments are sterilized in line with SanPiN 2.1.3678-20, and the inspector records a breach of sanitary requirements. If a client gets an infection or complication, liability for a poor-quality service is added:",
      items: [FINE_6_3, FINE_6_4, FINE_14_4.replace(/;$/, ".")],
      note: NOTE,
    },
  },

  medical_waste_b: {
    sample: {
      caption:
        "This is what a week of records looks like at a cosmetology practice: type of waste, weight, decontamination, packaging and who it was handed to. Handover to the collection company is confirmed by a report number.",
      columns: ["Date", "Type of waste", "Weight, kg", "Decontamination", "Packaging", "Handed over", "Responsible"],
      rows: [
        ["10.11.2026", "Cotton pads, wipes, gloves", "0.8", "Disinfectant solution, 60 min", "Yellow bag", "EkoVyvoz LLC, report No. 41", "Smirnova O. N."],
        ["10.11.2026", "Needles, blades", "0.2", "Disinfectant solution, 60 min", "Yellow sharps container", "EkoVyvoz LLC, report No. 41", "Smirnova O. N."],
        ["13.11.2026", "Syringes without needles, gloves", "0.6", "Disinfectant solution, 60 min", "Yellow bag", "Stored until collection", "Smirnova O. N."],
        ["16.11.2026", "Mesotherapy needles", "0.1", "Disinfectant solution, 60 min", "Yellow sharps container", "Stored until collection", "Petrova A. S."],
      ],
    },
    sections: [
      {
        heading: "Who keeps the records and who is responsible",
        paragraphs: [
          "Class B waste records are kept by medical centres, dental practices, treatment and cosmetology rooms, and salons offering injections — anywhere that produces materials contaminated with blood and body fluids. The manager appoints a person responsible for waste handling and approves a scheme: where each type of waste arises, how it is collected and decontaminated, and where it is stored until collection. Entries are made by whoever packed the waste, and the responsible person checks them before handover.",
        ],
      },
      {
        heading: "How to collect and pack Class B waste",
        bullets: [
          "Waste is collected where it arises in single-use yellow bags or containers, and sharps in puncture-proof containers.",
          "Bags and containers are filled no more than three-quarters full and closed so that the contents cannot spill.",
          "The packaging is marked “Waste. Class B” with the organisation’s name, the department, the date and the surname of the responsible person.",
          "Waste must not be transferred from one container to another.",
          "Closed packaging is stored until collection in a designated place out of reach of visitors, within the time limits of SanPiN 2.1.3684-21.",
        ],
      },
      {
        heading: "Decontamination: on site or by the collection company",
        paragraphs: [
          "This waste is decontaminated by a chemical or physical method — either where it arises or centrally by a specialist company. The chosen method is fixed in the waste handling scheme. If the practice decontaminates the waste itself, the journal states the method and the product, with exposure time and concentration taken from the disinfectant’s instructions. If the collection company decontaminates it, this is written into the contract and noted at handover.",
        ],
      },
      {
        heading: "Handover for collection and documents",
        paragraphs: [
          "Collection is carried out by a company under contract. Each handover is confirmed by a report or waybill with the date and weight; the document number is entered in the journal and the documents are kept with it. The inspector compares the weights in the journal with the reports: large discrepancies or long periods without collection will raise questions.",
          "If a bag tears or an employee gets a needlestick injury, staff follow the organisation’s approved emergency instructions and make a separate entry.",
        ],
      },
      {
        heading: "Electronic medical waste records instead of paper",
        paragraphs: [
          "In WeSetup the responsible person records packed waste from a phone: the type, decontamination method and packaging are picked from a list, and the date and time are set automatically. At handover a photo of the collection report is attached to the entries, the edit history is kept, and the journal together with the reports for any period can be exported to PDF for an inspection.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate article for not keeping the journal. But without records the organisation cannot show that Class B waste is collected, decontaminated and handed over in line with SanPiN 2.1.3684-21 — the inspector records a breach of sanitary requirements:",
      items: [FINE_6_3, FINE_6_4.replace(/;$/, ".")],
      note: `${NOTE} Collection reports do not replace the journal: they contain no information on collection and decontamination at the source.`,
    },
  },

  audit_plan: {
    sample: {
      caption:
        "This is the annual internal audit plan of a small production site: each audit has a scope, a date, auditors and criteria. The status column shows what has already been done and what is still ahead.",
      columns: ["No.", "Audit scope", "Due", "Auditors", "Criteria", "Status"],
      rows: [
        ["1", "Receiving and storage of raw materials", "February 2026", "Sokolova N. V.", "Incoming inspection procedure, PRPs", "Completed 18.02.2026"],
        ["2", "Hot kitchen, cooking CCP", "April 2026", "Sokolova N. V., Petrov S. A.", "HACCP plan, CCP worksheets", "Completed 21.04.2026"],
        ["3", "Washing, cleaning, disinfection", "June 2026", "Petrov S. A.", "Sanitation procedures, cleaning schedules", "Completed 16.06.2026"],
        ["4", "Traceability and product recall", "September 2026", "Sokolova N. V.", "Traceability procedure", "Completed 22.09.2026"],
        ["5", "Staff training and hygiene", "November 2026", "Petrov S. A.", "Training programme, PRPs", "Scheduled for 24.11.2026"],
        ["6", "HACCP system as a whole", "December 2026", "Sokolova N. V., external consultant", "GOST R ISO 22000-2019", "Planned"],
      ],
    },
    sections: [
      {
        heading: "Who draws up and approves the plan",
        paragraphs: [
          "The plan is drawn up by the HACCP team leader or the technologist and approved by the head of the business. GOST R ISO 22000-2019 requires internal audits at planned intervals to confirm that the food safety management system meets the requirements of the organisation and of the standard and is working effectively. How often each area is audited is up to the organisation, taking into account the importance of the processes, changes and the results of previous audits.",
        ],
      },
      {
        heading: "How to draw up the plan step by step",
        bullets: [
          "List every area of the system: receiving, storage, each production section, washing and cleaning, training, traceability, complaint handling.",
          "Mark the areas where there were changes, complaints or nonconformities during the year — these are audited earlier and more often.",
          "Define the criteria for each area: prerequisite programmes, the HACCP plan, procedures, TR CU 021/2011 requirements.",
          "Assign auditors so that nobody audits their own work.",
          "Spread the audits over the year, avoiding seasonal peaks, and leave time for the final review.",
        ],
      },
      {
        heading: "Who to appoint as auditors",
        paragraphs: [
          "An auditor must understand the process and judge by facts, not by what they are told. In a small business this is the technologist, the chef of a neighbouring section or a manager trained in internal auditing. The key rule is independence: the hot kitchen chef does not audit the hot kitchen. If there are not enough people in-house, some audits can be given to an external consultant.",
        ],
      },
      {
        heading: "If an audit is postponed or an unscheduled one is needed",
        paragraphs: [
          "The plan is a working document. A postponement is noted with the reason and the new date; the row is not deleted. An unscheduled audit is added after a serious nonconformity, a consumer complaint, or a change of supplier or technology — with a note of the reason. If an area keeps being put off all year, that in itself is a finding for the management review.",
        ],
      },
      {
        heading: "What an external auditor looks at",
        paragraphs: [
          "During certification or an audit by a major customer, the auditor compares the plan with what actually happened: whether all processes are covered, whether audits were carried out on time, and whether each has a record, a report and closed corrective actions. A plan without records and records without a plan look equally weak.",
        ],
      },
      {
        heading: "An electronic audit plan instead of a spreadsheet",
        paragraphs: [
          "In WeSetup the plan is linked to audit records and reports: the auditor gets a reminder when an audit is due, the record is filled in from a phone right in the production area, and nonconformities become CAPA tickets with an owner and a deadline. The plan’s change history is kept, and the plan, records and reports can be exported to PDF for an external auditor.",
        ],
      },
    ],
    fines: {
      intro:
        "The internal audit plan is a management system document under GOST R ISO 22000-2019, and that standard is voluntary: the CAO RF has no fine for not having a plan. It matters for certification and for retail chain requirements. At the same time, TR CU 021/2011 requires procedures based on HACCP principles to be implemented, and without regular checks the inspector may consider them not implemented:",
      items: [FINE_14_43.replace(/;$/, ".")],
      note: `${NOTE} For a certification body, the lack of a plan is a nonconformity that stands in the way of obtaining or renewing a certificate.`,
    },
  },

  audit_protocol: {
    sample: {
      caption:
        "This is the record of one audit of the hot and cold kitchens: each observation comes with a criterion, a fact and an assessment. Nonconformities get a corrective action number straight away.",
      columns: ["No.", "What was checked", "Observation and evidence", "Assessment", "CAPA"],
      rows: [
        ["1", "Hot holding at the pass under the HACCP plan", "Reading at 12:20 — +72 °C, CCP records for the week complete", "Conforms", "—"],
        ["2", "Labelling of semi-finished products in the refrigerator", "3 containers without a production date, photos 2–4", "Minor nonconformity", "CAPA-58"],
        ["3", "Probe thermometer verification", "Verification expired 04.11.2026, probe still in use", "Major nonconformity", "CAPA-59"],
        ["4", "Colour coding of chopping boards", "All boards in their areas, no damage", "Conforms", "—"],
        ["5", "Staff response to a CCP deviation", "Cook Kozlov A. A. described the procedure correctly", "Positive observation", "—"],
      ],
    },
    sections: [
      {
        heading: "Who writes the record and who signs it",
        paragraphs: [
          "The record is written by the auditor during the audit or immediately afterwards — from their notes, not from memory a week later. It is signed by the auditor and the head of the audited area: their signature does not mean agreement with every assessment, only that they have been informed of the results. Disagreements are written down, not settled verbally.",
        ],
      },
      {
        heading: "How to word a nonconformity",
        paragraphs: [
          "A good wording has three parts: the requirement, the fact and the evidence. Not “the refrigerator is a mess”, but “in the cold kitchen refrigerator, three containers of semi-finished products have no production date — the labelling procedure was not followed, photos 2–4”. Such an entry is hard to dispute, and it is clear what needs fixing.",
        ],
        bullets: [
          "State the document or procedure you compared against.",
          "Write specific facts: place, time, quantity, surname, entry number.",
          "Distinguish major nonconformities (the procedure does not work, product safety is at risk) from minor ones (a one-off lapse).",
          "Record positive observations too — they show the audit was not just about finding mistakes.",
        ],
      },
      {
        heading: "How to collect evidence on site",
        paragraphs: [
          "The auditor relies on three sources: documents and records, observing work, and talking to staff. Comparing them yields the most valuable findings: the journal shows a perfect temperature, but the thermometer in the cold room reads something else; the washing procedure is written down, but the employee describes it differently. Photos, entry numbers and reading times go into the record straight away.",
        ],
      },
      {
        heading: "What happens after the record",
        paragraphs: [
          "For each nonconformity, the head of the area proposes, within the agreed time, a correction (an immediate fix) and a corrective action (removing the cause), and the auditor or the HACCP team leader checks the result. Until the action has been verified, the nonconformity stays open. The results of all audit records for the period are summarised in a report for management, and recurring findings are taken into account in the next audit plan.",
        ],
      },
      {
        heading: "An electronic audit record instead of a paper checklist",
        paragraphs: [
          "In WeSetup the auditor works through the checklist from a phone right in the production area and attaches a photo to each item; the time and author are recorded automatically. Whoever owns a corrective action gets deadline reminders, and the status of each nonconformity is visible until it is closed. The record is exported to PDF, and its data flows into the final report.",
        ],
      },
    ],
    fines: {
      intro:
        "The internal audit record is a system document under GOST R ISO 22000-2019, and the CAO RF has no fine for not having one. It is needed for certification and as proof that the HACCP procedures required by TR CU 021/2011 are not only written but also checked. If an audit found violations and they were left uncorrected, liability arises for the violations themselves:",
      items: [FINE_14_43, FINE_6_6.replace(/;$/, ".")],
      note: `${NOTE} A nonconformity found and closed by your own audit is better than the same one in an inspection report.`,
    },
  },

  audit_report: {
    sample: {
      caption:
        "This is the summary table of the 2026 report: for each audit, the number of major and minor nonconformities, how many are closed, and the overall assessment of the area. The conclusions and recommendations follow the table.",
      columns: ["Audit", "Area", "Major", "Minor", "Closed", "Assessment"],
      rows: [
        ["No. 1, 18.02.2026", "Storage and receiving", "0", "2", "2 of 2", "Conforms"],
        ["No. 2, 21.04.2026", "Hot kitchen", "1", "3", "4 of 4", "Conforms after correction"],
        ["No. 3, 16.06.2026", "Washing and cleaning", "0", "1", "1 of 1", "Conforms"],
        ["No. 4, 22.09.2026", "Traceability", "1", "0", "1 of 1", "Conforms after correction"],
        ["No. 5, 12.11.2026", "Cold and hot kitchens", "1", "2", "1 of 3", "Needs monitoring"],
      ],
    },
    sections: [
      {
        heading: "Who the report is for and who prepares it",
        paragraphs: [
          "The report is prepared by the HACCP team leader or the lead auditor and addressed to the company’s management. Audit records show the details of each audit, while the report answers the director’s questions: is the system working, where are the weak spots, are there enough resources, what should change next year. Under GOST R ISO 22000-2019, internal audit results are an input to the management review.",
        ],
      },
      {
        heading: "What to include in the report",
        bullets: [
          "The period and the list of audits carried out compared with the plan, with reasons for any postponements.",
          "A summary of nonconformities by area and category, and recurring findings.",
          "The status of corrective actions: closed, in progress, overdue.",
          "An overall assessment of the system’s effectiveness and changes compared with the previous period.",
          "Recommendations: training, repair or replacement of equipment, changes to procedures and the HACCP plan.",
        ],
      },
      {
        heading: "How to draw conclusions rather than just count",
        paragraphs: [
          "The number of nonconformities means little on its own: a rise may simply mean the auditors have become more thorough. It is more useful to look at where findings recur, how long closing them takes, and whether closed problems come back. For example, expired thermometer verification at three audits in a row is a sign that what is needed is not another reprimand but a verification schedule with reminders. Conclusions like these become the recommendations.",
        ],
      },
      {
        heading: "Management decisions based on the results",
        paragraphs: [
          "A report only makes sense if decisions are taken on it. The director records them in writing: what resources to allocate, who to train, which procedures to revise, which areas to audit more often next year. These decisions form the basis of the new audit plan and the HACCP plan update, and their implementation is checked at the next review.",
        ],
      },
      {
        heading: "An electronic report instead of a manual summary",
        paragraphs: [
          "In WeSetup the summary of nonconformities and the status of corrective actions are pulled from audit records and CAPA tickets, so the responsible person only has to write the conclusions and recommendations. The report for any period can be exported to PDF for management, an external auditor or a customer, and the change history shows who edited the data and when.",
        ],
      },
    ],
    fines: {
      intro:
        "The internal audit report is a management system document under GOST R ISO 22000-2019. There is no fine for not having one: the standard is voluntary, and the report is needed above all for certification, retail chain requirements and running the business. The risk appears when, without analysing the results, the HACCP procedures required by TR CU 021/2011 stop working in practice:",
      items: [FINE_14_43.replace(/;$/, ".")],
      note: NOTE,
    },
  },
};
