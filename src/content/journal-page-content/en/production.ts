/**
 * English translation of the receiving, production and physical-hazard journal
 * page blocks (see ../production.ts): sample rows, sections and fines.
 *
 * Fine amounts follow the RF Code of Administrative Offences as of November 2026;
 * update them together with the Russian source when the law changes.
 */

import type { JournalPageContent } from "../types";

const NOTE = "Amounts are based on the CAO RF as amended in November 2026.";

export const PRODUCTION_PAGE_CONTENT_EN: Record<string, JournalPageContent> = {
  perishable_rejection: {
    sample: {
      caption:
        "Entries from one morning of deliveries: each batch gets its own row with its own document and sell-by date. The last batch failed inspection and went back to the supplier — the reason and the report number are visible right in the journal.",
      columns: ["Received", "Product, packaging, production date", "Manufacturer / supplier", "Quantity", "Safety document", "Sensory assessment", "Storage, final sell-by date", "Responsible person"],
      rows: [
        ["16.11.2026, 07:40", "Drinking milk 3.2%, 1 L carton, produced 15.11.2026", "“Molochny Dvor” LLC", "40 L", "VSD redeemed in the FSIS “Mercury” system", "Compliant", "+2…+6 °C, until 20.11.2026", "Ivanova M. P."],
        ["16.11.2026, 07:45", "Cottage cheese 9%, 0.5 kg block, produced 15.11.2026", "“Molochny Dvor” LLC", "12 kg", "VSD redeemed in the FSIS “Mercury” system", "Compliant", "+2…+6 °C, until 19.11.2026", "Ivanova M. P."],
        ["16.11.2026, 08:20", "Chilled chicken fillet, 1 kg tray, produced 14.11.2026", "“Ptitsekombinat Severny” LLC", "25 kg", "VSD redeemed in the FSIS “Mercury” system", "Compliant", "0…+4 °C, until 19.11.2026", "Ivanova M. P."],
        ["16.11.2026, 08:25", "Sour cream 20%, 0.4 kg cup, produced 15.11.2026", "“Molochny Dvor” LLC", "30 pcs", "Declaration of conformity, VSD", "Non-compliant: 3 pcs with bulging lids", "Batch returned, report No. 47", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Which products go through a quality inspection on receipt",
        paragraphs: [
          "Perishable products are those that need a cold chain and have a short shelf life: milk and dairy, meat and poultry, fish, eggs, ready-to-cook semi-finished products, cream desserts and ready-made salads. For dairy, labelling and circulation requirements are set by TR CU 033/2013, and the recommended record form is given in SanPiN 2.3/2.4.4282-26.",
          "Dry goods, vegetables and drinks are usually recorded in the general receiving journal. The inspection is needed where a mistake at receipt quickly turns into a risk of food poisoning, so every batch is assessed separately, even when one supplier delivers several items at once.",
        ],
      },
      {
        heading: "How to accept a batch, step by step",
        bullets: [
          "Check the vehicle: a clean cargo area and a working refrigeration unit; measure the product temperature with a probe thermometer.",
          "Check the documents: the veterinary accompanying document (VSD) in the FSIS “Mercury” system for products of animal origin, the declaration of conformity and the delivery note.",
          "Check the labelling under TR CU 022/2011: product name, manufacturer, production date, shelf life and storage conditions.",
          "Assess the packaging and sensory properties: intact packaging, no swelling, normal colour, smell and texture.",
          "Put the accepted batch into the fridge straight away — time spent at receiving should not eat into the shelf life.",
        ],
      },
      {
        heading: "If a batch fails inspection",
        paragraphs: [
          "The product is kept apart from accepted goods: it goes to a labelled “Rejected / return” area, a report is drawn up with the driver or the supplier’s representative, and a note is made in the remarks column. The VSD in “Mercury” is redeemed with a refusal or a partial return; otherwise the batch will stay on your books. If the same supplier delivers a defective batch for the second time in a month, that calls for corrective action: review the contract or delivery terms, or change the supplier.",
        ],
      },
      {
        heading: "Typical mistakes inspectors find",
        bullets: [
          "The sensory assessment column is filled in with a single word, “normal”, for the whole week ahead.",
          "The document number does not match the VSD in “Mercury”, or the delivery note number is entered instead of the safety document.",
          "The final sell-by date is missing, and expired products are found in the storeroom.",
          "The responsible person’s signature is missing, or the entry was made by someone who was not working that day.",
        ],
      },
      {
        heading: "An electronic perishable inspection journal on your phone",
        paragraphs: [
          "In WeSetup the storekeeper opens the journal by scanning the QR code on the storeroom door, picks the product and supplier from the directory and photographs the label and document — the photos are attached to the row. The entry time is set automatically, the final sell-by date is highlighted as it approaches, and corrections are kept in the history. Before an inspection, the journal is exported to PDF in the SanPiN format.",
        ],
      },
    ],
    fines: {
      intro:
        "The CAO RF has no separate article for failing to inspect perishable products on receipt. But without records you cannot prove that products were accepted with documents and in proper condition, and the inspector will treat this as a breach of sanitary requirements or a technical regulation:",
      items: [
        "Art. 6.6 of the CAO RF — breach of sanitary and epidemiological requirements for public catering: for legal entities RUB 20,000 to 40,000 or suspension of operations for up to 90 days;",
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011, TR CU 033/2013): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000.",
      ],
      note: `${NOTE} If products without a VSD are found in circulation, veterinary records are checked separately as well.`,
    },
  },

  incoming_control: {
    sample: {
      caption:
        "Entries from one receiving shift: dry goods, vegetables and dairy in a single journal. For each delivery you can see which documents and labels were checked and what was decided, including a partial return.",
      columns: ["Date, time", "Supplier, delivery note", "Product", "Quantity", "Best before", "Documents and labelling", "Decision", "Received by"],
      rows: [
        ["17.11.2026, 08:15", "“Ovoshchnaya Baza” LLC, delivery note No. 1184", "Washed potatoes", "50 kg", "until 27.11.2026", "Declaration, label on the sack", "Accepted", "Kozlov A. A."],
        ["17.11.2026, 09:30", "“Bakaleya-Opt” LLC, UTD No. 562", "Premium wheat flour", "100 kg (4 sacks)", "until 17.08.2027", "Declaration, full labelling", "Accepted", "Kozlov A. A."],
        ["17.11.2026, 10:05", "“Molochny Dvor” LLC, UTD No. 3307", "Cream 33%, 1 L", "12 L", "until 25.11.2026", "VSD redeemed in the FSIS “Mercury” system", "Accepted", "Kozlov A. A."],
        ["17.11.2026, 11:20", "“Bakaleya-Opt” LLC, UTD No. 571", "Refined sunflower oil, 5 L", "4 pcs", "until 10.2027", "No bottling date on 1 bottle", "3 pcs accepted, 1 pc returned, report No. 12", "Kozlov A. A."],
      ],
    },
    sections: [
      {
        heading: "How general receiving differs from perishable inspection",
        paragraphs: [
          "Every delivery goes through receiving: dry goods, vegetables, drinks, packaging, kitchen detergents. This is where you record the fact of delivery, the check against the delivery note, the documents and the labelling. Perishable products are additionally assessed in the perishable inspection journal, which records sensory properties and the final sell-by date.",
          "This split is convenient: the storekeeper has one daily list of deliveries, and the head chef gets a detailed picture of high-risk products.",
        ],
      },
      {
        heading: "How to receive a delivery",
        bullets: [
          "Check the item names and quantities against the delivery note; reweigh goods sold by weight on your own scales.",
          "Check the safety documents: the declaration of conformity and the VSD for products of animal origin.",
          "Read the labelling under TR CU 022/2011: ingredients, manufacturer, production date, shelf life and storage conditions.",
          "Inspect the packaging for opened, wet or crushed areas and signs of pests.",
          "Check the remaining shelf life: the minimum remaining shelf life on delivery is best fixed in the supplier contract.",
        ],
      },
      {
        heading: "How to record a refusal or a partial return",
        paragraphs: [
          "Non-compliant goods are not taken into the storeroom or added to stock. A discrepancy or return report is drawn up in two copies and signed by the storekeeper and the driver, and the report number goes into the journal row. If the goods have already been unloaded, they are kept separately and marked “Return” until collected, so that nobody uses them by mistake.",
        ],
      },
      {
        heading: "How to use the records when working with suppliers",
        paragraphs: [
          "Once a month it is worth reviewing the whole journal: which suppliers most often deliver goods without documents, with a short shelf life or with damaged packaging. This review is part of evaluating external suppliers under GOST R ISO 22000-2019: based on it, you update the list of approved suppliers and the contract terms.",
        ],
      },
      {
        heading: "Electronic receiving instead of a paper form",
        paragraphs: [
          "In WeSetup the storekeeper opens the journal by scanning the QR code at the storeroom entrance, picks the supplier from the directory and photographs the delivery note and labels — the photos are saved in the entry. The receiving time is recorded automatically, corrections are visible in the history, and for a return the app asks for the reason. The journal for any period can be exported to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no specific fine for not keeping a receiving journal. The risk lies elsewhere: without records the business cannot prove that products arrived with safety documents and an acceptable shelf life:",
      items: [
        "Art. 6.6 of the CAO RF — breach of sanitary and epidemiological requirements for public catering: for legal entities RUB 20,000 to 40,000 or suspension of operations for up to 90 days;",
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000.",
      ],
      note: NOTE,
    },
  },

  fryer_oil: {
    sample: {
      caption:
        "Entries for one fryer over three days: oil quality before and after frying, the carry-over amount and a replacement. The third row shows how a drop in the score and the disposal of used oil are recorded.",
      columns: ["Frying started", "Type of fat", "Score before frying", "Products", "Finished", "Score after frying", "Carried over / disposed of", "Checked by"],
      rows: [
        ["12.11.2026, 10:00", "Refined sunflower oil (fresh)", "5 points", "French fries, nuggets", "16:30", "5 points", "6 kg / —", "Petrov S. A."],
        ["13.11.2026, 10:00", "Carry-over + 1 kg top-up", "5 points", "French fries", "16:00", "4 points", "6.5 kg / —", "Petrov S. A."],
        ["14.11.2026, 10:00", "Carry-over", "4 points", "French fries, cheese sticks", "15:10", "3 points: darkening, off odour", "— / 6 kg, oil replaced", "Petrov S. A."],
        ["14.11.2026, 15:30", "Refined sunflower oil (fresh)", "5 points", "French fries", "22:00", "5 points", "7 kg / —", "Orlova N. S."],
      ],
    },
    sections: [
      {
        heading: "How to assess frying fat by its sensory properties",
        paragraphs: [
          "Oil is assessed twice: before frying starts and after it ends. Check the colour and clarity, smell it and taste it; each property is scored on a 5-point scale, where 5 is fresh, unchanged oil. The assessment is done by one designated person — a cook or the head chef — so that scores do not drift from person to person.",
          "If the kitchen has a polar compounds tester, its readings are recorded next to the sensory score. The threshold below which oil is replaced is set in the production control program and is not changed on the fly.",
        ],
      },
      {
        heading: "When it is time to change the oil",
        bullets: [
          "The score has dropped below the threshold set by the business.",
          "The oil has darkened or thickened, foams heavily or smokes at normal temperature.",
          "A bitter, rancid or “fishy” smell has appeared and is passing to other dishes.",
          "The oil contains a lot of burnt residue and crumbs that filtering does not remove.",
        ],
        paragraphs: [
          "Topping up with fresh oil does not reset the score: the quality of the mix is checked again and recorded in a separate row.",
        ],
      },
      {
        heading: "Carry-over and disposal",
        paragraphs: [
          "At the end of the shift the oil is filtered and weighed or measured with the fryer’s gauge: this is the carry-over that will be used tomorrow. Replaced oil is entered in the disposal column in kilograms. It is never poured down the drain: it is collected in closed containers and handed over to a contractor that removes used fats; the handover certificate or delivery note is kept together with the journal.",
        ],
      },
      {
        heading: "What the inspector looks at",
        bullets: [
          "All scores are identical — 5 points for months without a single replacement.",
          "The amount of oil disposed of does not match purchases: more oil is bought than is used and handed over.",
          "There are no records for the second fryer or for the night shift.",
          "The production control program does not state a replacement threshold.",
        ],
      },
      {
        heading: "Tracking frying oil in the app",
        paragraphs: [
          "In WeSetup each fryer has its own QR code: the cook scans it, enters the scores before and after frying and photographs the oil if needed. The time is recorded automatically; when the score falls below the threshold, the app asks for the reason and a replacement mark, and the manager gets a notification. The frying oil usage journal for all fryers is exported to PDF in the same format.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for not tracking frying fats. But using oil that has deteriorated breaches sanitary and product safety requirements, and without records the business has nothing to show that the oil is changed on time:",
      items: [
        "Art. 6.6 of the CAO RF — breach of sanitary and epidemiological requirements for public catering: for legal entities RUB 20,000 to 40,000 or suspension of operations for up to 90 days;",
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000.",
      ],
      note: NOTE,
    },
  },

  incoming_raw_materials_control: {
    sample: {
      caption:
        "A bakery’s entries for one day: raw materials, ingredients and packaging film go through the same checks. The last batch was not approved, and a complaint has been filed with the supplier.",
      columns: ["Date", "Raw material / packaging", "Supplier, batch", "Document", "Packaging and labelling", "Compliance with TU / GOST", "Decision", "Checked by"],
      rows: [
        ["10.11.2026", "Premium bread-making wheat flour", "“Melnitsa Povolzhya” LLC, batch 4417", "Declaration of conformity, quality certificate", "Sacks intact, full labelling", "Compliant", "Approved", "Orlova N. S."],
        ["10.11.2026", "Compressed baker’s yeast", "“Drozhzhevoy Zavod” LLC, batch 1110", "Declaration of conformity", "Blocks undamaged, +4 °C", "Compliant", "Approved", "Orlova N. S."],
        ["10.11.2026", "Polypropylene film for bread packaging", "“Upak-Prom” LLC, batch P-2231", "Declaration of conformity", "“For food contact” mark, no odour", "Compliant", "Approved", "Orlova N. S."],
        ["10.11.2026", "Raisins", "“Sukhofrukty-Opt” LLC, batch 2610", "Declaration of conformity", "1 box torn, signs of moisture", "Non-compliant", "Returned, complaint No. 8", "Orlova N. S."],
      ],
    },
    sections: [
      {
        heading: "Why incoming raw material control matters in a HACCP system",
        paragraphs: [
          "Raw materials are the first point where biological, chemical and physical hazards can get into the product. TR CU 021/2011 requires manufacturers to set up procedures based on HACCP principles, and checking incoming raw materials is a mandatory part of them. Packaging materials are checked on a par with raw materials: they are in contact with the product and can pass on odours or harmful substances.",
        ],
      },
      {
        heading: "How to draw up an incoming inspection plan",
        bullets: [
          "A list of the raw materials, ingredients and packaging the business buys.",
          "What is checked for each item: documents, labelling, packaging, temperature, sensory properties.",
          "Acceptance criteria based on the TU or GOST stated on the label and in the supplier’s specification.",
          "Which parameters are sent to the laboratory and how often, under the production control program.",
          "Who decides on approval and who stands in for them.",
        ],
      },
      {
        heading: "Batch decision: approval, quarantine, return",
        paragraphs: [
          "If everything is in order, the batch is approved for production. If a document is missing or a lab test is needed, the batch is quarantined: stored separately with a tag and not used until a decision is made. A non-compliant batch is returned to the supplier with a complaint, and the complaint number is entered in the journal.",
          "Recurring non-conformities from one supplier are handled as corrective action: check the transport conditions and contract requirements, and audit or replace the supplier if necessary.",
        ],
      },
      {
        heading: "Packaging materials: what to check",
        bullets: [
          "Labelling showing the material is intended for food contact.",
          "No off odour, contamination or damage to rolls or boxes.",
          "Dimensions and thickness match the order — the tightness of the seal depends on it.",
          "A conformity document for the specific batch.",
        ],
      },
      {
        heading: "An electronic incoming inspection journal",
        paragraphs: [
          "In WeSetup the inspector picks the raw material and supplier from the directory, photographs the labelling and document and records the result of the check. The entry time is recorded automatically, edits are kept in the history, and when a batch is rejected the system offers to file a complaint with the supplier. For an audit, the journal is exported to PDF for the required period.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no fine for the journal itself: it is an internal HACCP procedure. But if during an inspection the business cannot show its incoming inspection records, this is treated as failure to apply the HACCP-based procedures required by TR CU 021/2011:",
      items: [
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000;",
        "Art. 6.3 of the CAO RF — breach of sanitary and epidemiological welfare legislation: for legal entities RUB 10,000 to 20,000 or suspension of operations for up to 90 days.",
      ],
      note: NOTE,
    },
  },

  batch_release: {
    sample: {
      caption:
        "A bakery shop’s entries for one shift: for each batch, what was checked before dispatch and who made the decision. The second batch was held back because of a label error and released after a recheck recorded in a separate row.",
      columns: ["Date", "Product", "Batch", "Quantity", "What was checked", "Decision", "Responsible person"],
      rows: [
        ["16.11.2026", "Tin-baked wheat bread", "261116-01", "320 pcs", "Taste and smell normal, weight of 10 pcs within tolerance, label correct", "Released", "Petrov S. A."],
        ["16.11.2026", "Sliced white loaf", "261116-02", "180 pcs", "Wrong production date on the label", "Not released, repacking", "Petrov S. A."],
        ["16.11.2026", "Sliced white loaf", "261116-02", "180 pcs", "Labels replaced, 10 pcs spot-checked", "Released", "Petrov S. A."],
        ["16.11.2026", "“Vinegret” beetroot salad, 250 g", "261116-05", "60 packs", "Sensory check, seal integrity, product at +4 °C", "Released", "Orlova N. S."],
      ],
    },
    sections: [
      {
        heading: "Who may release a batch",
        paragraphs: [
          "The right to release batches is assigned by order to specific people: the technologist, the production manager, the shift supervisor. What matters is that the decision is made not by whoever is in a hurry to ship, but by the person responsible for quality. The authorised employee signs the journal, so the signature later shows who took responsibility for the release.",
        ],
      },
      {
        heading: "What to check before release",
        bullets: [
          "The shift’s critical control point records: baking or heat treatment temperature, cooling.",
          "Sensory properties and appearance on a sample from the batch.",
          "Weight or number of units against the production order.",
          "Labelling under TR CU 022/2011: product name, ingredients, production date, shelf life, storage conditions, manufacturer.",
          "Packaging integrity and product temperature before loading.",
        ],
      },
      {
        heading: "How to assign a batch number",
        paragraphs: [
          "A batch is identical product made under the same conditions within a set period. In practice the number is built from the date and the line or shift: for example, 261116-02 means 16 November 2026, the second batch of the day. The number is printed on the label and stated in the shipping documents, so that when a customer complains you can immediately find the release record and the raw materials the batch was made from.",
        ],
      },
      {
        heading: "If a batch is not released",
        paragraphs: [
          "The batch is isolated and tagged “Not released”, and the journal records the reason and what happens next: rework, repacking, reprocessing or write-off. Once corrected, the batch is checked again and a new row is added — the original entry is not erased. If the same reason keeps recurring, corrective action is opened to find the source of the problem in the process.",
        ],
      },
      {
        heading: "Batch release in WeSetup",
        paragraphs: [
          "The responsible person opens the journal on a phone right at the packing line, picks the product from the directory and ticks off the checked items. The time of the decision and its author are recorded automatically, a reason is required for a refusal, and edits stay in the history. Entries can be found by batch number, and the batch release journal for any period is exported to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for missing release records. But releasing products without checks or supporting records breaches TR CU 021/2011, and if a substandard or mislabelled batch ends up in circulation, liability also arises for the product itself:",
      items: [
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000;",
        "Art. 14.4 Part 1 of the CAO RF — sale of goods, performance of work or provision of services of inadequate quality: for legal entities RUB 20,000 to 30,000.",
      ],
      note: NOTE,
    },
  },

  product_writeoff: {
    sample: {
      caption:
        "Entries for one week: for each case — the batch, quantity, reason and disposal method, with the signatures of a three-person committee. The reasons vary, and they show where money is being lost.",
      columns: ["Date", "Product", "Batch, best before", "Quantity", "Reason for write-off", "Disposal", "Committee"],
      rows: [
        ["10.11.2026", "Drinking yoghurt 2.5%, 0.3 L", "Batch 1031, until 09.11.2026", "8 pcs", "Shelf life expired", "Handed over for disposal under contract", "Petrov, Ivanova, Kozlov"],
        ["11.11.2026", "Chilled chicken fillet", "Batch 2208, until 15.11.2026", "3.2 kg", "Fridge failure, product stored at +12 °C", "Handed over for disposal under contract", "Petrov, Ivanova, Kozlov"],
        ["12.11.2026", "Premium wheat flour", "Batch 4417, until 01.06.2027", "12 kg", "Sack soaked by a roof leak", "Handed over for disposal under contract", "Petrov, Ivanova, Kozlov"],
        ["14.11.2026", "“Medovik” honey cake, 1 kg", "Batch 261113-03, until 18.11.2026", "2 pcs", "Deformed, packaging damaged", "Handed over for disposal under contract", "Petrov, Ivanova, Kozlov"],
      ],
    },
    sections: [
      {
        heading: "The write-off report as a primary accounting document",
        paragraphs: [
          "Under Federal Law No. 402-FZ, every business transaction must be recorded in a primary document. For a write-off, this is a report with mandatory details: the document title, date, organisation name, what happened, the quantity in physical and monetary terms, and the positions and signatures of the responsible people. The organisation approves the form itself — the journal in WeSetup contains all of these columns.",
          "Without a proper report, the accounting department cannot justify writing off the cost of the products, and the shortage will remain the liability of the person financially responsible for the stock.",
        ],
      },
      {
        heading: "Who sits on the committee",
        paragraphs: [
          "The committee is appointed by an order of the head of the business. It usually includes the head chef or production manager, the storekeeper or merchandiser, and the manager. The financially responsible person may take part but must not write off products alone: signatures from several people protect both the business and the employee.",
        ],
      },
      {
        heading: "The write-off procedure, step by step",
        bullets: [
          "Isolate the products and mark them “For write-off” so they are not used.",
          "Weigh or count them and photograph the packaging with its labelling.",
          "State the exact reason: expired shelf life, improper storage, supplier defect, spoilage during production.",
          "Decide how the products will be disposed of and attach the disposal handover document.",
          "Have the committee sign the report and pass it to accounting; if the supplier is at fault, send them a claim.",
        ],
      },
      {
        heading: "How to use write-off data",
        paragraphs: [
          "Once a month, group the entries by reason. Many write-offs for expired shelf life — review order volumes and the “first in, first out” rule. Repeated storage failures — check the refrigeration equipment and the temperature log. Defects from one supplier — grounds for complaints and a replacement. This turns write-offs from a formality into a tool for cutting losses.",
        ],
      },
      {
        heading: "Writing off products electronically",
        paragraphs: [
          "In WeSetup an employee creates the entry on a phone and attaches a photo, and the committee members confirm it on their own devices — no need to track each other down during the shift. The date and signatures are recorded automatically, edits are visible in the history, and a complaint to the supplier can be opened straight from the batch. The product rejection report is exported to PDF for accounting.",
        ],
      },
    ],
    fines: {
      intro:
        "A write-off report is an accounting document in itself, and there are no sanitary fines for not having one. Without it, the tax authority may refuse to accept the cost of the written-off products as an expense. The main risk is different: expired or spoiled products that were not written off and stayed in circulation or ended up in dishes:",
      items: [
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000;",
        "Art. 14.4 Part 1 of the CAO RF — sale of goods, performance of work or provision of services of inadequate quality: for legal entities RUB 20,000 to 30,000.",
      ],
      note: NOTE,
    },
  },

  traceability_test: {
    sample: {
      caption:
        "Entries from one scheduled test: two chains were traced, the third broke off — part of the flour could not be found in the issue records. Corrective action has been opened for it.",
      columns: ["Test date", "Starting point", "Direction", "What was found", "Quantity", "Test time", "Result", "Conducted by"],
      rows: [
        ["05.11.2026", "Sour cream 20%, batch 1102, “Molochny Dvor” LLC", "Forward: raw material → dishes", "Borscht, syrniki, sour cream sauce for 02–04.11.2026", "15 kg: 14.2 kg used, 0.8 kg in stock", "1 h 40 min", "Passed", "Ivanova M. P."],
        ["05.11.2026", "Chicken cutlet, produced 03.11.2026", "Backward: dish → raw materials", "Chicken fillet, batch 2208, VSD in the FSIS “Mercury” system; eggs, bread", "120 portions", "2 h 15 min", "Passed", "Ivanova M. P."],
        ["05.11.2026", "Wheat flour, batch 4417", "Forward: raw material → dishes", "Pancakes 03.11.2026; no usage record found for pirozhki", "25 kg: 23 kg confirmed, 2 kg not found", "3 h 50 min", "Failed, CAPA No. 14", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "What a traceability test is and why you need it",
        paragraphs: [
          "TR CU 021/2011 requires food products to be traceable: the business must know who supplied its raw materials and where its finished products went. GOST R ISO 22000-2019 adds that the traceability system must be tested. The test is a mock recall: you pick one batch of raw material or one dish and rebuild the chain from the records, as if a guest had complained or a supplier had sent a recall notice.",
        ],
      },
      {
        heading: "How to run the test, step by step",
        bullets: [
          "Pick a starting point without warning staff: a batch of raw material from a delivery note or a dish on a specific date.",
          "Note the start time.",
          "Follow the chain through the documents: delivery note and VSD, receiving journal, issues from the storeroom, labelling of semi-finished products, recipe cards, finished-product quality inspection journal.",
          "Balance the quantities: how much came in, how much was used, how much is left or was written off.",
          "Record the time, the result and any gaps found.",
        ],
      },
      {
        heading: "What counts as a successful result",
        paragraphs: [
          "The test is passed if the chain is fully rebuilt within the time limit set in the HACCP program and the mass balance matches, allowing a small tolerance for processing losses. If everything was found but the search took half a day, that is a warning sign too: in a real recall, the products would reach guests before you found them.",
        ],
      },
      {
        heading: "If the chain breaks",
        paragraphs: [
          "The gap is almost always in one of three places: the product was moved into another container without a label, an issue from the storeroom was not recorded, or the journal does not show the batch number. Corrective action is opened for each gap with an owner and a deadline, and a month later the test is repeated for the same product group.",
        ],
      },
      {
        heading: "Traceability in WeSetup",
        paragraphs: [
          "When receiving, quality inspections and write-offs are kept in WeSetup, the batch number links the records of different journals: searching by it shows when the raw material arrived, who accepted it and on which days it was used. The test takes minutes instead of hours, the time is recorded automatically, and the report is exported to PDF for the auditor.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no fine for skipping the test: it is an internal HACCP procedure. But the requirement to ensure product traceability is set out in TR CU 021/2011, and if during an inspection or a batch recall the business cannot rebuild the supply chain, that is a breach of the technical regulation:",
      items: [
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000.",
      ],
      note: `${NOTE} If guests are poisoned, a lack of traceability makes it much harder for the business to defend itself.`,
    },
  },

  metal_impurity: {
    sample: {
      caption:
        "A bakery’s entries for two days: raw materials pass through the magnetic separators on the sifters, and the metal detector on the packing line is checked with test pieces. A piece of wire was found in one batch of flour, and the batch was held.",
      columns: ["Date, shift", "Raw material / check", "Batch", "Processed, kg", "Contaminant weight, g", "Type of contaminant", "Action taken", "Signature"],
      rows: [
        ["10.11.2026, shift 1", "Premium wheat flour", "4417", "1,200", "0", "—", "—", "Petrov S. A."],
        ["10.11.2026, shift 1", "Granulated sugar", "0915", "300", "0.2", "Fine ferromagnetic dust", "Magnet cleaned, data passed to the technologist", "Petrov S. A."],
        ["11.11.2026, shift 2", "Wholemeal rye flour", "1029", "800", "1.4", "Piece of wire about 4 mm long, mill scale", "Batch held, complaint sent to supplier", "Orlova N. S."],
        ["11.11.2026, shift 2", "Packing line metal detector", "—", "—", "—", "Ferrous, non-ferrous and stainless steel test pieces detected", "Working properly", "Orlova N. S."],
      ],
    },
    sections: [
      {
        heading: "Where magnets and metal detectors are installed",
        paragraphs: [
          "Magnetic separators are fitted on sifters for flour, sugar, grains and spices — wherever bulk raw materials flow through. A metal detector is placed at the end of the line, before or after packing, to catch anything that got into the product during production. Whether a check is needed and where is decided by the hazard analysis: at some businesses it is a critical control point, at others a mandatory prerequisite program.",
        ],
      },
      {
        heading: "How to carry out the checks",
        bullets: [
          "Clean the magnets on schedule — usually at the end of the shift and after each batch is processed.",
          "Collect the removed contaminants on clean paper, weigh them and describe them: dust, shavings, wire, fragments of parts.",
          "Check the metal detector with test pieces of different metals at the start of the shift, after changeovers and at the end of work.",
          "If the detector misses a test piece, recheck all product made since the last successful check.",
        ],
      },
      {
        heading: "How to assess what you find",
        paragraphs: [
          "Traces of fine ferromagnetic dust are common in bulk raw materials and usually show that the magnet is working. The warning signs are large fragments or a growing contaminant weight from batch to batch. Look for the source in two directions: the supplier’s raw materials and your own equipment. Worn sieves, blades and augers produce characteristic shavings, so it helps to compare findings with the maintenance log.",
        ],
      },
      {
        heading: "What to do when metal is found",
        paragraphs: [
          "The batch of raw material or product is isolated and rechecked, and only then is its fate decided: approval after a repeat check, return to the supplier or disposal. The finding is kept in a labelled bag until the investigation is over — it is needed for the complaint. If the source is inside the plant, the equipment is stopped until repaired and corrective action is opened.",
        ],
      },
      {
        heading: "Logging metal contaminants from a phone",
        paragraphs: [
          "In WeSetup each sifter and detector has its own QR code: the operator scans it, enters the weight and a photo of the finding and records the result of the test-piece check. The time is recorded automatically, the manager is notified of any finding, and a missed scheduled check is visible at once. The journal is exported to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for this journal: it is a procedure for controlling physical hazards within the HACCP system. But if metal gets into a product and the business cannot show that checks were carried out, that is a breach of TR CU 021/2011:",
      items: [
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000;",
        "Art. 14.4 Part 1 of the CAO RF — sale of goods, performance of work or provision of services of inadequate quality: for legal entities RUB 20,000 to 30,000.",
      ],
      note: NOTE,
    },
  },

  glass_items_list: {
    sample: {
      caption:
        "An extract from the list by area: each item has a number, material, quantity and protection. The remarks show that fragile items are replaced with shatterproof ones wherever possible.",
      columns: ["No.", "Area", "Item", "Material", "Qty", "Protection / remarks", "Checked"],
      rows: [
        ["1-1", "Hot kitchen", "Light fixture cover", "Glass", "6", "Protective mesh", "03.11.2026"],
        ["1-2", "Hot kitchen", "Combi oven viewing window", "Tempered glass", "2", "—", "03.11.2026"],
        ["2-1", "Cold kitchen", "Spice container with lid", "Brittle plastic", "8", "Replace with polypropylene by 30.11.2026", "03.11.2026"],
        ["3-1", "Pastry kitchen", "Display cabinet door", "Glass", "1", "Protective film", "03.11.2026"],
        ["4-1", "Storeroom", "Wall clock", "Glass", "1", "Move out of the storage area", "03.11.2026"],
      ],
    },
    sections: [
      {
        heading: "What to include in the list",
        bullets: [
          "Light fittings, light covers, insect trap lamps.",
          "Windows, glass doors, display cases, mirrors.",
          "Equipment viewing windows and gauges, scale displays, glass thermometers.",
          "Containers and utensils made of glass or brittle plastic: jars, containers, measuring jugs, lids.",
          "Clocks, glass signs, protective screens.",
        ],
      },
      {
        heading: "How to draw up the list by area",
        paragraphs: [
          "The list is compiled by walking through the premises with a floor plan: in each area, look from top to bottom — ceiling, walls, equipment, work tables. Items are numbered “area–position” and, where possible, labelled with a sticker so that after a breakage it is immediately clear what broke. The condition of each item on the day of the walkthrough is recorded. The list is approved by the person responsible for the HACCP system and is used for scheduled integrity checks.",
        ],
      },
      {
        heading: "How to reduce the number of fragile items",
        paragraphs: [
          "The best list is a short one. Glass light covers are replaced with fittings that have polycarbonate diffusers or are covered with mesh, display glass gets a protective film, and glass containers are swapped for metal or shatterproof plastic ones. Personal glass items — bottles, jars, glasses unless needed — are not brought into the production area; this rule is set out in the staff instructions.",
        ],
      },
      {
        heading: "When to update the list",
        bullets: [
          "When equipment is bought, replaced or moved.",
          "After every breakage, if the item is not restored or is replaced with a different one.",
          "When premises are redesigned or change their purpose.",
          "Following an internal audit.",
        ],
      },
      {
        heading: "Common gaps found during audits",
        bullets: [
          "Items above work areas are missing from the list: extractor hood lights, lamps in cold rooms.",
          "The quantity in the list does not match reality because the list was not updated after renovation.",
          "Items are listed without an area — after a breakage it is unclear where to look and what to check against.",
          "The list exists, but no scheduled checks are carried out against it.",
        ],
      },
      {
        heading: "The fragile items list in WeSetup",
        paragraphs: [
          "In WeSetup the list is kept by area and linked to the glass inspection journal: during a scheduled check, an employee sees the items for their area and marks each as present and intact from a phone. Changes to the glass and brittle plastic items list are saved in the history with the date and author, and the current version is exported to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no specific fine for not having the list. It is a HACCP document for managing physical hazards: without it, the business cannot show that the risk of glass getting into products has been assessed and is under control, as TR CU 021/2011 requires:",
      items: [
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000.",
      ],
      note: NOTE,
    },
  },

  glass_control: {
    sample: {
      caption:
        "Entries from two scheduled walkthroughs: for each area, the number of items is checked against the list. The third row shows how a broken light cover and the decision on the products in the area are recorded.",
      columns: ["Date", "Area", "Per list", "Present and intact", "Found", "Action taken", "Checked by"],
      rows: [
        ["02.11.2026", "Hot kitchen", "8", "8", "—", "—", "Ivanova M. P."],
        ["02.11.2026", "Cold kitchen", "10", "9", "Cracked lid on container No. 2-1", "Removed, replaced with a polypropylene one", "Ivanova M. P."],
        ["09.11.2026, 10:40", "Hot kitchen", "8", "7", "Light cover No. 1-1 broken", "Work stopped, fragments collected, 14 kg of products disposed of, report No. 5", "Committee: Ivanova M. P., Petrov S. A., Kozlov A. A."],
        ["09.11.2026", "Storeroom", "3", "3", "—", "—", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Scheduled check: how to walk through the areas",
        paragraphs: [
          "How often the walkthrough is done is set in the HACCP program — most often once a week. The inspector follows the item list, not memory: finds each item by its number and checks that it is in place, with no cracks, chips or loose fixings. The “present and intact” count must match the list; any discrepancy is recorded and investigated the same day.",
          "Along the way, check whether fragile items not on the list have appeared in the area: a glass spice jar, a personal mug, a new lamp. They are removed from the area or added to the list — the latter only if the item cannot be done without.",
        ],
      },
      {
        heading: "What to do when glass breaks",
        bullets: [
          "Stop work in the area and inform the responsible person.",
          "Cordon off the area where fragments may have scattered, and do not take products or utensils out of it.",
          "Collect the fragments with a brush and dustpan; check the floor, equipment, shelves and staff clothing.",
          "Lay out the collected fragments and compare them with the shape of the intact item to see whether everything has been found.",
          "Clean the area and resume work once the responsible person allows it.",
        ],
      },
      {
        heading: "Deciding what happens to the products",
        paragraphs: [
          "All open products and semi-finished products within the possible scatter zone are disposed of — it is impossible to check them for tiny fragments. Products in closed containers are inspected and the containers are washed on the outside. The amount disposed of and the decision are recorded in a report signed by the committee; the report number is entered in the journal.",
        ],
      },
      {
        heading: "Root cause review after every incident",
        paragraphs: [
          "Corrective action is opened for every breakage and every crack found: why the item broke, whether it can be replaced with a shatterproof one, whether it needs protection. If a fragile item is removed or replaced, the list is updated right away — otherwise the count will not match at the next walkthrough.",
        ],
      },
      {
        heading: "Glass control in WeSetup",
        paragraphs: [
          "The inspector starts a walkthrough on a phone, sees the items for their area from the list and checks off each one. The entry time is recorded automatically; when something breaks, the app guides you step by step, asks for a photo of the area and the committee’s signatures, and the manager gets a notification. The glass and brittle plastic inspection journal for any period is exported to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for this journal: controlling fragile items is a HACCP procedure. But if a fragment gets into a product and there are no records of checks or of the response to breakages, the business has nothing to show that the physical hazard was under control:",
      items: [
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000;",
        "Art. 14.4 Part 1 of the CAO RF — sale of goods, performance of work or provision of services of inadequate quality: for legal entities RUB 20,000 to 30,000.",
      ],
      note: NOTE,
    },
  },

  tableware_breakage: {
    sample: {
      caption:
        "A cafe’s entries for three days: breakages in the dining room, the bar and the kitchen. Where fragments could have got into food or ice, a separate column shows this together with the decision taken.",
      columns: ["Date, time", "What broke", "Qty", "Where", "Cause", "Fragments collected", "Food", "Responsible person"],
      rows: [
        ["12.11.2026, 13:20", "Soup plate", "1", "Dining room, table 7", "Fell off a tray", "Yes, area checked", "Not affected", "Sidorova A. V."],
        ["12.11.2026, 16:05", "Tumbler", "2", "Bar", "Cracked during washing", "Yes", "Ice in the bin discarded, bin washed", "Sidorova A. V."],
        ["13.11.2026, 11:40", "Glass salad bowl", "1", "Cold kitchen, prep table", "Slipped out of hands", "Yes", "1.5 kg of sliced cucumbers written off", "Ivanova M. P."],
        ["14.11.2026, 19:10", "Wine glass", "1", "Dishwashing area", "Chip found during washing", "Yes", "Not affected", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Which incidents to record",
        paragraphs: [
          "Record every breakage — in the dining room, at the serving counter, in the bar, in the dishwashing area and in the kitchen — even if only one cup broke. Also record chipped and cracked tableware found during washing or table setting: it is as dangerous as broken tableware and is taken out of use at once, not “at the end of the shift”.",
        ],
      },
      {
        heading: "How to clean up fragments so nothing is left behind",
        bullets: [
          "Do not pick up fragments by hand: use a brush, a dustpan and heavy-duty gloves.",
          "Inspect the floor across the whole scatter area, under tables and equipment; pick up tiny particles with a damp cloth.",
          "Check nearby plates, cutlery and glasses on the guest’s table and replace them if in doubt.",
          "Put the fragments in a thick bag or box so that whoever takes out the rubbish does not get hurt.",
          "If the breakage happened over open food, ice or a sink with dishes — write off the food, drain the sink and check it.",
        ],
      },
      {
        heading: "What a month of records shows",
        paragraphs: [
          "Once a month it is worth reviewing the whole journal. If breakages keep happening in the same place, the cause is usually how work is organised: overloaded trays, unstable racks, a cramped dirty-dish return area, a harsh dishwasher cycle. If new staff break more, they need training. Breakage records also help with tableware stocktaking: shortages can be explained with documents.",
        ],
      },
      {
        heading: "How it fits into the HACCP program",
        paragraphs: [
          "Glass and porcelain fragments are a physical hazard that the business must cover in its hazard analysis under TR CU 021/2011. Recording broken tableware is a simple, verifiable control measure for this hazard. The breakage procedure is best set out in a short instruction posted in the bar and at the dishwashing area.",
        ],
      },
      {
        heading: "A broken tableware journal on your phone",
        paragraphs: [
          "In WeSetup a waiter or dishwasher makes an entry in half a minute: picks the item and location from a list and notes whether the fragments were collected and whether food was nearby. The time is recorded automatically, the manager sees the incidents for the shift and statistics by cause, and the journal is exported to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for not keeping such records: it is an internal procedure of the business. But if a guest finds a fragment in a dish, the business is liable for an unsafe product and a substandard service, and records of fragment clean-up are one of the few ways to show that action was taken:",
      items: [
        "Art. 14.43 of the CAO RF — breach of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000;",
        "Art. 14.4 Part 1 of the CAO RF — sale of goods, performance of work or provision of services of inadequate quality: for legal entities RUB 20,000 to 30,000.",
      ],
      note: NOTE,
    },
  },
};
