import type { JournalPageContent } from "../types";

const FINE_6_6 =
  "Art. 6.6 of the CAO RF — violation of sanitary and epidemiological requirements for public catering: for legal entities RUB 20,000 to 40,000 or suspension of activities for up to 90 days;";
const FINE_6_3 =
  "Art. 6.3 of the CAO RF — violation of legislation on the sanitary and epidemiological welfare of the population: for legal entities RUB 10,000 to 20,000 or suspension of activities for up to 90 days;";
const FINE_6_4 =
  "Art. 6.4 of the CAO RF — violation of sanitary and epidemiological requirements for the operation of premises, buildings and equipment: for legal entities RUB 10,000 to 20,000 or suspension of activities for up to 90 days;";
const FINE_14_43 =
  "Art. 14.43 of the CAO RF — violation of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000;";
const FINE_5_27_1 =
  "Art. 5.27.1, Part 1 of the CAO RF — violation of occupational safety requirements: for officials and sole proprietors RUB 2,000 to 5,000, for legal entities RUB 50,000 to 80,000;";
const FINE_8_2 =
  "Art. 8.2, Part 1 of the CAO RF — violation of waste management requirements: for legal entities RUB 100,000 to 250,000 or suspension of activities for up to 90 days;";
const FINE_14_4 =
  "Art. 14.4, Part 1 of the CAO RF — sale of goods, performance of work or provision of services of inadequate quality: for legal entities RUB 20,000 to 30,000;";

/** The last item of a fines list ends with a full stop instead of ";". */
function finesList(...items: string[]): string[] {
  return items.map((item, index) => (index === items.length - 1 ? item.replace(/;$/, ".") : item));
}

const NOTE = "Amounts are based on the CAO RF as amended in November 2026.";

