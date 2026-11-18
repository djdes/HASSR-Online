import type { JournalFaqExtra } from "./types";

/**
 * Extra journal FAQ questions (en, part A): staff journals, catering for
 * organised groups and sanitation journals. Translation of `FAQ_EXTRA_RU_A`:
 * same keys, same number of items and the same order.
 */
export const FAQ_EXTRA_EN_A: JournalFaqExtra = {
  hygiene: [
    {
      q: "Does a sole trader with no employees need to keep a hygiene journal?",
      a: "The pre-shift check applies to everyone who handles food, and the sanitary rules make no separate exception for the owner. If a sole trader cooks, packs or serves food themselves, they usually keep the journal for themselves too: one line a day with temperature and a fit-for-work mark. It takes a minute and removes the question at an inspection. As soon as helpers, trainees or contract workers appear, they are added to the journal from day one.",
    },
    {
      q: "Who signs the hygiene journal: the employee or the person responsible?",
      a: "The fit-for-work decision is signed by the person responsible for the check, appointed by order: the head chef, the shift administrator or a medical worker. The employee usually signs too, confirming that they have reported how they feel, any intestinal infections in the family and any wounds on their hands. The responsible person does not check themselves: their clearance is signed by a deputy or the manager.",
    },
    {
      q: "Which staff besides cooks should be recorded in the hygiene journal?",
      a: "Everyone who comes into contact with food, clean tableware and utensils: pastry cooks, kitchen porters, dishwashers, waiters, bartenders and baristas, servers, storekeepers. An administrator who helps at the counter or the bar is checked as well. If a person is on shift according to the rota but has no line in the journal, the inspector treats it as a missed check.",
    },
    {
      q: "What is the difference between a hygiene journal and a health check journal?",
      a: "In essence, they record the same pre-shift check. In the hygiene journal the responsible person records the outcome, cleared or suspended, while in the health check journal each sign is marked separately: temperature, respiratory infection, intestinal upset, skin condition of the hands. There is no need to keep both forms at once: choose one and fix it in the production control programme. A cafe with a small team usually manages with the hygiene journal.",
    },
  ],

  health_check: [
    {
      q: "Where can I download a free health check journal template?",
      a: "On this page: the “Download PDF” button gives you a blank form, and there is also a Word (DOCX) version. The company name you enter when downloading is placed straight into the header, so you only need to print the sheets. If you would rather not keep paper, the journal can be filled in electronically, free for the first 14 days, with a PDF export in the same format.",
    },
    {
      q: "When should the health check journal be filled in: before the shift or at the end of the day?",
      a: "Only before work starts: each employee is checked before changing into sanitary clothing and entering the production area, and latecomers as soon as they arrive. Filling it in at the end of the shift for the whole day is a violation: if a person with signs of infection has already worked the shift, a backdated “cleared” mark protects nothing and looks like box-ticking at an inspection.",
    },
    {
      q: "What do I enter in the health check journal if an employee is on a day off, on holiday or on sick leave?",
      a: "An inspector may read an empty cell as a missed check, so an absence status is entered instead: day off, holiday or sick leave (on the Russian form “V”, “Otp” and “B/l”). The codes are explained in the header or below the table. After sick leave the employee is checked again on the day they return, and if the cause was an intestinal infection, a doctor's note is requested. In the electronic journal statuses are filled in automatically from the shift rota.",
    },
    {
      q: "Can a cook with a runny nose work if they have no fever?",
      a: "No. Signs of a respiratory infection (runny nose, cough, sore throat) are grounds for suspension from work with food even at a normal temperature: the pathogen gets onto food from hands and through sneezing. The journal records the sign and the decision “suspended”, and the employee is sent to a doctor. If the shift is left without a cook, the manager solves it by moving staff around, not by clearing a sick person.",
    },
  ],

  med_books: [
    {
      q: "Where can I download a free medical book log template?",
      a: "The “Download PDF” button on this page gives you a blank form with ready-made columns: full name and position, medical book number, dates of the last and next medical examination, chest X-ray and vaccinations. The company name is placed in the header when you download. If you would rather not track dates by hand, the log can be kept electronically, free for 14 days, with a reminder 30 days before an examination is due.",
    },
    {
      q: "Who needs a personal medical book in a cafe or restaurant?",
      a: "Everyone involved in receiving, storing, preparing and serving food, washing tableware and serving guests: cooks, pastry cooks, kitchen porters, dishwashers, waiters, bartenders, storekeepers, delivery staff, and managers who work in the kitchen or dining room. Trainees, part-timers and seasonal staff may not start a shift without one. Office staff who never enter the kitchen or dining room usually do not need one.",
    },
    {
      q: "How do I record electronic medical books (ELMK)?",
      a: "The same way as paper ones: the journal records the electronic book number from the Rospotrebnadzor register, the dates of the medical examination, tests and hygiene certification, and the date of the next examination. Check the number and dates against the document itself, as inspectors compare them with the register. A business can have paper and electronic books at the same time, and both are recorded in one log.",
    },
    {
      q: "Where should staff medical books be kept: by the employer or the employee?",
      a: "The procedure is set by an internal document of the organisation. Most often paper books are kept by the management at the site where the employee works and handed out against signature for a medical examination or on dismissal, so the book is always on site for an inspection. If the employee keeps the book, they must bring it on first request, and the log still records the examination dates.",
    },
  ],

  training_plan: [
    {
      q: "Does a small cafe need a HACCP training plan?",
      a: "Yes, if the cafe produces food: procedures based on HACCP principles under Article 10 of TR CU 021/2011 are mandatory regardless of floor area and headcount. For a cafe with 5–10 staff the plan fits on one page: induction for newcomers, control points for cooks, washing and disinfection for dishwashers, allergens for the kitchen and front of house, repeated every six months or once a year.",
    },
    {
      q: "Does HACCP training have to be done at a training centre with a certificate?",
      a: "The law does not require external courses: what matters is that staff know the procedures of your own production and that records prove it. Training can be given by a technologist, head chef or HACCP team leader using internal materials. An external course is useful for whoever develops the HACCP plan, but it does not replace briefings on your control points. Do not confuse this with the hygiene certification for the medical book, which is a separate obligation.",
    },
    {
      q: "What is the difference between a training plan and a briefing register?",
      a: "The plan is a document for the year ahead: which topics, for which positions, how often and who delivers them. The register is the record of fact: date, topic, full names and signatures. The inspector compares the two: a topic from the plan with no entry in the register is treated as not delivered, and a session that is not in the plan needs a clear reason, such as new equipment, a change of cleaning product or a guest complaint.",
    },
    {
      q: "Where can I find a sample HACCP staff training plan?",
      a: "A sample with topics by position is shown higher up on this page, and it makes a convenient starting point. But a ready-made template has to be adapted: the inspector checks whether the plan matches the risks of your production. Start with the control points from your own HACCP plan, add topics on the products and equipment you actually use, and remove whatever you do not have.",
    },
  ],

  staff_training: [
    {
      q: "Who can give HACCP briefings in a cafe?",
      a: "The law does not require a special certificate. The briefing is given by an employee who knows the procedures well: a technologist, head chef, sous chef, HACCP team leader or an invited specialist. This person is named in the training plan or appointed by order. What matters is that the trainer can answer questions on the topic and signs the register next to the trainee.",
    },
    {
      q: "Does a trainee who works for only a day or two need a briefing?",
      a: "Yes. Induction training is given before independent work to anyone allowed to handle food: a trainee, a part-timer, a seasonal or temporary worker. For a short trial shift an induction briefing on personal hygiene, sanitary clothing and the kitchen rules is enough, but it must be recorded in the register with the date of the first day, otherwise the person is on the rota but has no training.",
    },
    {
      q: "How do I check that an employee has understood a briefing?",
      a: "A signature only confirms attendance. Knowledge is checked with a short oral quiz or a test of 5–10 questions on the topic, and at the workstation by asking the person to show where the critical point is, what its limit is and what to do in case of a deviation. The result is written in the notes. If the employee could not answer, the briefing is repeated and a new entry is made with the actual date.",
    },
    {
      q: "How often should HACCP refresher briefings be held?",
      a: "The law sets no single frequency: it is set by the approved training plan. Usually each topic is repeated every six months or once a year, and topics where staff made mistakes more often. Besides scheduled briefings, an unscheduled briefing is held for new equipment, a change of cleaning product or recipe, and a targeted one after a serious deviation or a guest complaint.",
    },
  ],

  ppe_issuance: [
    {
      q: "Who pays for PPE: the employer or the employee?",
      a: "The employer, at their own expense: this is a direct obligation under labour law. The cost may not be deducted from wages, and an employee may not be asked to buy gloves and footwear themselves. For their part, the employee must use the PPE issued and report any damage, in which case it is replaced early, with an entry in the journal.",
    },
    {
      q: "Does an employee have to sign for every pair of disposable gloves?",
      a: "No. Disposable gloves are issued in batches as they are used up, for example for a week or a month: the date, the quantity in pieces or packs and the recipient's name are recorded, and the employee signs for the batch. This shows that gloves are issued regularly and that their consumption matches purchases.",
    },
    {
      q: "How often should kitchen staff PPE be replaced?",
      a: "The wear period is taken from the issue standards for the position, which the employer approves based on Order No. 767n of the Ministry of Labour and the occupational risk assessment. The period runs from the date of issue and is written in the journal next to the item. PPE that is torn, burnt or has lost its protective properties is replaced early, without waiting for the period to end, and the reason for replacement is recorded.",
    },
    {
      q: "What should I do if an employee refuses to wear PPE?",
      a: "First check whether the PPE fits and does not get in the way of the work: uncomfortable gloves or footwear are a common reason for refusal. Then hold a repeat briefing and record it. The employee must use the PPE issued, and the employer must not allow them to do work that requires it without protection. The refusal is recorded in writing, as an explanatory note or a formal report.",
    },
  ],

  vitaminization: [
    {
      q: "Which dishes is vitamin C added to?",
      a: "Usually to the third course (compote, kissel or a drink) after it has cooled. The preparation is dissolved in a small amount of the dish, mixed with the rest and added shortly before serving. Vitamin C is not added to hot dishes, and the dish is not reheated after it has been added: ascorbic acid breaks down when heated. Instead of adding it, commercially produced vitamin-enriched drinks can be served, and this is also recorded in the journal.",
    },
    {
      q: "How much ascorbic acid should be added per portion?",
      a: "The dose is determined by the age-specific standard for the institution and the instructions for the preparation, then multiplied by the number of portions for the day. The standard differs for children of different ages, so mixed groups are calculated separately. The same “per pot” figure cannot be used every day: with fewer portions it becomes an overdose, with more it falls short. It is convenient to keep the calculation in a table next to the journal.",
    },
    {
      q: "Can vitamin enrichment of dishes be replaced with multivitamin tablets?",
      a: "No. Multivitamin tablets do not replace the vitamin enrichment journal: enrichment means adding an approved preparation to a dish or serving a vitamin-enriched drink according to the manufacturer's instructions. Individual vitamins are prescribed by a doctor, and the catering unit does not hand them out. The preparation for dishes must have documents of origin and must be within its shelf life.",
    },
    {
      q: "Do dishes need to be vitamin-enriched at weekends and on public holidays?",
      a: "Yes, if meals are provided on those days. In a camp, hospital, sanatorium or care home vitamin enrichment is done every day, including weekends and public holidays, and there must be an entry for every day. In a school or kindergarten there are no entries on days without meals. The inspector checks the journal against the menu and the number of people fed, so gaps on the catering unit's working days are noticed straight away.",
    },
  ],

  ration_control: [
    {
      q: "What is a cumulative food record and how is it different from a menu?",
      a: "The menu is the plan: which dishes are to be served and in what portion size. The cumulative record is the fact: how much of each food group actually went into the pot over the period, per person per day. It is the record that shows whether the standards were met, because the menu changes through substitutions and the number of people fed varies.",
    },
    {
      q: "Can a food substitution count towards meeting the standard?",
      a: "Yes, if the substitution follows the table of equivalent substitutions with a recalculation by protein and carbohydrates, for example meat for fish or for cottage cheese in the set amount. The record shows the substitution explicitly: a shortfall in one group and an excess in another, with the same note in the remarks. A substitution made by eye, or with a product from another group, say meat for pasta, does not meet the standard.",
    },
    {
      q: "What deviation from nutrition standards is allowed over a period?",
      a: "The standards are average daily values, so compliance is assessed not for a single day but over 10 days or a month: one day there may be more meat, another day less. The allowed percentage of deviation and the rule for when to change the menu are fixed in the production control programme. Any noticeable deviation is explained in the remarks and evened out in the next period.",
    },
    {
      q: "Who keeps the diet monitoring record if meals are prepared by a contracted catering plant?",
      a: "The record is kept by whoever prepares and serves the meals according to the menu, usually the catering operator or the catering plant. The school or kindergarten, as the customer, may request it and check it against the menu and the food actually served, and parent monitoring committees may review it. It is convenient to state in the contract and in the production control programme who keeps and stores the record.",
    },
  ],

  daily_samples: [
    {
      q: "Where can I download a free daily food sample journal template?",
      a: "On this page, using the “Download PDF” button: a blank form with columns for the date and meal, dish, sample weight, time of sampling, storage temperature and disposal. The company name is placed in the header when you download. If you would rather not use paper, the journal can be kept electronically, free for 14 days: the list of dishes comes from the menu, and a disposal reminder arrives after 48 hours.",
    },
    {
      q: "How long should a daily food sample be kept if a weekend is coming up?",
      a: "At least 48 hours in a separate refrigerator or on a dedicated shelf at +2…+6 °C. Weekends and public holidays are not excluded from this period: a sample taken on Friday cannot be thrown away on Sunday, it is disposed of by the shift on a working day once the period has expired. If anyone who ate the food falls ill during this time, the samples are kept until Rospotrebnadzor specialists decide.",
    },
    {
      q: "Does an ordinary cafe or restaurant have to keep daily food samples?",
      a: "For a cafe that feeds customers from a menu, sampling is not mandatory. The requirement applies to organised catering (children, patients, social service users) and to those who feed groups under contract, including off-site catering. A restaurant with regular banquets would be wise to fix sampling for such events in its production control programme: a sample protects the business itself too.",
    },
    {
      q: "Is the daily sample taken before or after the quality check?",
      a: "After the quality check (brakerazh) and before serving begins: the committee first approves the dish for serving, then the sample is taken from the same batch that will go to the counter. A sample taken in advance “from the first pot” or after serving does not show what was actually eaten. The sampling time is recorded in the journal so the inspector can compare it with the quality check journal.",
    },
  ],

  complaint_register: [
    {
      q: "How quickly must a guest complaint be answered?",
      a: "The Russian Federation Law “On Consumer Rights Protection” requires claims for a price reduction or a refund for a poorly provided service to be satisfied within 10 days of being made. A verbal complaint in the dining room is usually resolved on the spot, by replacing the dish or giving a discount. The register records the date of the complaint and the date of the response, which show that the deadline was met.",
    },
    {
      q: "What is the difference between a complaint register and a guest feedback book?",
      a: "The feedback book, if there is one in the dining room, is filled in by the guest. The complaint register is an internal document of the business: all complaints are transferred into it (from the book, by phone, from websites and social media) and the investigation, cause and measures taken are added. An entry from the feedback book also has to be reviewed and entered in the register, otherwise it is left without a response or conclusions.",
    },
    {
      q: "Should a complaint be recorded if the guest left no contact details?",
      a: "Yes. Contact details are needed for a reply, but for the review what matters is the date, time, dish and the substance of the complaint. An anonymous or verbal complaint is recorded in the same way, and the channel column says, for example, “verbal, no contact details”. If the complaint is justified, action is taken anyway: the guest has left, but the cause is still in the kitchen.",
    },
    {
      q: "How should a consumer complaint register be analysed?",
      a: "Each complaint is reviewed straight away, and a summary analysis is done once a month or quarter, grouped by dish, shift and cause. Several similar complaints in a month are a signal to change the process rather than apologise one by one: review the recipe card, temperature control at the counter or the supplier. The results of the analysis are used when the HACCP plan is reviewed.",
    },
  ],

  finished_product: [
    {
      q: "Where can I download a free prepared food quality check journal template?",
      a: "On this page: the “Download PDF” button gives you a blank prepared food quality check (brakerazh) form, and there is also a Word (DOCX) version. The company name you enter when downloading is placed in the header. If you would rather not keep paper, quality checks can be recorded from a phone at the serving line, free for the first 14 days, with a PDF export in the same format.",
    },
    {
      q: "Who signs the prepared food quality check journal?",
      a: "All members of the quality check committee who assessed the dish: at least two people, with the composition approved by the manager's order. The cook who prepared the dish does not assess it and does not sign the decision. If a committee member is not on shift, the deputy named in the order signs; signing for an absent member after the fact is a violation.",
    },
    {
      q: "Does every made-to-order dish have to be recorded in the quality check journal?",
      a: "Prepared components, soups, sauces, side dishes and baked goods are checked for every batch before serving begins. For portioned dishes cooked to order, the procedure is fixed in the production control programme according to the recipe cards: for example, a quality check of the first portion of a dish per shift and of the semi-finished components it is assembled from. The key thing is that the rule is written down and followed every day.",
    },
    {
      q: "What is the difference between a prepared food quality check and a perishable food quality check?",
      a: "A prepared food quality check assesses dishes of your own production before serving: taste, smell, appearance, texture, temperature and the committee's decision. A perishable food quality check is the incoming inspection of raw materials and semi-finished products on arrival: documents, sensory assessment on receipt, storage conditions and sell-by date. These are two different journals, and one does not replace the other.",
    },
  ],

  cleaning: [
    {
      q: "Where can I download a free cleaning journal template?",
      a: "On this page: the “Download PDF” button gives you a blank room cleaning journal form, and there is also a Word (DOCX) version. The company name you enter when downloading is placed in the header, and the routine and deep cleaning procedure is printed below the table. If you prefer to go paperless, cleaning can be marked from a phone via a QR code, free for the first 14 days.",
    },
    {
      q: "Do I need a separate journal for deep cleaning?",
      a: "Not necessarily. In our form, routine and deep cleaning are marked in one journal with the letters “T” (routine) and “G” (deep). A separate deep cleaning schedule is convenient when cleans are planned a month ahead by area and accepted by a separate responsible person: there the actual date is entered next to the planned one. What matters is that every deep clean is recorded in one place and not duplicated.",
    },
    {
      q: "Can one cleaning journal be kept for all rooms?",
      a: "Yes. One journal has a line for each room or area (hot and cold kitchens, dishwashing room, storeroom, dining room, staff toilet) and cleaning is marked by day. Separate journals for each kitchen make sense in a large production facility where different people are responsible for different areas. The key thing is that the journal includes all rooms listed in the production control programme.",
    },
    {
      q: "Can household cleaning products be used to clean a commercial kitchen?",
      a: "Not for disinfection: you need products approved for food businesses, with instructions for use and state registration documents, and the working solution is prepared strictly according to the instructions. The product name and concentration are written in the journal and must match the instructions and the disinfectant usage records. A household product with no concentration is a common finding at inspections.",
    },
  ],

  climate_control: [
    {
      q: "Where can I download a free temperature and humidity journal template?",
      a: "The “Download PDF” button on this page gives you a blank form with columns for the room, morning and evening temperature and humidity readings, and actions taken in case of deviation. The company name is placed in the header when you download. If the room has a sensor, the journal can be kept electronically, free for 14 days, and readings will be recorded automatically.",
    },
    {
      q: "What temperature and humidity should a dry goods store have?",
      a: "There is no single figure: storage conditions are set by the manufacturer on the label, and the room standard is taken from the most demanding product. For most cereals, flour, sugar and dry groceries this is no higher than +18…+20 °C at a relative humidity of no more than 70–75 %. A vegetable store has different standards, cooler and more humid, so it is kept as a separate line.",
    },
    {
      q: "What is the difference between a temperature and humidity journal and a refrigerator journal?",
      a: "The refrigeration equipment journal only monitors the temperature inside refrigerators and freezers. The temperature and humidity journal is kept for rooms where food is stored without refrigeration (dry goods, vegetable and drinks stores, as well as production areas) and both readings are mandatory in it: temperature in °C and relative humidity in per cent.",
    },
    {
      q: "Does a cafe without a separate storeroom need a temperature and humidity journal?",
      a: "Yes, if food is stored outside refrigerators: in a pantry, a cupboard or on a shelf in the kitchen. The control point becomes the place where cereals, flour, tinned goods, vegetables and drinks are kept: a thermometer with a hygrometer is hung there and the readings are recorded. If nothing is stored without refrigeration, this should be stated explicitly in the production control programme.",
    },
  ],

  cold_equipment_control: [
    {
      q: "Where can I download a free refrigerator temperature log template?",
      a: "On this page: the “Download PDF” button gives you a blank form following Appendix No. 2 to SanPiN 2.3/2.4.4282-26, and there is also a Word (DOCX) version. The company name you enter when downloading is placed in the header. If you would rather not copy out figures by hand, the journal can be kept electronically, free for 14 days, and with a wireless thermometer the readings arrive automatically.",
    },
    {
      q: "What temperature should a refrigerator be under SanPiN?",
      a: "The standard depends not on the refrigerator but on the product: storage conditions are set by the manufacturer on the label. Guidelines for catering: dairy products, salads and ready meals +2…+6 °C, chilled meat and poultry 0…+4 °C, frozen products no higher than −18 °C. If one unit holds different products, the standard is set by the most demanding of them and recorded in the journal.",
    },
    {
      q: "Can one log be kept for several refrigerators?",
      a: "Yes, that is how the form is designed: one journal with a line for each refrigeration and freezer unit, with readings by day of the month. Each refrigerator is given a number that matches the sticker on its body, and its standard is stated. There is no need for a separate journal for each cabinet, but two refrigerators must not be combined in one line either.",
    },
    {
      q: "Can the built-in display be used instead of a thermometer?",
      a: "A refrigerator's display shows the air temperature near the evaporator, so it is checked against a separate thermometer inside the unit. Mercury thermometers are not used in catering: if the bulb breaks, mercury gets onto the food. Alcohol and electronic thermometers and automatic data loggers are suitable, with valid verification or calibration.",
    },
  ],

  cleaning_ventilation_checklist: [
    {
      q: "Is a ventilation checklist needed if there is mechanical supply and exhaust ventilation?",
      a: "If a room is served by supply and exhaust ventilation that runs continuously, airing through windows is often not required there, but the checklist notes that the ventilation is switched on and working. For rooms with windows and no mechanical ventilation (changing rooms, staff rooms, small dining rooms) airing remains a separate procedure. The decision for each room is fixed in the production control programme.",
    },
    {
      q: "Can the ventilation checklist be combined with the cleaning journal?",
      a: "Yes, if the cleaning journal has an airing mark with the time and the supervisor's signature. They are usually kept separate: the cleaning journal records cleaning with products and concentrations, while the checklist covers short procedures repeated during the day. The main thing is not to record the same thing in two places: each procedure is recorded in one document named in the production control programme.",
    },
    {
      q: "Can the dining room be aired while the cafe is open?",
      a: "Yes, if the airflow does not pass through the cooking and serving area, and the opening windows have insect screens in the warm season. The dining room is usually aired before opening and after peak hours, when there are fewer guests. In children's institutions the dining room is not aired while children are present: it is scheduled before groups arrive and after they leave.",
    },
    {
      q: "Should cleaning of the staff toilet be marked on the checklist?",
      a: "Yes, if the toilet is on the list of rooms. It is cleaned and disinfected more often than other rooms, with separate labelled equipment that is not used in the kitchens, and in separate clothing. The checklist records the time of each clean, who did it and who checked it: these lines show that cleaning went on throughout the day, not just once in the evening.",
    },
  ],

  general_cleaning: [
    {
      q: "Where can I download a free deep cleaning schedule template?",
      a: "The “Download PDF” button on this page gives you a blank form with columns for the planned and actual date, area, person doing the work and sign-off. The company name is placed in the header when you download. If you prefer to go paperless, the schedule can be kept electronically, free for 14 days: the person doing the work gets a reminder the day before, and the plan and the actual dates are exported as one table.",
    },
    {
      q: "How many times a month should a cafe do a deep clean?",
      a: "The frequency is set by the business itself in its production control programme. For kitchens, storerooms and dishwashing rooms it is usually at least once a month, and for higher-risk areas, such as the cold kitchen or raw meat areas, more often, up to weekly. Catering units in children's and medical institutions deep clean more often than an ordinary cafe.",
    },
    {
      q: "What mistakes do inspectors find in deep cleaning journals?",
      a: "Most often: no planned dates, or a schedule drawn up after the fact; a household product listed instead of a registered disinfectant, or no working concentration recorded; an empty sign-off column without the production manager's signature; a clean marked as done while there is dirt behind equipment, above the extractor hood and under shelving. All of this tells the inspector that the cleaning happened only on paper.",
    },
    {
      q: "Can a deep clean be done without closing the cafe?",
      a: "Yes, if areas are cleaned one at a time and taken out of use for the duration. Food and clean tableware are removed from the cleaning area or tightly covered, and cooking in that area does not start until surfaces have been disinfected and rinsed. That is why dates in the schedule are spread out: one day the hot kitchen, a week later the cold kitchen, so that the whole production does not stop at once.",
    },
  ],

  uv_lamp_runtime: [
    {
      q: "How many hours does a germicidal UV lamp last before replacement?",
      a: "The service life is stated in the lamp's data sheet: for most common models it is about 8000 hours, but it can be less. Go by the data sheet, not by the visible glow: towards the end of its life the ultraviolet output drops even though the lamp still lights up. That is why the journal keeps a running total of hours and the lamp is replaced when it reaches the data sheet value.",
    },
    {
      q: "Can people stay in a room while a UV recirculator is running?",
      a: "Yes, a closed-type recirculator is designed to work with people present: the lamps are hidden inside the housing and the air is passed through an irradiation chamber. Open-type irradiators are switched on only when no people are present. The operating mode (how many sessions a day and how long each one lasts) is taken from the manufacturer's instructions for the volume of your room and written in the journal header.",
    },
    {
      q: "How do I count operating hours if the UV unit is switched on several times a day?",
      a: "Each run is recorded with its start and end time, and the duration is added to the running total since the current lamp was installed. If the unit runs on a timer, the duration is taken from the setting, but the fact that it was switched on is still recorded. If the unit has a built-in hour meter, its reading is copied into the journal: this is the most reliable total.",
    },
    {
      q: "What should I do if a germicidal lamp breaks?",
      a: "The lamp contains mercury, so people are taken out of the room and the windows are opened. The fragments are collected into a sealed container, not with a vacuum cleaner or a broom, and the area is treated according to the mercury clean-up instructions, or a specialist service is called. Any uncovered food in the room is written off. The incident and the lamp replacement are recorded in the journal, and the fragments are handed over together with spent lamps.",
    },
  ],

  disinfectant_usage: [
    {
      q: "How long does a working disinfectant solution last?",
      a: "The shelf life of a working solution is stated in the instructions for the specific product: for some solutions it is one day, for others several days. Solutions made from chlorine tablets are often prepared for a single shift. The container is labelled with the name, concentration, date of preparation and expiry date. A solution past its expiry is poured away and a new one is made, and the preparation is recorded in the journal.",
    },
    {
      q: "How do I calculate monthly disinfectant consumption?",
      a: "Take the number of treatments of each area from the cleaning journal and the deep cleaning schedule, multiply it by the volume of working solution per treatment and convert it to concentrate using the dilution table in the instructions. Add a reserve for unscheduled treatments. If the actual consumption in the journal is noticeably lower than calculated, the solution is most likely being made weaker than required, or some cleaning is not being done.",
    },
    {
      q: "Does hand sanitiser need to be recorded in the disinfectant journal?",
      a: "Yes, if it is on the business's list of products: skin antiseptic is recorded the same way, with batch receipt, issue to areas and the balance. It is used ready-made, so no solution is prepared, but the shelf life is tracked, including after the bottle is opened if the instructions state one. Dispensers at the kitchen entrance are refilled from a recorded batch, not from unlabelled bottles.",
    },
    {
      q: "Should disinfectants be rotated?",
      a: "Rotation is often recommended so that microorganisms do not develop resistance to a single active substance: for example, a chlorine-based product is periodically replaced with one from another group. The order and frequency of rotation are fixed in the production control programme. When switching to a new product, a briefing on its concentrations and contact time is held, and it is entered in the journal as a new item.",
    },
  ],

  sanitary_day_control: [
    {
      q: "How often should a cafe hold a sanitation day?",
      a: "Usually once a month, but the specific frequency is chosen by the business itself and fixed in the production control programme. Higher-risk catering units (children's, hospital, ready-meal production) need a sanitation day at least as often, and sometimes more often. It is convenient to approve the dates a year ahead to arrange contractors in advance and give guests notice.",
    },
    {
      q: "Does a cafe have to close for a sanitation day?",
      a: "For a full sanitation day, yes, at least for part of the day: food and tableware are removed, work goes on in all areas at once, and after pest treatment there is a waiting period. If closing is not possible, the sanitation day is split by area over several nights or early mornings, but each area is taken out of use while it is cleaned. Guests are warned with a notice in advance.",
    },
    {
      q: "Does a sanitation day need to be approved by Rospotrebnadzor?",
      a: "No, a sanitation day is an internal activity of the business, and there is no need to notify Rospotrebnadzor or get approval. An order or an approved schedule with the date, a checklist signed off by those doing the work and the person checking it, and contractors' reports if they took part are enough. These are the documents shown at an inspection.",
    },
    {
      q: "Can a sanitation day be carried out by a cleaning company?",
      a: "Yes, but responsibility for the result stays with the business. In the checklist the contractor is named as the person doing the work, and sign-off is done by your own employee, the production manager or administrator. The cleaning company must use products approved for food businesses, with instructions; their name and concentration are recorded in the same way as for in-house cleaning, and the contractor's report is attached to the checklist.",
    },
  ],

  equipment_cleaning: [
    {
      q: "Do the mincer and slicer have to be taken apart every time they are washed?",
      a: "When washing at the end of the shift and after working with raw meat, fish or eggs, yes: food residues build up in parts that are not visible from the outside. Between batches of the same product during a shift, cleaning without full disassembly may be enough if the manufacturer's instructions allow it. The procedure for each type of equipment is fixed in the washing instructions.",
    },
    {
      q: "Can equipment parts be washed in a dishwasher?",
      a: "Only if the equipment manufacturer's instructions explicitly allow it: some aluminium parts darken and corrode from alkaline detergents, and cutting edges get blunt. If it is allowed, the journal records “dishwasher” and the programme. Non-removable parts are always washed and disinfected by hand in place, with the product and concentration recorded.",
    },
    {
      q: "Can the same equipment be used for raw and ready-to-eat food?",
      a: "No: equipment and utensils for raw and ready-to-eat food are kept separate and labelled, with separate mincers, boards and knives. If different ready-to-eat products are processed on one machine, for example a slicer for cheese and sausage, it is washed between them and an entry is made. A single entry a day for such equipment raises questions for the inspector.",
    },
    {
      q: "Does the combi oven's automatic cleaning need to be recorded in the journal?",
      a: "Yes, it is equipment washing just like any other. Record the automatic cleaning programme, the product (tablets or liquid according to the manufacturer's instructions) and who started it. Manual cleaning of the door seal, racks and guides is noted separately if it is part of the procedure: the automatic programme does not always get them clean.",
    },
  ],

  intensive_cooling: [
    {
      q: "How quickly must a hot dish be cooled?",
      a: "The general guideline in HACCP systems is to pass through the range from +60 °C to +10 °C in less than 2 hours, then bring the product down to its storage temperature. The exact times and temperatures for each dish are set in the technological documentation and the HACCP plan, and the journal entries are checked against them. The larger the volume and the deeper the container, the harder it is to meet the target.",
    },
    {
      q: "Can hot food be cooled in an ordinary refrigerator?",
      a: "A pot of hot food must not be put in an ordinary refrigerator: it is designed for storage, not for removing heat, so the dish takes hours to cool and the food next to it warms up. Without a blast chiller, an ice water bath, shallow gastronorm containers and stirring are used, and the product goes into the refrigerator once most of the heat has been removed, with the time recorded from measurements.",
    },
    {
      q: "Is a cooling journal needed if the restaurant has no blast chiller?",
      a: "Yes, if you cool hot dishes for storage: soups, sauces, side dishes, preparations for the next day. The journal records not the equipment but the fact: how long the product took to pass through the danger range. If dishes are not cooled but cooked and served straight to guests, the journal is not needed; this should be reflected in the HACCP plan.",
    },
    {
      q: "What thermometer should be used to monitor cooling?",
      a: "An electronic probe thermometer that measures the temperature at the core of the product, not on its surface. The probe is washed and disinfected between products, especially when moving from raw to cooked food. The thermometer is checked periodically: in melting ice it should read about 0 °C, and the result of the check is recorded in the calibration journal.",
    },
  ],

  transport_temperature: [
    {
      q: "Is a refrigerated vehicle needed to deliver perishable food?",
      a: "Perishable food is transported in vehicles or containers that maintain the manufacturer's storage conditions: a refrigerated truck, an insulated body or insulated boxes with ice packs, depending on the distance and journey time. On a short route insulated boxes are often enough, but this is confirmed by readings at loading and unloading. If readings fall outside the standard, the containers or the route are changed.",
    },
    {
      q: "Can raw materials and finished products be transported in the same vehicle?",
      a: "Only so that they do not touch or contaminate each other: separate closed containers, separate compartments or areas of the vehicle body. Raw meat, fish and eggs are not placed above ready meals, and containers for raw materials and for finished products are not used interchangeably. If the products cannot be separated in the vehicle, they are carried on separate trips.",
    },
    {
      q: "What temperature should hot meals arrive at?",
      a: "Hot dishes must stay hot until they are served: the temperature at unloading is compared with the standard in the recipe card or the catering contract. To achieve this, dishes are carried in insulated boxes that are not opened until they reach the destination, and journey time is kept short. If the dish turns out colder than the standard at the recipient, this is recorded, and the decision to serve it is made by the responsible person, not the driver.",
    },
    {
      q: "Who fills in the transport temperature journal: the driver or the storekeeper?",
      a: "The reading at loading is taken by whoever releases the products, the storekeeper or a cook, and at unloading by the driver or delivery person together with the recipient. It is easier when the delivery person makes both entries and the recipient confirms unloading with a signature. The main thing is that each entry has a time and a name, and that the thermometer works and has been checked.",
    },
  ],

  pest_control: [
    {
      q: "Can a business do its own rodent and insect control?",
      a: "Prevention (checking traps, sealing gaps, keeping screens on windows and waste containers closed) is done by the business itself. Treatments with rodenticides and insecticides are usually contracted out to a specialist pest control company: this requires trained specialists, products approved for such premises and a report for each treatment. The contract and the reports are the first things the inspector asks for.",
    },
    {
      q: "How often should a cafe have rodent control treatment?",
      a: "The frequency of scheduled treatments is set in the contract with the pest control company and in the production control programme, usually once a month for food businesses. Between the contractor's visits, staff inspect traps and bait stations, and at any sign of rodents or insects they immediately request an unscheduled treatment and record it in the journal.",
    },
    {
      q: "Is a pest control contract needed if there are no insects?",
      a: "Yes. Preventive treatments and inspections are carried out regardless of whether pests are visible: their absence is the result of regular work, not a reason to stop it. The contract with its reports is the first thing an inspector will ask for on this topic. If an inspection finds no signs, this is recorded too: “inspection, no signs found”.",
    },
    {
      q: "What should I do if cockroaches or a mouse are spotted in the kitchen?",
      a: "Record the incident in the journal (date, location, what was found) and on the same day request an unscheduled treatment from the contractor. Check uncovered food and tableware in that area: food with traces of rodents or insects is written off, and surfaces are washed and disinfected. Then find the way in (gaps, ventilation, supplier packaging) and close it off.",
    },
  ],
};
