import type { JournalFaqExtra } from "./types";

export const FAQ_EXTRA_EN_B: JournalFaqExtra = {
  perishable_rejection: [
    {
      q: "What is the difference between a perishable food quality check and a prepared food quality check?",
      a: "They are two different journals. The perishable food quality check (brakerazh) is the incoming inspection on arrival: the safety document, sensory assessment, storage conditions and the final sell-by date of each batch of raw materials. The prepared food quality check is done later, before serving: a committee assesses dishes that have already been cooked and approves them for serving. One journal does not replace the other.",
    },
    {
      q: "Who should keep the perishable food quality check journal?",
      a: "Whoever receives the products: the storekeeper, the production manager or the head chef. The responsible person, and whoever stands in for them at weekends and for early deliveries, is appointed by order. The journal is signed by the person who actually inspected the batch, not by whoever later copies entries from the delivery notes.",
    },
    {
      q: "Does product temperature need to be recorded in the perishable food quality check journal?",
      a: "The recommended form in Appendix No. 5 to SanPiN 2.3/2.4.4282-26 has no separate column for temperature. Temperature still has to be measured on receipt: the result is written in the “Notes” column or in the receiving log. The form is only recommended, so the organisation may add its own temperature column.",
    },
    {
      q: "What goes in the “Final sell-by date” column?",
      a: "The date and hour by which the batch must be used or sold. It is calculated from the production date on the manufacturer's label, not from the date of receipt, and takes storage conditions into account. When the batch has been used up, the “Date and hour of actual sale” column is filled in, which shows that nothing was kept beyond its date.",
    },
  ],

  incoming_control: [
    {
      q: "Where can I download a free incoming inspection journal template?",
      a: "On this page: the “Download PDF” button, and there is also a Word (DOCX) version. Enter your email and company name: the name is placed in the header of the form, which you can print straight away. If you would rather not copy delivery notes by hand, the journal can be kept electronically, free for the first 14 days, and exported to PDF for an inspection.",
    },
    {
      q: "Which products must be rejected at incoming inspection?",
      a: "Products without labelling and without safety documents, including without a veterinary accompanying document (VSD) for controlled goods; past their expiry date; with signs of spoilage or refreezing; delivered in breach of transport temperature; in dirty, wet or damaged packaging. Such goods are not added to stock, and a return is issued with a formal report.",
    },
    {
      q: "Should packaging labels be kept after receiving goods?",
      a: "Yes. Labels from the supplier's packaging, with the batch number, production date and expiry date, are kept until that batch has been fully used. If the product was transferred into containers, the label is kept next to it or photographed and attached to the receiving record, so that during an inspection or a complaint you can immediately find where the batch came from.",
    },
    {
      q: "Can a VSD be closed in Mercury before the vehicle has been inspected?",
      a: "No. Closing (redeeming) the VSD confirms that the batch has actually been accepted and matches the documents. First the vehicle, temperature, labelling and packaging are checked, and only then is the VSD closed. If part of the batch is not accepted, the VSD is closed with a partial return or a rejection, otherwise the products you did not accept will remain registered to you.",
    },
  ],

  fryer_oil: [
    {
      q: "How often should frying oil be changed?",
      a: "The sanitary rules set no single period: oil is changed based on assessments before and after frying. Reasons to change it are a score below the business's threshold, darkening, thickening, heavy foaming, smoke at normal temperature, a rancid smell or exceeding the limit on a polar compounds tester. Many cafes also set a maximum period, for example no more than 7 shifts, and fix both rules in the production control programme.",
    },
    {
      q: "Can fresh oil be topped up into old frying oil?",
      a: "Oil can be topped up to the working level, but topping up does not renew the frying oil: oxidation products remain in the mix. So after topping up, the oil is assessed again and a separate line is written. When the oil has reached the end of its use, the spent fat is drained completely, the fryer tank is washed, and only then is fresh oil poured in.",
    },
    {
      q: "How should used frying oil be disposed of?",
      a: "It must not be poured down the drain. The oil is cooled, collected in closed containers and handed over to a company that collects used fats under contract. The contract and the handover reports are kept with the journal: an inspector may request them and compare the amount of oil handed over with purchases and disposal records.",
    },
    {
      q: "Where can I download a free frying oil journal template?",
      a: "On this page, using the “Download PDF” button. The form has columns for assessing the oil before and after frying, the carry-over balance and disposal; the company name you enter when downloading is placed in the header. If it is easier to record the oil from a phone at the fryer, the journal can be kept electronically, free for the first 14 days.",
    },
  ],

  incoming_raw_materials_control: [
    {
      q: "Who carries out incoming inspection of raw materials?",
      a: "An employee appointed by order: a technologist, a quality specialist or a laboratory assistant, and in a small production facility a storekeeper supervised by the technologist. The decision to release a batch is made by an authorised person, who must have a deputy. Laboratory parameters are determined by an accredited laboratory, to the scope and frequency set in the production control programme.",
    },
    {
      q: "What is the difference between incoming inspection of raw materials and receiving goods?",
      a: "In catering, receiving is mainly a check against the delivery note, documents and labelling. Incoming inspection in a HACCP-based production facility is broader: it covers raw materials, ingredients and packaging materials, checks them against criteria from technical specifications, GOST standards or the supplier's specification, and ends with a decision on the batch: release, quarantine or return with a claim.",
    },
    {
      q: "Does every batch of raw materials need a laboratory test?",
      a: "As a rule, no. Every batch is checked against the supplier's documents, labelling, packaging and sensory assessment, while laboratory tests are carried out on the schedule in the production control programme. An unscheduled test is needed if there are doubts about quality, for the first delivery from a new supplier and after claims.",
    },
    {
      q: "What does it mean to put raw materials in quarantine?",
      a: "It is a temporary ban on using a batch until a decision is made on it. The raw materials are stored separately from released stock, with a “Quarantine” label and the date, and are not issued to production. Quarantine is needed if a document is missing, a laboratory result is awaited or there are doubts about the packaging. The final decision, release or return, is recorded in the journal as a separate line.",
    },
  ],

  batch_release: [
    {
      q: "What is the difference between batch release and a prepared food quality check?",
      a: "In catering, the quality check is the assessment of dishes before serving: a committee tastes them and approves serving. Batch release is the decision to release and ship production output to a customer. Before it, not only taste and appearance are checked but also the critical control point records for the shift, weight, labelling and packaging, and the decision is tied to the batch number.",
    },
    {
      q: "Can a batch be shipped before the checks are finished?",
      a: "No. Until a decision is made, the batch is stored separately, marked “Awaiting release”, and is not loaded onto a vehicle. Which results must be awaited before release and which tests are carried out selectively is fixed by the business in its production control programme. The release entry is made before shipment, not after the fact.",
    },
    {
      q: "How many items should be checked before releasing a batch?",
      a: "The sample size and sampling rule are set by the business itself in its release procedure or in the product's technical specifications. The key thing is to take items from different parts of the batch, from the beginning, middle and end of the run, not just the top boxes. The number of units checked is recorded in the release line so that the decision can be justified.",
    },
    {
      q: "What should I do if a customer returns a batch with a complaint?",
      a: "Use the batch number to find the release entry, the control point records for that shift and the raw materials the products were made from. Isolate the remaining stock of that batch in the warehouse and in transit until the review is complete. If the complaint is confirmed, the journal records the decision on the returned products, and a corrective action is opened to find the cause.",
    },
  ],

  product_writeoff: [
    {
      q: "How do I write off expired products?",
      a: "Remove the products from circulation immediately and mark them “For write-off”. A committee counts or weighs them and draws up a report: name, batch, expiry date, quantity, amount, reason and method of disposal. The report is signed by the committee members and approved by the manager, then passed to the accounts department. Expired products must not be reprocessed or used in dishes: the circulation of products past their expiry date is prohibited.",
    },
    {
      q: "Can expired goods be returned to the supplier instead of being written off?",
      a: "Yes, if the contract provides for returns, for example a clause on returning goods nearing expiry. In that case a return document is issued instead of a write-off report. If the supplier delivered defective goods, a non-conformity report is drawn up and a claim is sent. But if the goods expired in your own storeroom and the contract does not provide for returns, they are written off with a report.",
    },
    {
      q: "Should products be written off after a temperature breach if they look fine?",
      a: "Appearance and smell do not guarantee safety: microorganisms multiply long before spoilage is visible. If perishable products were stored outside the required conditions and their safety cannot be confirmed, the responsible person decides to write them off. The report states the reason precisely, “breach of storage conditions”, specifying what was wrong and for how long.",
    },
    {
      q: "Should products be written off straight away or once a month?",
      a: "Each case is recorded on the day it is found: expired or spoiled products should not wait in the storeroom until the end of the month. The entry or report is made at the time, and the accounts department can record write-offs in a summary for the period. If reports are saved up, the link to the cause is lost and it becomes harder to make a claim against the supplier.",
    },
  ],

  traceability_test: [
    {
      q: "How often should a traceability test be carried out?",
      a: "The frequency is set by the HACCP programme. In practice the test is carried out at least once a year, and preferably every quarter or six months for different product groups. An unscheduled test is needed after a change of supplier, a move to a new accounting system and after a failed test, which is repeated about a month later to check the corrections.",
    },
    {
      q: "How long should a traceability test take?",
      a: "The business sets its own time standard in the HACCP programme. Many aim for up to 4 hours from the request to a complete chain with a mass balance. If everything was found but the search took a day, the test has formally been passed but the system has not: in a real recall the products would reach customers in that time.",
    },
    {
      q: "What is the difference between a traceability test and a product recall?",
      a: "A test is a practice exercise on paper: no products are withdrawn and customers are not disturbed, the chain is only reconstructed from records. A real recall means withdrawing a batch from circulation and notifying customers and, where required, the supervisory authorities. The test is there so that in a real situation a recall goes quickly and with no blind spots.",
    },
    {
      q: "Does a small cafe need a traceability test?",
      a: "The traceability requirement of TR CU 021/2011 applies to everyone who produces food, including cafes. A small business can use a simple version: pick one batch from a delivery note and use the receiving and quality check journals to find when it arrived, who accepted it and which dishes it went into. The result and the time taken are recorded in the journal.",
    },
  ],

  metal_impurity: [
    {
      q: "Is a metal detector mandatory in food production?",
      a: "The regulations contain no direct requirement to install a metal detector. The decision is based on hazard analysis: if metal can get into the product from raw materials or equipment, a control measure is needed, such as a magnetic separator, a sieve or a metal detector. Which measure was chosen and why is recorded in the HACCP plan, and its operation is confirmed by entries in this journal.",
    },
    {
      q: "What test pieces are needed to check a metal detector?",
      a: "Usually three types: ferrous metal, non-ferrous metal and stainless steel. The size of the test pieces matches the sensitivity the business set in its control procedure, based on the detector manufacturer's recommendations. The test pieces are passed through the centre of the flow, together with the product or in packaging. The test pieces themselves are labelled and kept under record so that they do not end up in the product.",
    },
    {
      q: "How much metal contamination is allowed in flour and other raw materials?",
      a: "The permitted content of metallic magnetic impurities is stated in the GOST standard or technical specifications for the specific raw material; check the document named on the label. For flour, for example, both the mass of impurities and the particle size are regulated. Large fragments (wire, shavings, parts) are unacceptable regardless of the standard: the batch is held and a claim is made against the supplier.",
    },
    {
      q: "How often should magnetic separators be cleaned and checked?",
      a: "Magnets are cleaned on the schedule in the control procedure, and more often if the mass of findings grows: an overloaded magnet holds particles less well. Over time magnets lose strength, so they are checked periodically using the method given in the manufacturer's documentation and replaced if their strength drops. The result of this check is also recorded in the journal.",
    },
  ],

  glass_items_list: [
    {
      q: "Does a cafe or restaurant need a list of glass items?",
      a: "Yes, if the business has implemented HACCP procedures: glass is a physical hazard that has to be accounted for. The list is drawn up for production areas: the kitchen, preparation rooms, storeroom and bar preparation area. Tableware for guests is usually not included: breakages are recorded in a separate broken tableware journal.",
    },
    {
      q: "What counts as brittle plastic?",
      a: "Rigid plastic that shatters into sharp fragments on impact, in the cold or with age: acrylic glass, polystyrene, rigid lids and device housings, light diffusers, clear containers. Flexible containers made of food-grade polypropylene and polyethylene are usually not included. If you are not sure how an item will behave, it is better to put it on the list.",
    },
    {
      q: "Should jars and bottles of food be included in the glass list?",
      a: "Glass containers with ingredients (sauces, preserves, drinks) are also a risk, but each jar is not entered in the list. Instead, the list states where they are stored and the handling rules: glass is stored away from uncovered food, opened in a designated area, and containers are checked for chips on receipt. Breakage of such containers is recorded in the glass inspection journal.",
    },
    {
      q: "Can glass thermometers be used in the kitchen?",
      a: "A glass thermometer in a production area is a high-risk item: if it breaks, both the fragments and the contents of the bulb get into the product. It is better to replace it with an electronic one or put it in a protective casing. If glass thermometers are still used, each one is entered in the list with a number and location and checked on every scheduled round.",
    },
  ],

  glass_control: [
    {
      q: "What should I do if a lamp breaks above a production line?",
      a: "Stop the line, cordon off the area and dispose of all uncovered products on and under the line. Fragments are collected with a separate labelled kit (brush, dustpan and container) that is not used for ordinary cleaning. Equipment within the scatter zone is inspected, and removable parts are taken off and checked. Work resumes only after the responsible person gives permission and an entry is made in the journal.",
    },
    {
      q: "Should cracks and chips be recorded if the glass did not break?",
      a: "Yes. A crack or chip means an item that is about to become fragments. It is removed or covered immediately, then repaired or replaced and recorded in the journal. If a piece has broken off the item, this is treated as a breakage: the fragment is searched for and a decision is made on the products that were nearby.",
    },
    {
      q: "What should I do if not all fragments are found after glass breaks?",
      a: "Widen the search area and check equipment, containers, and the clothing and footwear of workers. If the fragments are still not found, none of the products that could have been in the scatter zone are released. The journal states plainly that the fragment was not found and what decision was made, and a corrective action is opened.",
    },
    {
      q: "Who is on the committee when glass breaks?",
      a: "Usually the area manager, the person responsible for the HACCP system or the technologist, and the worker who found the breakage. The committee is fixed in the procedure in advance, so that no one has to look for who should sign at the moment of the incident. The committee checks that all fragments were collected, decides what happens to the products and signs a report, whose number is entered in the journal.",
    },
  ],

  tableware_breakage: [
    {
      q: "Does a restaurant need to keep a broken tableware journal?",
      a: "The sanitary rules have no mandatory form: it is an internal procedure under the HACCP programme. But the entries show that each time something broke, the fragments were collected and nearby food was checked. Do not confuse it with stock accounting: the journal answers a safety question, while for the accounts department breakages are documented in a separate report.",
    },
    {
      q: "Can chipped tableware be used?",
      a: "No. Sanitary requirements for catering do not allow the use of tableware with cracks, chips and broken edges: a fragment may come off it, and dirt is harder to wash out of cracks. Such tableware is removed as soon as it is noticed, during washing or when laying tables, and recorded in the journal.",
    },
    {
      q: "What should I do if a glass breaks in the ice bin?",
      a: "All the ice in the bin is thrown away: it is impossible to find small fragments in ice. The bin is emptied completely, inspected, washed and treated according to the equipment instructions, then filled with fresh ice. Use a scoop to take ice, not a glass: this is the most common cause of such breakages.",
    },
    {
      q: "How do I write off broken tableware?",
      a: "For the accounts department, breakages are documented in a broken tableware report, for each case or as a summary for the period. The journal entries serve as the basis for the report: they already contain the date, what was broken, the quantity and the circumstances. During a tableware stocktake they explain any shortfall with documents.",
    },
  ],

  equipment_maintenance: [
    {
      q: "How often should refrigeration equipment be serviced?",
      a: "At least as often as stated in the manufacturer's data sheet or in the contract with the service company. If a cold room stands in a hot or dusty area, the condenser is cleaned more often: a dirty condenser is a common cause of compressor overheating. Every day, staff themselves monitor the temperature, the condition of the door seals and ice build-up on the evaporator.",
    },
    {
      q: "Is a contract needed for equipment maintenance?",
      a: "Not necessarily: simple work can be done by an in-house technician. But anything that requires qualifications and permits (work with refrigerant, electrics, gas equipment) is entrusted to specialists. The contract and the service company's reports are the simplest proof that maintenance was actually carried out.",
    },
    {
      q: "What is the difference between maintenance and repair?",
      a: "Maintenance is scheduled work to keep equipment from breaking down: cleaning, adjustment, lubrication, replacement of consumable parts. Repair is work after a breakdown. Scheduled maintenance is recorded in the maintenance journal, and each failure and its repair in the breakdown history card for that piece of equipment.",
    },
    {
      q: "What should a maintenance completion report include?",
      a: "The date, the equipment with its inventory or serial number, the list of work done, parts replaced, the result (in working order or with remarks), recommendations, and the signatures of the person who did the work and the employee who accepted it. The report number is entered in the journal line, and the report itself is kept alongside.",
    },
  ],

  breakdown_history: [
    {
      q: "Do minor breakdowns need to be recorded?",
      a: "Yes, any failures that disrupted work: a torn door seal, a sensor fault, a tripped circuit breaker. It is repeated minor faults that usually signal a serious failure ahead. The only thing not recorded in the card is the scheduled replacement of consumable parts, which is work under the maintenance schedule.",
    },
    {
      q: "How do I know when it is cheaper to replace equipment than repair it?",
      a: "Add up the cost of repairs, products written off because of breakdowns and losses from downtime over the last 12 months, and compare the total with the price of new equipment. Take into account its age relative to the service life in the data sheet, the availability of spare parts and power consumption. If the total approaches the replacement cost or the same breakdown keeps recurring, the equipment should be replaced.",
    },
    {
      q: "How do I keep a breakdown history for a refrigerator owned by a supplier?",
      a: "Branded refrigerators for drinks or ice cream are usually repaired by their owner, but your business is responsible for the temperature of the products. So the breakdown is recorded in the card in the same way: the date, the symptoms, when the request was sent to the owner, when they came and what they did. A long wait for repair is an argument in discussions with the supplier.",
    },
    {
      q: "Should repair reports be kept with the breakdown card?",
      a: "Yes. The number of the report or invoice is entered in the card line, and the documents themselves are kept next to it or a scan is attached to the entry. The reports are needed by the auditor, the accounts department and for warranty claims: they show who did what work and which parts were replaced.",
    },
  ],

  equipment_calibration: [
    {
      q: "Does a refrigerator thermometer need verification?",
      a: "Yes, if you use its readings to keep the temperature journal and show the inspector that storage requirements are met. The thermometer must be of an approved type and have valid verification. A household thermometer of no approved type cannot be verified: it can be kept as an additional one, but journal entries are made from the verified instrument.",
    },
    {
      q: "What is the difference between verification and calibration?",
      a: "Verification is mandatory for measuring instruments used in the area of state regulation of ensuring the uniformity of measurements. It is carried out by an accredited organisation, and the result is entered in the FGIS Arshin register. Calibration is a voluntary procedure for instruments outside this area: it determines the instrument's error but does not give it verified status.",
    },
    {
      q: "How often do scales and thermometers need verification?",
      a: "At the interval stated in the instrument's type description: this is the verification interval, which for many thermometers and scales is one year. For a new instrument the period runs from the date of initial verification by the manufacturer, not from the date of purchase. After repair, a fall or damage to the seal, an extraordinary verification is needed.",
    },
    {
      q: "How can I check whether an instrument has been verified?",
      a: "Look it up in FGIS Arshin on the Rosstandart website by type and serial number. The record shows who carried out the verification, whether the instrument was found fit for use and until what date the verification is valid. If there is no record or the period has expired, the instrument's readings cannot be relied on at an inspection, even if you have a paper certificate.",
    },
  ],

  accident_journal: [
    {
      q: "What should I do with food if the power goes off overnight?",
      a: "Do not open cold rooms and freezers until the power is back. Once it is on, measure the temperature of the food itself with a probe, not just the air, and estimate how long it was outside the required conditions. The decision to release, urgently process or write off is made by the responsible person. Thawed food is not refrozen.",
    },
    {
      q: "Who fills in the incident journal?",
      a: "The first entry is made by whoever discovered the problem: the time, what they saw, the thermometer readings. The responsible person (the head chef, production manager or general manager) adds the measures taken and the decision on the products. At night the problem is often noticed by security or the person on duty: they need clear instructions on whom to call.",
    },
    {
      q: "What is the difference between an incident journal and an equipment breakdown card?",
      a: "The breakdown card is about the equipment: what broke, why and how much the repair cost. The incident journal is about the consequences for products and processes: what was affected and what was decided about it. One event, such as a cold room failing overnight, goes into both documents, and it is convenient to link the entries.",
    },
    {
      q: "How can I prove that food is safe after an incident?",
      a: "With records: the start and end time of the deviation, thermometer readings or temperature logger data, inspection results and the responsible person's decision with its justification. If safety cannot be confirmed from these data, the food is sent for laboratory testing or written off: a release decided by eye cannot be defended later.",
    },
  ],

  inventory_condition: [
    {
      q: "How often should chopping boards be replaced?",
      a: "There is no fixed period: boards are replaced according to their condition. Reasons for replacement are deep cuts where dirt remains, cracks, delamination, chipped corners and warping after hot washing. A damaged board is removed during an inspection or as soon as it is noticed, and a board with the same colour coding is issued in its place.",
    },
    {
      q: "What should I do with a knife that has a chipped blade?",
      a: "Take it out of use immediately and try to find the broken-off fragment. Check the food that was cut with this knife: if the fragment is not found, the food is not released for serving. The knife is sent for professional sharpening or replaced, and both the damage and the decision on the food are recorded in the journal.",
    },
    {
      q: "Can metal scourers be used in a commercial kitchen?",
      a: "A metal scourer that is coming apart leaves wire strands on tableware and utensils, which is a direct physical hazard. That is why many businesses replace them with plastic brushes and scrapers under their HACCP programme. If metal scourers are still used, their condition is checked at every inspection and they are replaced at the first signs of wear.",
    },
    {
      q: "What is the difference between a utensil inspection and glass control?",
      a: "Items made of glass and brittle plastic are kept on a separate list and checked in the glass inspection journal. Here the working utensils are inspected: knives, boards, spatulas, sieves, metal and plastic containers. To avoid checking the same thing twice, the HACCP procedure sets out in advance which journal each item belongs to.",
    },
  ],

  pool_water_control: [
    {
      q: "How often should pool water be tested in a laboratory?",
      a: "At the frequency set in the production control programme, drawn up with regard to SP 2.1.3678-20. Samples for microbiological and chemical parameters are taken by an accredited laboratory. Staff's own measurements (chlorine, pH, temperature) do not replace laboratory control, and the laboratory reports are kept with the journal.",
    },
    {
      q: "What is the difference between free chlorine and combined chlorine?",
      a: "Free chlorine is the active part that disinfects the water. Combined chlorine forms when chlorine reacts with contaminants from swimmers (sweat, creams, urea): it is what gives the sharp “bleach smell” and irritates the eyes. A rise in combined chlorine is a signal to step up water treatment and the supply of fresh water. The permitted values for both are taken from the production control programme.",
    },
    {
      q: "What should I do if the pool water turns cloudy?",
      a: "Cloudiness is a sign that filtration or disinfection is not coping. Check the filters and recirculation, backwash the filters if necessary, measure chlorine and pH and adjust the dosing. If clarity is not restored, the pool is closed to visitors until it is fixed, and the closing and reopening times are recorded in the journal.",
    },
    {
      q: "What instrument should be used to measure chlorine and pH in a pool?",
      a: "A tablet test kit or a photometer will do: the photometer is more accurate and does not depend on how a person perceives the colour shade. Free and combined chlorine are measured by the same method, reagents are kept within their shelf life, and the instrument is maintained according to its instructions. It is useful to state in the production control programme what is used for measuring.",
    },
  ],

  instrument_sterilization: [
    {
      q: "What is the difference between disinfection and sterilisation of instruments?",
      a: "Disinfection destroys infectious agents but not all forms of microorganisms. Sterilisation destroys everything, including spores. An instrument that can damage the skin or mucous membranes goes through three stages: disinfection, pre-sterilisation cleaning and sterilisation. Without thorough cleaning, sterilisation does not guarantee the result: dirt protects microorganisms.",
    },
    {
      q: "Can instruments be sterilised in a UV cabinet?",
      a: "No. A UV cabinet does not sterilise instruments: it is only designed for storing instruments that have already been sterilised. Sterilisation is done in a dry heat steriliser or an autoclave using the mode from the device's instructions, and every cycle is recorded in the journal with the indicator result.",
    },
    {
      q: "How long can a sterile instrument be stored?",
      a: "It depends on the packaging: the storage period in kraft and combined pouches is stated in the instructions for the packaging material, and it runs from the sterilisation date written on the pouch. An instrument sterilised without packaging is used immediately or stored only as the instructions allow. An opened pouch is not reused.",
    },
    {
      q: "How can I check that a dry heat steriliser actually sterilises?",
      a: "Chemical indicators are placed in every cycle: they show that the mode was reached. That is not enough if the device heats unevenly, so the steriliser's effectiveness is checked periodically by a laboratory with biological indicators, at the frequency set in the production control programme. The reports are kept with the journal.",
    },
  ],

  medical_waste_b: [
    {
      q: "Which beauty salon waste is Class B?",
      a: "Materials contaminated with blood and other body fluids: needles, blades, cotton pads and wipes with blood, gloves and disposable instruments after injections and other procedures that break the skin. Packaging, paper and waste with no contact with blood are ordinary Class A waste and are collected separately.",
    },
    {
      q: "How long can Class B waste be stored before collection?",
      a: "Not long. Untreated Class B waste is kept at room temperature for no more than one day, and longer accumulation is allowed only in refrigeration or freezer equipment. The maximum periods for each mode are set by SanPiN 2.1.3684-21; they and the collection schedule are fixed in the waste management scheme.",
    },
    {
      q: "Can Class B waste go in the ordinary bin after treatment with disinfectant?",
      a: "No. Treatment with a disinfectant solution does not turn the waste into household waste: it is still packed in yellow bags or containers and handed over to the collection company under contract. A different procedure is possible only with decontamination in special units that change the appearance of the waste, and it must be written into the waste management scheme.",
    },
    {
      q: "Does a beauty salon need a contract for medical waste collection?",
      a: "Yes, if the salon produces Class B waste, for example after injectable cosmetology. The contract is concluded with a specialist company, and each handover is confirmed by a report or delivery note with the date and weight. The contract and reports are kept with the journal: they are checked against the records of the waste collected.",
    },
  ],

  audit_plan: [
    {
      q: "How often should an internal HACCP audit be carried out?",
      a: "GOST R ISO 22000-2019 requires audits at planned intervals but does not set a specific frequency. In practice each area of the system is audited at least once a year, and processes with complaints, changes or past non-conformities more often. The frequency is justified in the plan so that it can be explained to an external auditor.",
    },
    {
      q: "Can an internal audit be carried out by the company's own employee?",
      a: "Yes, internal audits are usually carried out by your own staff. There are two conditions: the auditor is trained in auditing and does not audit their own work. A technologist can audit the storeroom, the chef of one kitchen can audit another kitchen. An external consultant is not mandatory, but is useful for auditing the system as a whole and when there are not enough in-house auditors.",
    },
    {
      q: "What is the difference between an internal audit and a Rospotrebnadzor inspection?",
      a: "An internal audit is carried out by the business itself to find weak spots before others find them. The criteria are its own procedures, the HACCP plan and mandatory requirements. A Rospotrebnadzor inspection is state control of compliance with mandatory requirements, with consequences for the business. A good internal audit reduces the risk of unpleasant findings by the inspector.",
    },
    {
      q: "Is an audit plan needed if the business has no ISO 22000 certificate?",
      a: "Formally the standard is voluntary. But checking that HACCP procedures work is one of the HACCP principles, and the procedures themselves are required by TR CU 021/2011. An audit plan is a simple way to show that such checks are done regularly and not just from time to time. For supplying retail chains it is often mandatory under the customer's requirements.",
    },
  ],

  audit_protocol: [
    {
      q: "What is the difference between an audit record and an audit report?",
      a: "The record describes one audit: what was examined, which observations and non-conformities were found and with what evidence. The report summarises the results of all audits for a period for management: where the weak spots are, how corrective actions are being closed, what to change. The record is written right after the audit, the report at the end of the period.",
    },
    {
      q: "How long is allowed to correct non-conformities found in an audit?",
      a: "There is no single deadline. A non-conformity that threatens product safety is corrected immediately. For the rest, the area manager agrees the deadline for the correction and corrective action with the auditor, and it is written in the record or the CAPA ticket. Overdue actions are reflected in the report for management.",
    },
    {
      q: "Can an internal audit be carried out using a checklist?",
      a: "Yes, a checklist helps avoid missing anything important and makes it possible to compare results between audits. It is compiled from the criteria (procedures, the HACCP plan, prerequisite programmes) and updated after changes. But the auditor is not limited to the checklist: anything seen outside it is also written in the record.",
    },
    {
      q: "What if the area manager disagrees with a non-conformity?",
      a: "The disagreement is recorded in the audit record together with the area manager's position, not settled verbally. The auditor checks the evidence again: the document used for comparison, the photo, the record number. The final decision is made by the HACCP team leader, and disputed issues are then reviewed at the management review.",
    },
  ],

  audit_report: [
    {
      q: "Who approves the internal audit report?",
      a: "The report is prepared by the HACCP team leader or the lead auditor, and it is reviewed and approved by the head of the business. Approval is not a formality: the head records decisions on the recommendations, such as what resources to allocate, who to train and what to change. Without such decisions the report remains just statistics.",
    },
    {
      q: "What is a management review of the system?",
      a: "It is a regular review by top management of how the food safety system is working, a requirement of GOST R ISO 22000-2019. The inputs are internal audit results, the status of corrective actions, complaints, results of external inspections and changes at the business. The output is written decisions on improvements and resources. The audit report is one of its main parts.",
    },
    {
      q: "Does the audit report have to be shown to an inspector?",
      a: "The report is not a mandatory form for Rospotrebnadzor, but it may be requested as evidence that HACCP procedures are not only written but also checked. For a certification body and retail chain auditors, the report is one of the key documents: it shows that the business finds and fixes problems itself.",
    },
    {
      q: "What should I do if corrective actions from an audit are overdue?",
      a: "Report them honestly, with the reason for the delay, rather than marking them as done. Management decides what is needed to close them: resources, a new deadline or a different person responsible. It is worth moving the area with overdue actions earlier in the plan for upcoming audits to check that the problem really has been fixed.",
    },
  ],
};