export const SANITARY_PAGE_CONTENT_EN: Record<string, JournalPageContent> = {
  climate_control: {
    sample: {
      caption:
        "Two days of entries: for each room, a morning and an evening reading of temperature and relative humidity. Where a reading is out of range, the row says what was done and who checked the result.",
      columns: ["Date", "Room", "Time", "Temperature, °C", "Humidity, %", "Action on deviation", "Responsible"],
      rows: [
        ["10.11.2026", "Dry goods store", "08:00", "+18", "58", "—", "Petrova A. S."],
        ["10.11.2026", "Dry goods store", "19:00", "+19", "61", "—", "Petrova A. S."],
        ["10.11.2026", "Vegetable store", "08:05", "+9", "88", "—", "Petrova A. S."],
        ["11.11.2026", "Dry goods store", "08:00", "+18", "76", "Ventilation switched on, flour bags moved up onto a rack; 62% at 11:00", "Petrova A. S., Ivanova M. P."],
        ["11.11.2026", "Hot kitchen", "12:30", "+27", "55", "—", "Kozlov A. A."],
      ],
    },
    sections: [
      {
        heading: "Where temperature and humidity must be monitored",
        paragraphs: [
          "Readings are taken in every room where raw materials and finished products are stored — dry goods stores, vegetable stores, pantries with canned goods and drinks — and in the production areas. Storage conditions are set by the manufacturer on the label, SanPiN 2.3/2.4.4282-26 requires them to be met, and TR CU 021/2011 requires this to be documented as part of the production control programme.",
          "Cafes and canteens usually need two or three points: the dry store, the vegetable store and the hot kitchen. Production sites and wholesale warehouses need more — one for each storage zone with its own conditions.",
        ],
      },
      {
        heading: "What instruments to use",
        bullets: [
          "A thermometer and a hygrometer (or psychrometer) in every monitored room, mounted on a wall away from doors, radiators and air vents.",
          "Instruments with valid verification: an inspector may refuse to accept readings from an unverified hygrometer.",
          "Take the room’s limits from the label of the most demanding product in storage and write them in the journal header so staff can see the acceptable range at a glance.",
        ],
      },
      {
        heading: "What to do when a reading is out of range",
        paragraphs: [
          "Record the deviation straight away instead of correcting it to a “normal” value. Then work through the steps: find the cause (a door left open, ventilation switched off, a leak, a radiator next to the shelving), fix it, move sensitive products to a suitable room and repeat the reading in one to two hours. If a product has been stored outside its conditions for a long time, the person responsible for production control decides whether it can be used, and a doubtful batch is set aside and labelled.",
        ],
      },
      {
        heading: "Common mistakes inspectors find",
        bullets: [
          "The same figures every day — a sign that entries are written “from memory”.",
          "Humidity is not measured at all, even though flour, cereals or vegetables are stored.",
          "A deviation is recorded but the action column is empty.",
          "The instrument hangs above cooking equipment or next to the entrance door.",
        ],
      },
      {
        heading: "Electronic climate records",
        paragraphs: [
          "In WeSetup readings are entered from a phone via a QR code on the storeroom wall, the time is set automatically, and an out-of-range value is highlighted and requires the action taken to be described. If the room has a temperature and humidity sensor, entries appear on their own and the manager is notified when the range is exceeded. Corrections are kept in the history, and the journal exports to PDF in the layout of the printed form.",
        ],
      },
    ],
    fines: {
      intro:
        "The CAO RF has no separate article for missing records of this kind. But an inspector treats a breach of storage conditions as a violation of sanitary requirements and of the technical regulation:",
      items: finesList(FINE_6_6, FINE_6_3, FINE_14_43),
      note: NOTE,
    },
  },

  cold_equipment_control: {
    sample: {
      caption:
        "One shift of entries for refrigerators and freezers: the required range, morning and evening readings and the action taken if the temperature went out of range. Readings are taken from a reference thermometer inside the unit.",
      columns: ["Date", "Equipment", "Range, °C", "Morning, °C", "Evening, °C", "Action on deviation", "Responsible"],
      rows: [
        ["12.11.2026", "Refrigerator No. 1, dairy products", "+2…+6", "+4", "+5", "—", "Smirnova E. V."],
        ["12.11.2026", "Cold room No. 2, chilled meat", "0…+4", "+2", "+3", "—", "Smirnova E. V."],
        ["12.11.2026", "Chest freezer No. 3", "−18 or below", "−20", "−19", "—", "Smirnova E. V."],
        ["12.11.2026", "Refrigerated counter, cold kitchen", "+2…+6", "+5", "+9", "Door seal replaced, products moved to refrigerator No. 1; +5 at 20:30", "Smirnova E. V., Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Who is responsible for refrigeration equipment",
        paragraphs: [
          "The journal form is given in Appendix No. 2 to SanPiN 2.3/2.4.4282-26, so everyone who stores perishable food keeps it: cafes, canteens, school and hospital kitchens, confectioners, shops with a deli counter. A responsible person is appointed by order — usually the head chef, storekeeper or senior cook on shift. They take the readings and sign, and the production manager reviews the entries once a week.",
        ],
      },
      {
        heading: "How to take readings correctly",
        bullets: [
          "Read a separate thermometer inside the unit, not just the display: the built-in sensor shows the air temperature near the evaporator.",
          "Keep the thermometer on a middle shelf, away from the door and not pressed against the wall.",
          "Take the reading before the unit is fully loaded and not right after the door has been opened.",
          "Set the range according to the product stored: it is stricter for chilled meat than for vegetables.",
          "Give each unit a number that matches the sticker on its casing.",
        ],
      },
      {
        heading: "If the temperature goes out of range",
        paragraphs: [
          "Check the obvious first: is the door closed, is the seal intact, is the evaporator iced up, is the unit overloaded with warm food? Then move the products to working equipment, call the service company and repeat the reading. Products that stayed warm for a long time are assessed by the responsible person: they can be sent for heat treatment or written off with a report. Note all of this briefly in the action column — the inspector cares more about seeing a response than perfect figures.",
        ],
      },
      {
        heading: "What the inspector looks at",
        paragraphs: [
          "They compare the thermometer reading at the time of the visit with the last entry, check that every refrigerator has a line in the journal and that thermometers have been verified or calibrated. Identical values for weeks and no entries at weekends when the kitchen was open raise suspicion.",
        ],
      },
      {
        heading: "Electronic refrigerator monitoring",
        paragraphs: [
          "In WeSetup each refrigerator carries a QR code: the cook scans it and enters the temperature, and the time is recorded automatically. An out-of-range value is flagged at once and the system asks what was done. With a wireless thermometer connected, readings arrive without staff involvement and the manager is notified of any deviation. Missed readings show up on the summary, and the PDF export follows the Appendix No. 2 form.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no fine specifically for an unfilled journal, but without records the business cannot prove that perishable food was kept at the right temperature. The inspector records a breach of sanitary requirements and of the technical regulation:",
      items: finesList(FINE_6_6, FINE_14_43, FINE_6_4),
      note: `${NOTE} If a refrigerator holds a product whose storage conditions were breached, it is seized separately from the fine.`,
    },
  },

  cleaning_ventilation_checklist: {
    sample: {
      caption:
        "A one-day checklist: for each room it records wet cleaning, surface treatment and airing, with the time, who did it and who checked it.",
      columns: ["Date", "Room", "Procedure", "Time", "Done by", "Checked by"],
      rows: [
        ["16.11.2026", "Dining room", "Airing before opening", "08:30–08:45", "Kozlova T. N.", "Ivanova M. P."],
        ["16.11.2026", "Dining room", "Wet floor cleaning, wiping tables", "15:10–15:40", "Kozlova T. N.", "Ivanova M. P."],
        ["16.11.2026", "Staff changing room", "Wet cleaning, airing", "16:00–16:20", "Kozlova T. N.", "Ivanova M. P."],
        ["16.11.2026", "Vegetable prep room", "Treating tables and sinks, cross-ventilation", "17:30–17:50", "Belov I. S.", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Who needs this checklist",
        paragraphs: [
          "It is needed wherever airing is a separate mandatory procedure rather than just an open window: school canteens and kindergarten kitchens, dining rooms, staff changing and welfare rooms, production areas without permanent supply and exhaust ventilation. SanPiN 2.3/2.4.4282-26 requires premises to be kept clean and air exchange to be ensured, and the checklist shows that this happens on schedule.",
          "If you already keep a cleaning journal, this document does not duplicate it: it gathers the short, repeated procedures of the day with the checker’s mark.",
        ],
      },
      {
        heading: "How to draw up the list of procedures",
        bullets: [
          "List all rooms, including ancillary ones: dining room, changing room, staff toilet, cleaning equipment store.",
          "For each room, set the procedures and times: airing before opening and after peak hours, wet cleaning after the shift.",
          "Assign a performer and a checker — different people, so the check does not turn into self-certification.",
          "Post the list at the room entrance so staff can see what to do and when.",
          "For windowless rooms, note that air exchange is provided by ventilation and check that it is switched on.",
        ],
      },
      {
        heading: "If a procedure was not done",
        paragraphs: [
          "A missed procedure is not painted over or added later. The checker marks that it was not done, gives the reason (a staff member was absent, the window was closed for repairs) and the time the work was done later. If misses keep happening, change the schedule or the allocation of duties — that way the inspector sees the problem was noticed and fixed.",
        ],
      },
      {
        heading: "Specifics for schools and kindergartens",
        paragraphs: [
          "Educational institutions are inspected for sanitary compliance more often, and inspectors usually compare the airing marks with the daily routine: the dining room is not aired while children are present, so airing is scheduled before groups arrive and after they leave. It helps to write these time slots into the checklist schedule in advance.",
        ],
      },
      {
        heading: "A ventilation checklist on your phone",
        paragraphs: [
          "In WeSetup an employee records a procedure via the QR code on the room door, and the time is logged automatically. The schedule is set once in the settings, and the service sends a reminder if a mark has not appeared by the right time. The checker confirms completion in one click, corrections are visible in the history, and a sheet for any period exports to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "The CAO RF has no specific fine for not having this checklist. The inspector assesses the sanitary condition of the premises, and records are the only way to show that cleaning and airing are done regularly:",
      items: finesList(FINE_6_6, FINE_6_4),
      note: NOTE,
    },
  },

  general_cleaning: {
    sample: {
      caption:
        "The November schedule: each area has a planned and an actual deep cleaning date, the performer and the acceptance mark. A postponement is visible at once, with the reason written in the same row.",
      columns: ["Area", "Planned date", "Actual date", "Product, concentration", "Done by", "Accepted by"],
      rows: [
        ["Hot kitchen", "02.11.2026", "02.11.2026", "Nika-Chlor, 0.1%", "Smirnova E. V.", "Ivanova M. P."],
        ["Cold kitchen", "09.11.2026", "09.11.2026", "Nika-Chlor, 0.1%", "Kozlov A. A.", "Ivanova M. P."],
        ["Storeroom and cold rooms", "16.11.2026", "17.11.2026 (postponed: goods delivery)", "Deo-Chlor, 0.05%", "Kozlov A. A.", "Ivanova M. P."],
        ["Washing room", "23.11.2026", "", "", "Smirnova E. V.", ""],
        ["Dining room", "30.11.2026", "", "", "Belov I. S.", ""],
      ],
    },
    sections: [
      {
        heading: "How a deep cleaning schedule differs from a cleaning journal",
        paragraphs: [
          "The cleaning journal records daily routine work. The deep cleaning schedule is a planning document: it sets out a month ahead which area is fully cleaned and when, and after the cleaning the actual date and the signature of the person who accepted the work are added next to the plan. A Rospotrebnadzor inspector compares exactly that — plan against fact — so without a schedule it is hard to prove how often deep cleaning takes place.",
        ],
      },
      {
        heading: "How to draw up a monthly schedule",
        bullets: [
          "Divide the premises into areas: kitchens, washing rooms, storerooms, cold rooms, dining room, staff rooms.",
          "Spread the dates so that the whole production cycle is never shut down on the same day.",
          "Name the performer and the person who accepts the work — the production manager or head chef.",
          "Decide in advance on the product and concentration for each area according to its instructions.",
          "Have the manager sign and approve the schedule before the month begins.",
          "Allow for special sites: kitchens in children’s and medical facilities do deep cleaning more often than an ordinary cafe, and the frequency is set in the production control programme.",
        ],
      },
      {
        heading: "What deep cleaning includes",
        paragraphs: [
          "Washing walls floor to ceiling, doors, windows and sills, light fittings and ceilings; cleaning ventilation grilles and extraction hoods; washing the outside of equipment and, where possible, moving it to clean behind; defrosting and washing refrigerators; and finally disinfecting surfaces. Food and clean tableware are removed or covered during the cleaning.",
        ],
      },
      {
        heading: "Acceptance and postponements",
        paragraphs: [
          "The responsible person inspects the area after cleaning and only then signs. If the work is incomplete, it is not accepted and the remaining tasks are noted. Postponing a date is allowed, but the reason and the new date go in the same row: an empty actual date with no explanation is a frequent finding at inspections.",
          "During acceptance it is worth checking places that routine cleaning does not reach: behind equipment, above the extraction hood, under shelving, around the evaporator in the cold room.",
        ],
      },
      {
        heading: "An electronic schedule instead of paper",
        paragraphs: [
          "In WeSetup a monthly schedule is built in a few clicks, and the day before each date the performer gets a reminder in Telegram. They mark the job as done from their phone via the QR code in the area, the time is recorded automatically, and the responsible person confirms acceptance in their task list. Overdue cleanings are highlighted, the history of postponements is kept, and plan and fact export to PDF as a single table.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for not having a schedule. If there is no proof that deep cleaning takes place, the inspector records a breach of sanitary requirements for the upkeep of premises and for catering:",
      items: finesList(FINE_6_6, FINE_6_4),
      note: NOTE,
    },
  },

  uv_lamp_runtime: {
    sample: {
      caption:
        "Entries for one unit: every switch-on with its duration and a running total of hours, which shows how much lamp life is left before replacement.",
      columns: ["Date", "Room / unit", "On", "Off", "Running time", "Total hours to date", "Responsible"],
      rows: [
        ["13.11.2026", "Cold kitchen, recirculator No. 1", "07:00", "09:00", "2 h", "6,412", "Belov I. S."],
        ["13.11.2026", "Cold kitchen, recirculator No. 1", "13:00", "15:00", "2 h", "6,414", "Belov I. S."],
        ["14.11.2026", "Cold kitchen, recirculator No. 1", "07:00", "09:00", "2 h", "6,416", "Belov I. S."],
        ["14.11.2026", "Pastry room, open-type unit No. 2", "21:00", "21:30", "30 min", "3,105", "Melnikova O. G."],
      ],
    },
    sections: [
      {
        heading: "Where germicidal UV units are used",
        paragraphs: [
          "UV units are used in cold kitchens, pastry rooms and ready-to-eat food areas, in portioning and packing rooms, and in medical rooms attached to kitchens. Requirements for air disinfection are set out in SP 3.1.3597-20, and for the units themselves in GOST R 59527-2021. Records are kept separately for each unit.",
        ],
      },
      {
        heading: "Open units vs recirculators: what differs in the records",
        bullets: [
          "An open-type unit is switched on only when nobody is in the room; the time in the entry matters because it shows the room was empty.",
          "A recirculator (closed type) runs with people present, in the mode set by the manufacturer’s instructions.",
          "Running hours are counted per lamp, not per housing: after a lamp is replaced, the count starts again.",
          "The header gives the model, power and lamp life from the product data sheet.",
          "Repairs or long periods of downtime are also recorded so that any gap in the records can be explained.",
        ],
      },
      {
        heading: "Replacing and disposing of lamps",
        paragraphs: [
          "When running hours approach the rated life, the lamp is replaced even if it still glows: germicidal output drops before the visible light does. The replacement date and the new lamp’s number are written in the journal. Spent mercury-containing lamps must not go out with general waste — they are kept in a closed container and handed over to a licensed company under contract, with the transfer certificates kept on file.",
        ],
      },
      {
        heading: "What is checked on site",
        paragraphs: [
          "The inspector compares the running hours with the rated life in the data sheet, checks that an open-type unit is not switched on while staff are working, and asks for the disposal documents for replaced lamps. A common mistake is keeping the journal without adding up the hours, so nobody knows when the lamp is due for replacement. Keep the unit’s data sheet and operating manual next to the journal — they are often requested.",
        ],
      },
      {
        heading: "Running hours without a calculator",
        paragraphs: [
          "In WeSetup an employee records switching on and off from their phone via the QR code on the unit, the time is set automatically and the total hours add up by themselves. When a lamp nears the end of its life, the responsible person gets a notification in Telegram. A replacement is recorded as a separate entry, the history is kept, and the journal exports to PDF for inspection.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no direct fine for not recording running hours. The risks lie in the consequences: ineffective disinfection is assessed as a breach of sanitary requirements, and throwing mercury-containing lamps out with household waste as a breach of waste management rules:",
      items: finesList(FINE_6_3, FINE_6_4, FINE_8_2),
      note: NOTE,
    },
  },

  disinfectant_usage: {
    sample: {
      caption:
        "Entries for receipt and use of products: an incoming batch with its documents, preparation of working solutions with their concentration, and the balance after each issue.",
      columns: ["Date", "Product", "Operation", "Quantity", "Concentration, purpose", "Balance", "Responsible"],
      rows: [
        ["05.11.2026", "Nika-Chlor, tablets", "Received, batch 0926, instructions and registration documents present", "3 tubs of 300 tablets", "—", "900 tablets", "Ivanova M. P."],
        ["06.11.2026", "Nika-Chlor, tablets", "Solution prepared", "7 tablets per 10 L (per instructions)", "0.1%, hot kitchen surfaces", "893 tablets", "Smirnova E. V."],
        ["06.11.2026", "Nika-Extra M", "Solution prepared", "100 ml per 10 L", "1%, washing room floors and walls", "4.9 L", "Kozlov A. A."],
        ["07.11.2026", "Septolit-Profi, hand sanitiser", "Issued to area", "1 L", "Ready to use, kitchen entrance", "3 L", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Why track disinfectants if you buy them regularly",
        paragraphs: [
          "SanPiN 2.3/2.4.4282-26 requires detergents and disinfectants to be used according to their instructions and stored separately from food. Recording receipts and usage shows that there is enough product for all the cleaning, that only registered products are used and that staff prepare solutions at the right concentration. If the cleaning journal shows 20 disinfections in a month but product was used for only three, the inspector will notice.",
        ],
      },
      {
        heading: "Receiving and storage procedure",
        bullets: [
          "On receipt, check the instructions for use, the state registration documents and the expiry date; record the batch number.",
          "Store in a separate lockable cabinet or room, in the manufacturer’s original packaging.",
          "Label containers of working solutions with the name, concentration, preparation date and solution expiry date.",
          "Give access to concentrates only to trained staff who have had occupational safety instruction and are provided with protective equipment.",
          "Before preparing a solution, check the concentrate’s expiry date and that the packaging is intact.",
        ],
      },
      {
        heading: "How to prepare working solutions",
        paragraphs: [
          "Take the concentration and contact time from the manufacturer’s instructions for the specific object: tableware, surfaces, sanitary fittings, hands. Solutions are prepared in a separate room or zone, wearing gloves, goggles and an apron, with the ventilation running. A dilution chart on the wall next to the preparation area helps — it means fewer mistakes made “by eye”.",
        ],
      },
      {
        heading: "Typical violations",
        bullets: [
          "A product without instructions for use or past its expiry date.",
          "A solution in an unlabelled drinks bottle.",
          "Disinfectants stored on a shelf next to food.",
          "An employee cannot say what concentration they are preparing.",
        ],
      },
      {
        heading: "Balances and usage in WeSetup",
        paragraphs: [
          "In WeSetup a receipt is entered once, and the balance is recalculated after every usage entry. An employee records the preparation of a solution from their phone, with the time and their name logged automatically. The manager sees when a product is running low, and the journal exports to PDF together with the list of products in use.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate article for not keeping these records. But the inspector treats unregistered products, wrong concentrations or storage next to food as a breach of sanitary requirements, and handling concentrates without protective equipment as a breach of occupational safety:",
      items: finesList(FINE_6_6, FINE_6_3, FINE_5_27_1),
      note: NOTE,
    },
  },

  sanitary_day_control: {
    sample: {
      caption:
        "The checklist for one sanitation day: every item with its performer and a completion mark. An item that was not done has been rescheduled, with the reason and the new date.",
      columns: ["Date", "Procedure", "Area", "Done by", "Completed", "Checked by"],
      rows: [
        ["27.11.2026", "Defrosting and washing refrigerators", "Cold kitchen, storeroom", "Kozlov A. A.", "Yes", "Ivanova M. P."],
        ["27.11.2026", "Washing walls, doors and light fittings", "Hot kitchen", "Smirnova E. V.", "Yes", "Ivanova M. P."],
        ["27.11.2026", "Cleaning extraction hoods and filters", "Hot kitchen", "VentService LLC, certificate No. 211", "Yes", "Ivanova M. P."],
        ["27.11.2026", "Review of cleaning equipment and its labelling", "Cleaning equipment store", "Belov I. S.", "Yes", "Ivanova M. P."],
        ["27.11.2026", "Washing windows outside", "Dining room", "Belov I. S.", "No — rain, moved to 30.11", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "How a sanitation day differs from deep cleaning",
        paragraphs: [
          "Deep cleaning is done area by area and does not stop the whole business. A sanitation day is a shutdown: food and tableware are cleared away, work goes on in all zones at once, and jobs that never get done during normal shifts are tackled too — reviewing cleaning equipment, cleaning the extraction system, checking labelling, minor repairs. The checklist records every item so nothing gets missed.",
        ],
      },
      {
        heading: "How to prepare for a sanitation day",
        bullets: [
          "Set the date a week ahead and let guests know if the dining room will be closed.",
          "Check that there are enough disinfectants and cleaning equipment.",
          "Agree times with contractors: ventilation cleaning, insect and rodent control, refrigeration servicing.",
          "Assign checklist items to performers so that everyone has a clear scope of work.",
          "Prepare a place to move food to during cleaning, and film to cover anything that cannot be moved.",
          "Appoint one checker who walks round all areas at the end of the day.",
        ],
      },
      {
        heading: "If an item was not done",
        paragraphs: [
          "The value of a checklist is that it shows the truth. If an item could not be done, mark it with the reason and a new date, and later add the mark for when it was actually completed. A Rospotrebnadzor inspector is more likely to accept a postponement with an explanation than a sheet with every item ticked off while the extraction hood is covered in grease.",
        ],
      },
      {
        heading: "Specifics for different establishments",
        paragraphs: [
          "School and children’s kitchens schedule the sanitation day for weekends or holidays; round-the-clock establishments split it by zone over several nights. At production sites it usually includes washing and disinfecting lines with disassembly, and the equipment marks are duplicated in the equipment washing journal. Requirements for sanitary upkeep come from SanPiN 2.3/2.4.4282-26 and the production control programme.",
        ],
      },
      {
        heading: "A sanitation day from a template",
        paragraphs: [
          "In WeSetup the list of procedures is stored as an organisation template and filled into every new sanitation day. Performers receive their items on their phones and mark them done on the spot, with the time recorded automatically. The checker sees open items in real time, contractor certificates are attached to the row, and the result exports to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no fine for lacking the checklist as such. However, signs of neglected sanitation — grease on the hood, dirty refrigerators, faulty cleaning equipment — are recorded by the inspector as a breach of sanitary requirements:",
      items: finesList(FINE_6_6, FINE_6_4),
      note: NOTE,
    },
  },

  equipment_cleaning: {
    sample: {
      caption:
        "One shift of equipment washing and disinfection entries: which equipment, which procedure, which product at what concentration, who did it and who checked it.",
      columns: ["Date, time", "Equipment", "Procedure", "Product, concentration, contact time", "Done by", "Checked by"],
      rows: [
        ["18.11.2026, 14:30", "MIM-300 meat grinder", "Disassembly, washing, disinfection, drying, reassembly", "Nika-Chlor, 0.1%, 15 min", "Smirnova E. V.", "Ivanova M. P."],
        ["18.11.2026, 15:10", "Slicer, cold kitchen", "Disassembly, washing, disinfection of blade and carriage", "Nika-Extra M, 0.5%, 15 min", "Kozlov A. A.", "Ivanova M. P."],
        ["18.11.2026, 16:00", "Dough mixer, pastry room", "Washing bowl and hook, rinsing", "Alkaline detergent, 1%", "Melnikova O. G.", "Ivanova M. P."],
        ["18.11.2026, 22:00", "Combi oven", "Automatic cleaning programme", "Cleaning tablets per instructions", "Belov I. S.", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Why equipment is recorded separately from premises",
        paragraphs: [
          "A meat grinder, slicer or dough mixer is in direct contact with food, and leftover mince or cream in its parts is a direct route to microbiological contamination. So the procedure for equipment is stricter than for surfaces: disassembly, washing every part, disinfection with the required contact time and drying are all mandatory. SanPiN 2.3/2.4.4282-26 requires equipment to be washed and disinfected according to instructions, and the HACCP plan requires this to be backed by records.",
        ],
      },
      {
        heading: "Washing sequence",
        bullets: [
          "Unplug the equipment and disassemble it according to the manufacturer’s instructions.",
          "Remove food residue and wash the parts in hot water with detergent.",
          "Rinse and treat with disinfectant solution for the specified contact time.",
          "Rinse with drinking water if the product’s instructions require it.",
          "Dry the parts and reassemble the equipment with clean hands or gloves.",
        ],
      },
      {
        heading: "How often to wash different equipment",
        paragraphs: [
          "Frequency depends on the product: equipment for raw meat and fish is washed after each use and at the end of the shift, equipment for ready-to-eat food also whenever the type of product changes. Combi ovens and other ovens are usually cleaned with their built-in programme at the end of the day. It is convenient to set the schedules in the production control programme and print them out next to each type of equipment.",
        ],
      },
      {
        heading: "What the inspector notices",
        bullets: [
          "Food residue in meat grinder parts or under the slicer blade on visual inspection.",
          "One entry per day for equipment used for both raw and ready-to-eat food.",
          "No product or concentration given, or ones that do not match the instructions.",
          "No checker’s signature — meaning no check took place.",
          "Disassembled parts drying on the floor or on an unwashed table next to raw materials.",
        ],
      },
      {
        heading: "Washing records from a phone",
        paragraphs: [
          "In WeSetup each type of equipment has its own frequency and procedure. The cook scans the QR code on the housing, records the wash and picks the product from a list — the concentration fills in by itself and the time is set automatically. Missed washes are visible to the manager, corrections are kept in the history, and the journal exports to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no specific article for missing equipment washing records. If equipment is dirty or not disinfected, the inspector records a breach of sanitary requirements and of the technical regulation’s requirements for production processes:",
      items: finesList(FINE_6_6, FINE_6_4, FINE_14_43),
      note: NOTE,
    },
  },

  intensive_cooling: {
    sample: {
      caption:
        "Entries by cooling batch: dish and quantity, temperature and time at the start and end, cooling method and the person responsible. In the last row cooling did not meet the limit, and the entry says what was done with the batch.",
      columns: ["Date", "Dish, quantity", "Start: time, °C", "End: time, °C", "Method", "Result", "Responsible"],
      rows: [
        ["19.11.2026", "Plov, 12 kg", "11:05, +72", "11:55, +4", "Blast chiller", "Within limits", "Kozlov A. A."],
        ["19.11.2026", "Chicken stock, 20 L", "13:20, +85", "14:30, +5", "Blast chiller, 5 L gastronorm containers", "Within limits", "Kozlov A. A."],
        ["19.11.2026", "Minced meat cutlets, 120 pcs", "15:00, +70", "15:50, +3", "Blast chiller", "Within limits", "Smirnova E. V."],
        ["20.11.2026", "Bechamel sauce, 6 L", "10:40, +78", "13:10, +14", "Cold room", "Limit not met — batch written off, report No. 37", "Smirnova E. V., Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "When cooling must be monitored",
        paragraphs: [
          "Records are kept by anyone who cooks ahead and chills hot dishes for storage: producers of semi-finished and ready meals, caterers, central kitchens, restaurants preparing food for the next day, and kitchens working on the cook-chill system. Rapid cooling is usually a critical control point in the HACCP plan, and the times and temperatures are set in the dish’s technical documentation. General process safety requirements are set out in SanPiN 2.3/2.4.4282-26.",
        ],
      },
      {
        heading: "How to cool food within the limits",
        bullets: [
          "Spread the food in shallow gastronorm containers a few centimetres deep instead of cooling it in a large pot.",
          "Do not cover containers tightly until cooling is complete.",
          "Do not put hot food in an ordinary refrigerator with other products — it will not cope and will warm up the food next to it.",
          "Measure the temperature in the core of the product with a probe thermometer, not on the surface.",
          "Record the start time as soon as the container goes into the chiller.",
        ],
      },
      {
        heading: "If a dish did not cool in time",
        paragraphs: [
          "Such a batch is non-conforming. The person responsible under the HACCP plan decides: the dish is written off with a report or, if the recipe allows, reheated and served immediately. It must not be stored. The cause is traced to the equipment (an overloaded chiller, a fault) or to a deviation from the process, and the action taken is written in the result column.",
        ],
      },
      {
        heading: "Mistakes that show up at inspections",
        bullets: [
          "Identical start and end times for every batch — the entries were clearly filled in from a template.",
          "No probe thermometer, or one that has not been checked.",
          "Cooling in an ordinary cold room with no times recorded.",
          "No note of what was done with a batch that did not meet the limit.",
        ],
      },
      {
        heading: "Cooling control in WeSetup",
        paragraphs: [
          "The cook creates a batch from their phone when it goes into the chiller, the start time is set automatically, and a reminder to take a reading arrives at the right moment. If the final temperature or time is out of range, the system requires a decision on the batch. With a wireless thermometer in the blast chiller, cooling is confirmed by sensor data. The journal exports to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for missing records, but rapid cooling is part of the production processes regulated by TR CU 021/2011. The inspector assesses a breach of the cooling regime and release of such products as follows:",
      items: finesList(FINE_14_43, FINE_6_6, FINE_14_4),
      note: NOTE,
    },
  },

  transport_temperature: {
    sample: {
      caption:
        "Entries by trip: vehicle, route, products, temperature at loading and unloading. The two readings show whether the cold or hot chain was maintained.",
      columns: ["Date", "Vehicle, route", "Products", "Loading: time, °C", "Unloading: time, °C", "Responsible"],
      rows: [
        ["17.11.2026", "Gazelle A123BV, School No. 5", "Lunches in insulated containers", "11:10, +78", "11:40, +71", "Petrov S. A."],
        ["17.11.2026", "Gazelle A123BV, Solnyshko kindergarten", "Dairy products", "07:20, +3", "07:55, +5", "Petrov S. A."],
        ["18.11.2026", "Refrigerated truck E456KM, cafe on Lesnaya Street", "Frozen semi-finished products", "06:30, −20", "07:45, −18", "Nikolaev D. V."],
        ["18.11.2026", "Gazelle A123BV, Severny office", "Salads and starters, catering", "10:00, +4", "11:15, +8", "Petrov S. A., accepted with a remark, salads returned"],
      ],
    },
    sections: [
      {
        heading: "Who needs transport temperature records",
        paragraphs: [
          "Records are kept by businesses that deliver their own products: school catering plants, caterers, ready-meal delivery services, producers supplying their own outlets, and central kitchens of chains. TR CU 021/2011 requires the conditions set by the manufacturer to be maintained during transport and vehicles and packaging not to impair the products. If a supplier delivers the products, the temperature is recorded on receipt in the incoming inspection journal.",
        ],
      },
      {
        heading: "How to organise the readings",
        bullets: [
          "Before loading, check that the cargo area is clean and switch the refrigeration unit on in advance so it reaches its operating temperature.",
          "Measure the temperature of the product, not just the air in the cargo area: with a probe thermometer in a sample unit or from a data logger.",
          "Take the second reading on unloading at the recipient’s site, in their presence.",
          "Carry hot dishes in insulated containers, and keep hot and cold food separate.",
          "A driver or forwarder who handles the products must have a personal medical record book.",
        ],
      },
      {
        heading: "If products arrived at the wrong temperature",
        paragraphs: [
          "The recipient is entitled to refuse the batch. The deviation is recorded with the actual value, the products are returned or isolated until the responsible person decides, and the cause is investigated: a long route, a broken refrigeration unit, products loaded without being pre-chilled. For recurring cases, change the route or the number of drops per trip and add ice packs to the containers.",
        ],
      },
      {
        heading: "Specifics for school meals and catering",
        paragraphs: [
          "When lunches are delivered to schools and kindergartens, inspectors pay attention to the travel time and the temperature of hot dishes on arrival, so the receiving party signs for the unloading. In catering, time margins matter: salads and desserts hold their temperature longest if they are loaded last. Insulated containers and the cargo area are washed and sanitised after each trip, and separate containers are used for raw materials and ready-to-eat food — the inspector may ask how this is organised.",
        ],
      },
      {
        heading: "Trip records from the driver’s phone",
        paragraphs: [
          "In WeSetup the driver or forwarder enters the temperature at loading and unloading from their phone, the time is recorded automatically, and the route and vehicle are chosen from a list. A deviation is highlighted and requires an action to be specified. The manager sees all of the day’s trips in one table, and the journal exports to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate article for missing records. Transport in breach of the temperature regime violates the transport requirements of TR CU 021/2011, and for school and social catering it also breaches the sanitary requirements for catering:",
      items: finesList(FINE_14_43, FINE_6_6),
      note: NOTE,
    },
  },

  pest_control: {
    sample: {
      caption:
        "A month of entries: scheduled treatments by the contractor and in-house trap checks. Each entry shows the type of work, the product, the area treated and how long the room stays closed.",
      columns: ["Date", "Performed by", "Type of work", "Area", "Product", "Re-entry time", "Signature"],
      rows: [
        ["03.11.2026", "DezService LLC, pest control technician Sergeev V. P.", "Rodent control, bait replacement in bait stations", "Storeroom, basement, waste container area", "Rodenticide in bait stations", "Not required", "Ivanova M. P."],
        ["03.11.2026", "DezService LLC, pest control technician Sergeev V. P.", "Insect control", "Washing room, hot kitchen", "Insecticide gel along skirting boards", "4 h, kitchen reopened at 08:00", "Ivanova M. P."],
        ["14.11.2026", "Kozlov A. A.", "Inspection of traps and sticky boards", "All rooms per the layout plan", "—", "—", "Ivanova M. P."],
        ["24.11.2026", "DezService LLC, pest control technician Sergeev V. P.", "Unscheduled insect control on request (cockroaches in the washing room)", "Washing room", "Insecticide gel", "4 h", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Who carries out insect and rodent control",
        paragraphs: [
          "Protection against insects and rodents is mandatory for all catering, food retail and food production sites. The requirements are set out in SanPiN 3.3686-21 and SanPiN 3.5.2.3472-17. In practice treatments are carried out by a specialist contractor, while the business provides access, monitors bait stations between visits and keeps the records. The person responsible for liaising with the contractor is appointed by order.",
        ],
      },
      {
        heading: "What the contract and documents must include",
        bullets: [
          "A list of sites and rooms, the types of work and the frequency of scheduled treatments.",
          "A layout plan of traps and bait stations with their numbers.",
          "Certificates of completed work after each visit, stating the products used.",
          "Documents for the products used: instructions and state registration details.",
          "The procedure for unscheduled treatments on request if insects or rodents are found.",
        ],
      },
      {
        heading: "How to prepare a room for treatment",
        paragraphs: [
          "Food, tableware and utensils are removed or tightly covered, and equipment is covered with film. Staff stay out of the room during the work and for the re-entry period. Once that period is over, the room is aired, work surfaces are washed, and only then does food preparation resume. The re-entry time comes from the product’s instructions and the contractor’s certificate.",
        ],
      },
      {
        heading: "What the inspector checks",
        paragraphs: [
          "A contract, certificates and a layout plan; trap numbers on the plan that match those on site; no signs of insects or rodents; intact window screens and door seals. They also check that rodenticides are not stored near food and that no bait has been spilled in production areas. If staff spot signs of pests between contractor visits, this is recorded and a request for an unscheduled treatment is made — the inspector will appreciate a quick response.",
        ],
      },
      {
        heading: "Treatments and certificates in one place",
        paragraphs: [
          "In WeSetup a photo or scan of the contractor’s certificate is attached to the treatment entry, so documents do not go missing. The re-entry time is entered in the record, and staff can see when the room can be used again. In-house trap checks are recorded via the QR code on the station, and the journal exports to PDF together with the certificates.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for not keeping the journal. But if insects or rodents are found on site and there are no documents for regular treatments, the inspector records a breach of sanitary requirements:",
      items: finesList(FINE_6_6, FINE_6_3, FINE_6_4),
      note: `${NOTE} In the case of a heavy infestation, a court may suspend activities until treatments have been carried out.`,
    },
  },
};
