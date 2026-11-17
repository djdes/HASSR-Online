import type { JournalPageContent } from "../types";

const FINES_NOTE = "Amounts are given as per the CAO RF as amended in November 2026.";

export const STAFF_PAGE_CONTENT_EN: Record<string, JournalPageContent> = {
  hygiene: {
    sample: {
      caption:
        "Morning shift entries: for each employee, the temperature, the check result and the clearance decision. A cook with a raised temperature has been excluded from work, and the reason is recorded in the same row.",
      columns: ["Date", "Employee", "Position", "Temperature, °C", "Inspection and questions", "Clearance", "Responsible person"],
      rows: [
        ["05.11.2026", "Smirnova E. V.", "Cook", "36.6", "Healthy", "Cleared", "Ivanova M. P."],
        ["05.11.2026", "Kozlov A. A.", "Cook", "37.4", "Runny nose, weakness", "Excluded", "Ivanova M. P."],
        ["05.11.2026", "Petrova O. S.", "Pastry cook", "36.5", "Finger cut, no pus, covered", "Cleared, wearing gloves", "Ivanova M. P."],
        ["05.11.2026", "Akhmedov R. T.", "Dishwasher", "36.7", "Healthy", "Cleared", "Ivanova M. P."],
        ["05.11.2026", "Lebedeva N. I.", "Waiter", "36.4", "Healthy", "Cleared", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Who carries out the check and who is responsible for clearance",
        paragraphs: [
          "The check is done by one designated person: in a cafe, the head chef or the shift manager; in production, the foreman or the food technologist; in a school or hospital kitchen, the medical worker. The appointment is made by an internal order that also names a deputy for days off and holidays — otherwise entries go missing on those days.",
          "The responsible person personally decides whether an employee may start work and signs for that decision. Employees, in turn, must report any illness, any gastrointestinal infection in their family and any wounds on their hands — without this, the questioning becomes a formality.",
        ],
      },
      {
        heading: "How the pre-shift check is done",
        bullets: [
          "The check takes place before employees change into work clothing and enter production areas, not after work has started.",
          "Measure the temperature with a non-contact thermometer and record the exact value, not just “normal”.",
          "Inspect the hands and exposed skin for pustular lesions, burns and cuts.",
          "Ask how the employee feels: runny nose, cough, sore throat, nausea, diarrhoea.",
          "Record the decision and sign. Employees who arrive later are checked on arrival.",
        ],
      },
      {
        heading: "When an employee is excluded from work",
        paragraphs: [
          "Grounds for exclusion: a temperature above 37 °C, signs of a respiratory infection, pustular skin lesions on the hands, gastrointestinal upset. An excluded employee does not handle packaged products either, because pathogens spread via hands and packaging. They are sent to a doctor and cleared again only after recovery, with a medical certificate where needed.",
          "A small fresh cut with no signs of inflammation is covered with a plaster or finger cot, with gloves on top. If an exclusion leaves the shift without a cook, the manager solves it by reassigning staff, not by letting a sick person work.",
        ],
      },
      {
        heading: "Typical mistakes inspectors find",
        bullets: [
          "Entries made with the same pen several days in advance or backdated.",
          "Everyone always has “36.6” — this is what a log filled in without a thermometer looks like.",
          "No rows for employees who were on shift according to the rota.",
          "An exclusion is recorded, but the same person appears in the food quality or cleaning logs that day.",
          "The responsible person has not signed, or the signature belongs to someone who is being checked.",
        ],
      },
      {
        heading: "Electronic health checks instead of paper",
        paragraphs: [
          "In WeSetup, the list of employees on shift comes from the rota, and the responsible person goes through it on a phone, entering the temperature and the decision. The entry time is set automatically, edits are kept in the history, and a temperature above 37 °C immediately marks the row as an exclusion. The manager gets a reminder if the check has not been done by the start of the shift, and before an inspection exports the staff hygiene journal to PDF in the layout of the paper form.",
        ],
      },
    ],
    fines: {
      intro:
        "The CAO RF has no separate article for missing health check records. But letting a person with signs of infection work with food is a direct breach of SanPiN 2.3/2.4.4282-26, and without the log a business has no way to prove the checks take place:",
      items: [
        "Art. 6.6 CAO RF — breach of sanitary and epidemiological requirements for catering: for legal entities RUB 20,000 to 40,000 or suspension of activity for up to 90 days;",
        "Art. 6.3 CAO RF — breach of legislation on the sanitary and epidemiological well-being of the population: for legal entities RUB 10,000 to 20,000 or suspension of activity for up to 90 days.",
      ],
      note: `${FINES_NOTE} In a group food poisoning case, the health check log is the first document requested.`,
    },
  },

  health_check: {
    sample: {
      caption:
        "One day's entries in the detailed form: each symptom is marked separately for every employee, and the last column holds the decision and its grounds. This shows not just the outcome but exactly what was checked.",
      columns: ["Date", "Employee, position", "Temperature, °C", "Respiratory symptoms (cough, runny nose)", "Gastrointestinal upset", "Skin of hands", "Decision"],
      rows: [
        ["12.11.2026", "Smirnova E. V., cook", "36.5", "No", "No", "Clear", "Cleared"],
        ["12.11.2026", "Kozlov A. A., cook", "36.8", "No", "Complains of diarrhoea", "Clear", "Excluded, referred to a doctor"],
        ["12.11.2026", "Petrova O. S., pastry cook", "36.6", "No", "No", "First-degree burn, covered", "Cleared, no work with creams"],
        ["12.11.2026", "Akhmedov R. T., dishwasher", "37.2", "Runny nose", "No", "Clear", "Excluded"],
      ],
    },
    sections: [
      {
        heading: "How the detailed form differs from the short one",
        paragraphs: [
          "In the short form, the responsible person records only the outcome: cleared or not. The detailed form breaks the check down into signs — temperature, respiratory symptoms, gastrointestinal upset, the condition of the skin on the hands — and marks each one. There are more entries, but a month later they still show who was on shift and with what complaints.",
          "The detailed form is chosen by school, kindergarten and hospital kitchens, by caterers and by producers supplying retail, where the cost of a mistake is higher. A cafe with a small team usually manages with the short form. There is no need to keep both: one form, fixed in the production control programme, is enough.",
        ],
      },
      {
        heading: "How to record the decision and its grounds",
        bullets: [
          "“Cleared” — if all signs are negative and the temperature is not above 37 °C.",
          "“Excluded”, stating the sign: temperature, respiratory symptoms, gastrointestinal upset, pustular skin lesions on the hands.",
          "“Referred to a doctor” — when the symptoms need examination; the return date is recorded later in a separate row.",
          "“Cleared with restrictions” — for example, no work with creams or ready-to-eat dishes; the restriction must be clear from the entry.",
        ],
      },
      {
        heading: "Returning to work after illness",
        paragraphs: [
          "After an exclusion, the employee is cleared again only after a repeat check on the day they return. If the cause was a gastrointestinal infection or the employee was on sick leave, the responsible person asks for a doctor's document and notes it in the log. If a family member had a gastrointestinal infection, the employee reports it themselves, and the manager decides on clearance taking the doctor's recommendations into account.",
        ],
      },
      {
        heading: "Why these records matter in a food poisoning investigation",
        paragraphs: [
          "When Rospotrebnadzor investigates a poisoning case, it compares the date, the menu and the shift roster. Detailed marks show that on the day of preparation the staff who handled those dishes had no symptoms and that anyone who was ill had been excluded. Without them, the business can only claim verbally that its staff were healthy.",
        ],
      },
      {
        heading: "The health check journal in electronic form",
        paragraphs: [
          "In WeSetup, the check form opens on a phone via a QR code at the entrance to the kitchen: the responsible person ticks the signs, the entry time is set automatically, and any positive mark immediately suggests the decision “excluded”. Missing entries for shift staff are visible to the manager, the edit history is kept, and the PDF export matches the paper form.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for the form of the log. Penalties apply to the substance: a person with signs of illness was allowed to work, or the checks are not supported by records — and that is a breach of SanPiN 2.3/2.4.4282-26:",
      items: [
        "Art. 6.6 CAO RF — breach of sanitary and epidemiological requirements for catering: for legal entities RUB 20,000 to 40,000 or suspension of activity for up to 90 days;",
        "Art. 6.3 CAO RF — breach of legislation on the sanitary and epidemiological well-being of the population: for legal entities RUB 10,000 to 20,000 or suspension of activity for up to 90 days.",
      ],
      note: FINES_NOTE,
    },
  },

  med_books: {
    sample: {
      caption:
        "Tracking rows for cafe staff: personal medical record book number, dates of the last and next examination, and the hygiene certification mark. The last column shows who needs to be booked in at the clinic.",
      columns: ["Employee", "Position", "Medical book no.", "Last medical exam", "Next medical exam", "Hygiene certification", "Status"],
      rows: [
        ["Smirnova E. V.", "Cook", "77-0012345", "14.03.2026", "by 14.03.2027", "Valid", "OK"],
        ["Kozlov A. A.", "Cook", "77-0023456", "02.12.2025", "by 02.12.2026", "Valid", "Book an exam"],
        ["Petrova O. S.", "Pastry cook", "77-0034567", "20.06.2026", "by 20.06.2027", "Valid", "OK"],
        ["Lebedeva N. I.", "Waiter", "77-0045678", "05.11.2026", "by 05.11.2027", "Passed 05.11.2026", "New employee"],
      ],
    },
    sections: [
      {
        heading: "Who must be included in medical book tracking",
        paragraphs: [
          "Pre-employment and periodic medical examinations under Ministry of Health Order No. 29n are mandatory for everyone involved in preparing, storing, transporting and serving food and in washing dishes: cooks, pastry cooks, kitchen hands, dishwashers, waiters, bartenders, storekeepers and delivery staff. The results are entered in the personal medical record book.",
          "Part-timers, trainees, seasonal workers and employees on probation are tracked too. Inspectors most often find violations precisely among people who came in to “cover for a couple of days”.",
        ],
      },
      {
        heading: "What to do when hiring",
        bullets: [
          "Before the first working day, refer the person for a pre-employment medical exam and check their medical book.",
          "Make sure the book contains the exam results and entries for the tests and the hygiene certification.",
          "Compare the full name and photo with the passport: forged books are most often given away by mismatches.",
          "Enter the details in the tracking log and set the next exam date straight away.",
          "Keep the original book on site or require it at every inspection, according to the rules adopted in the organisation.",
        ],
      },
      {
        heading: "What to do if the medical exam has expired",
        paragraphs: [
          "The RF Labour Code requires the employer to suspend an employee who has not passed a mandatory medical exam, and not to pay them for the suspension period if the employee is at fault. Working “until the clinic queue clears” is not allowed: clearing someone with an expired medical book is itself the violation that gets fined.",
          "To avoid this, check the dates in advance: book the employee in for the exam a month before expiry, and plan a replacement in the shift rota for the day they go to the clinic.",
        ],
      },
      {
        heading: "What the inspector looks at",
        bullets: [
          "Whether everyone on shift that day has a medical book, including trainees.",
          "Whether the exam and certification are still valid on the inspection date.",
          "Whether the tracking list matches the staff list and the shift rota.",
          "Whether the book itself has the medical organisation's signatures and stamps.",
        ],
      },
      {
        heading: "Medical book deadlines in electronic tracking",
        paragraphs: [
          "In WeSetup, exam dates are stored in the employee's profile. The service reminds the manager 30 days before expiry, marks overdue employees in red and warns before such an employee is put on a shift. Before an inspection, the list is exported to PDF as a single table.",
        ],
      },
    ],
    fines: {
      intro:
        "The tracking log itself is not required by law — it is an employer's tool. What gets fined in practice is something else: allowing a person to work without a valid medical exam:",
      items: [
        "Art. 5.27.1 Part 3 CAO RF — allowing work without training, briefing, knowledge testing or a mandatory medical exam: for officials and sole proprietors RUB 15,000 to 25,000, for legal entities RUB 110,000 to 130,000 (per employee);",
        "Art. 6.3 CAO RF — breach of legislation on the sanitary and epidemiological well-being of the population: for legal entities RUB 10,000 to 20,000 or suspension of activity for up to 90 days.",
      ],
      note: `${FINES_NOTE} The fine under Part 3 of Art. 5.27.1 is charged per employee, so three expired medical books mean three fines.`,
    },
  },

  training_plan: {
    sample: {
      caption:
        "An extract from the annual plan: each topic shows who it is for, how often it runs, who leads it and in which month. Actual sessions are then recorded in the briefing log.",
      columns: ["Topic", "For whom", "Frequency", "Responsible person", "Timing"],
      rows: [
        ["Induction: personal hygiene, work clothing, handwashing", "All new employees", "On hiring", "Ivanova M. P., head chef", "On the first day"],
        ["Critical control points and actions on deviations", "Cooks, pastry cooks", "Twice a year", "Kuznetsov D. V., food technologist", "January, July"],
        ["Washing and disinfection: products, concentrations, equipment", "Dishwashers, kitchen hands", "Once a year and when the product changes", "Ivanova M. P., head chef", "March"],
        ["Allergens and preventing cross-contamination", "Cooks, waiters", "Once a year", "Kuznetsov D. V., food technologist", "October"],
      ],
    },
    sections: [
      {
        heading: "Why a plan is needed if briefings are held anyway",
        paragraphs: [
          "Article 10 of TR CU 021/2011 requires the manufacturer to develop and maintain procedures based on HACCP principles. Procedures work only when staff know them, so training is a mandatory part of the system, and the plan shows that it happens regularly rather than from one inspection to the next.",
          "Without a plan, briefings are held from memory: some topics are repeated every month, others are not reached for years. The plan fixes this — over a year, every position gets its own set of topics.",
        ],
      },
      {
        heading: "Which topics to include",
        bullets: [
          "Induction for newcomers: personal hygiene, work clothing, handwashing rules, how shift clearance works.",
          "The critical control points of your own operation: what to measure, where the limit is and what to do when it is exceeded.",
          "Washing and disinfection: products, working concentrations, colour-coding of equipment.",
          "Storage and product compatibility, shelf life, labelling of semi-finished products.",
          "Allergens and cross-contamination — especially for kitchens with a children's menu.",
          "What to do when a guest complains or food poisoning is suspected.",
        ],
      },
      {
        heading: "How to draw up and approve the plan",
        paragraphs: [
          "The plan is drawn up by the food technologist or the HACCP team leader and approved by the director. For each topic, it states who takes it, how often, who leads it and in which month. Unscheduled training is added in response to events: new equipment, a change of cleaning product, a recipe change, recurring deviations in the logs, guest complaints.",
          "Once a year, the plan is reviewed based on the internal audit: topics where staff made mistakes are scheduled more often.",
        ],
      },
      {
        heading: "What auditors and inspectors check",
        bullets: [
          "Whether the plan is approved and reflects the risks of this particular operation rather than a downloaded template.",
          "Whether the dates and topics in the plan match the entries in the briefing log.",
          "Whether employees hired in recent months have completed induction.",
          "Whether cooks at their workstations know their critical control points and what to do in case of a deviation.",
        ],
      },
      {
        heading: "The training plan in WeSetup",
        paragraphs: [
          "In WeSetup, the staff training plan is linked to positions: a new employee automatically gets the induction topics, and the manager sees which briefings are scheduled for the month and which are overdue. A completed session is recorded in the briefing log, and the plan shows progress on each topic.",
        ],
      },
    ],
    fines: {
      intro:
        "The CAO RF has no fine specifically for the lack of a training plan: it is an internal document of the HACCP system. But at an inspection, the absence of a plan and of training records means the HACCP procedures do not actually work, and this is classed as a breach of the technical regulation or of sanitary requirements:",
      items: [
        "Art. 14.43 CAO RF — breach of technical regulation requirements (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000;",
        "Art. 6.6 CAO RF — breach of sanitary and epidemiological requirements for catering: for legal entities RUB 20,000 to 40,000 or suspension of activity for up to 90 days.",
      ],
      note: FINES_NOTE,
    },
  },

  staff_training: {
    sample: {
      caption:
        "A week of entries: induction for a new cook, a scheduled session on critical control points and an unscheduled briefing after a change of disinfectant. Both the trainer and the trainee sign.",
      columns: ["Date", "Type", "Topic", "Employee, position", "Conducted by", "Trainee's signature"],
      rows: [
        ["09.11.2026", "Induction", "Personal hygiene, work clothing, shift clearance", "Lebedeva N. I., cook", "Ivanova M. P., head chef", "Signed"],
        ["10.11.2026", "Scheduled", "Temperature control during heat treatment", "Smirnova E. V., cook", "Kuznetsov D. V., food technologist", "Signed"],
        ["10.11.2026", "Scheduled", "Temperature control during heat treatment", "Kozlov A. A., cook", "Kuznetsov D. V., food technologist", "Signed"],
        ["13.11.2026", "Unscheduled", "New disinfectant: concentration, contact time", "Akhmedov R. T., dishwasher", "Ivanova M. P., head chef", "Signed"],
      ],
    },
    sections: [
      {
        heading: "How this log differs from occupational safety logs",
        paragraphs: [
          "This log records food safety training — hygiene, critical control points, washing and disinfection, allergens. It is part of the HACCP procedures under Article 10 of TR CU 021/2011.",
          "Occupational safety briefings — induction, on-the-job, refresher — are recorded separately, under the rules of labour law. It is best not to mix them in one log: they are checked by different authorities against different requirements.",
        ],
      },
      {
        heading: "Types of briefings and when to hold them",
        bullets: [
          "Induction — for a new employee before they start working independently.",
          "Scheduled — according to the annual training plan, on topics for the employee's position.",
          "Unscheduled — when there is new equipment, a change of cleaning product, or a change in recipe or process.",
          "Targeted — after a serious deviation or complaint: a review of the incident with the staff who were on shift.",
        ],
      },
      {
        heading: "How to make a proper entry",
        paragraphs: [
          "One row per employee: even if the session was for the whole shift, each person signs for themselves. The topic should be specific — “HACCP” with no content will not satisfy an inspector. If knowledge was tested after the briefing, orally or with a quiz, the result is written in the notes.",
          "An employee who was on sick leave or on holiday on the day of the session is briefed separately after returning and recorded with the actual date, not backdated.",
          "Session materials — the handout, the instruction, the quiz questions — are kept together with the log. They show exactly what the employee studied, and they are reused the next time the topic is repeated.",
        ],
      },
      {
        heading: "Mistakes that are obvious at once",
        bullets: [
          "All the employees' signatures look the same or were made by one hand.",
          "A new employee has been on the shift rota for a week, but there is no induction entry.",
          "The topics in the log do not match the approved training plan.",
          "After a serious deviation or complaint, no targeted briefing was held with the shift.",
          "During an incident investigation it turns out that a cook does not know their critical control point, despite having signed for the briefing.",
        ],
      },
      {
        heading: "Recording briefings electronically",
        paragraphs: [
          "In WeSetup, the employee confirms the briefing in their own account on a phone, and the service stores the date, time and user — this replaces the signature on a paper row. The manager sees who on the shift has not yet covered the topic, and the PDF export produces the usual table of the staff briefing and training journal.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for missing HACCP training records — this is treated as food safety procedures that do not work. If occupational safety briefings are not documented, however, liability arises under labour law:",
      items: [
        "Art. 14.43 CAO RF — breach of technical regulation requirements (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000;",
        "Art. 5.27.1 Part 3 CAO RF — allowing work without training, briefing, knowledge testing or a mandatory medical exam: for officials and sole proprietors RUB 15,000 to 25,000, for legal entities RUB 110,000 to 130,000 (per employee).",
      ],
      note: FINES_NOTE,
    },
  },

  ppe_issuance: {
    sample: {
      caption:
        "A month of issue entries: each item shows the quantity, the wear period under the standard and the employee's signature. Disposable gloves are issued in batches as they are used up.",
      columns: ["Date", "Employee, position", "PPE item", "Qty", "Wear period", "Signature"],
      rows: [
        ["02.11.2026", "Akhmedov R. T., dishwasher", "Rubberised apron", "1 pc", "Until worn out", "Received"],
        ["02.11.2026", "Akhmedov R. T., dishwasher", "Rubber gloves", "6 pairs", "1 month", "Received"],
        ["02.11.2026", "Smirnova E. V., cook", "Heat-resistant gloves", "1 pair", "6 months", "Received"],
        ["09.11.2026", "Kozlov A. A., kitchen hand", "Non-slip footwear", "1 pair", "12 months", "Received"],
        ["16.11.2026", "Petrova O. S., pastry cook", "Disposable nitrile gloves", "100 pcs", "As used", "Received"],
      ],
    },
    sections: [
      {
        heading: "Who must issue PPE and keep records",
        paragraphs: [
          "The RF Labour Code requires the employer to provide employees with personal protective equipment at its own expense, and the issue standards are set under Ministry of Labour Order No. 767n, taking into account the occupational risk assessment and the special assessment of working conditions. The obligation is the same for a cafe, a canteen and a production site, regardless of headcount.",
          "Issues are recorded in each employee's personal PPE record card or in a common log. The storekeeper or administrator is usually responsible, and the list by position is approved by the manager.",
        ],
      },
      {
        heading: "Work clothing and PPE: do not confuse them",
        paragraphs: [
          "A cook's jacket, hat and apron are sanitary clothing: they protect the product from the person, and Rospotrebnadzor checks them under SanPiN. PPE protects the person from the workplace: heat-resistant gloves, a dishwasher's rubberised apron, non-slip footwear, gloves for handling cleaning products. Both can be recorded in one log, but in separate rows — so it is clear what was issued under which standard.",
        ],
      },
      {
        heading: "How to issue and replace PPE",
        bullets: [
          "Draw up a PPE list for each position based on the standards and the risk assessment results.",
          "Issue PPE before the employee starts work, not a week after hiring.",
          "Record the quantity and wear period; the employee signs for receipt.",
          "Replace worn or damaged PPE early, noting the reason.",
          "On dismissal, record the return of PPE whose wear period has not expired.",
        ],
      },
      {
        heading: "What the labour inspectorate checks",
        bullets: [
          "Whether the items issued match the standards for the position.",
          "Whether the employee has signed for each issue.",
          "Whether the wear period of what the employee is currently using has expired.",
          "Whether the PPE issued has a certificate or declaration of conformity.",
          "Whether PPE is actually used at the workstation — heat-resistant gloves at the combi oven, not in the locker.",
        ],
      },
      {
        heading: "Recording PPE issue electronically",
        paragraphs: [
          "In WeSetup, the issue standard is set once per position. The service shows who is entitled to what, calculates replacement dates and sends reminders in advance. The employee confirms receipt on a phone, the date and time are stored, and the personal protective equipment issue journal is exported to PDF for the inspectorate.",
        ],
      },
    ],
    fines: {
      intro:
        "Here liability is set out directly in the CAO RF: for failing to issue PPE and for breaching the rules on providing it. The issue log is the main evidence that the employer has met this obligation:",
      items: [
        "Art. 5.27.1 Part 4 CAO RF — failure to provide employees with personal protective equipment: for officials and sole proprietors RUB 20,000 to 30,000, for legal entities RUB 130,000 to 150,000;",
        "Art. 5.27.1 Part 1 CAO RF — breach of occupational safety requirements: for officials and sole proprietors RUB 2,000 to 5,000, for legal entities RUB 50,000 to 80,000.",
      ],
      note: `${FINES_NOTE} Without the employee's signature, the issue of PPE is hard to prove even if purchase invoices exist.`,
    },
  },

  vitaminization: {
    sample: {
      caption:
        "Three days of entries from a school kitchen: ascorbic acid is added to the lunch drink or dessert, and the amount is calculated for the number of portions. No more than half an hour passes between adding it and serving.",
      columns: ["Date", "Dish", "Supplement", "Added, g", "Portions", "Time added", "Time served", "Responsible person"],
      rows: [
        ["10.11.2026", "Dried fruit compote", "Ascorbic acid", "6.0", "120", "11:40", "12:10", "Sidorova T. N., nurse"],
        ["11.11.2026", "Berry kissel", "Ascorbic acid", "5.9", "118", "11:45", "12:15", "Sidorova T. N., nurse"],
        ["12.11.2026", "Apple compote", "Ascorbic acid", "6.1", "122", "11:40", "12:05", "Sidorova T. N., nurse"],
      ],
    },
    sections: [
      {
        heading: "Where vitamin C enrichment is mandatory",
        paragraphs: [
          "Vitamin enrichment of dishes is a SanPiN 2.3/2.4.4282-26 requirement for institutional catering: kindergartens, schools, summer camps, hospitals and sanatoriums, care homes for the elderly. Ordinary cafes and canteens for adults do not do it and do not keep this log.",
          "If a catering company prepares meals for a school or kindergarten, the obligation and the log stay with whoever adds the vitamin to the dish — usually the kitchen at the point of service.",
        ],
      },
      {
        heading: "Who adds the supplement and how to calculate the dose",
        paragraphs: [
          "It is added by the medical worker or, in their absence, by a person appointed by internal order, usually the head chef. The amount is based on the age-specific norm per portion multiplied by the number of portions that day. If there are fewer portions than on the menu requisition, recalculate based on the actual number rather than adding “the same as yesterday”.",
          "Only approved supplements or industrially produced fortified drinks are used, following the manufacturer's instructions. The supplement is stored separately, in a dry place protected from light.",
          "If a fortified drink is served instead of adding the vitamin to a dish, the log records that drink: its name, the number of portions and the time it was served. Supplement stock is reconciled with the records — consumption must match the number of fortified portions.",
        ],
      },
      {
        heading: "Vitamin enrichment step by step",
        bullets: [
          "Cool the drink or dessert — vitamin C breaks down in hot food.",
          "Dissolve the measured amount in a small volume of the dish and mix it into the rest.",
          "Record the time it was added, the amount of supplement and the number of portions.",
          "Serve the dish promptly, without reheating.",
          "Sign the log; if the dish on the menu was replaced, record the one actually served.",
        ],
      },
      {
        heading: "Mistakes most often found at inspections",
        bullets: [
          "Entries only on weekdays, although the camp or hospital also serves meals at weekends.",
          "The same amount of supplement with different numbers of portions.",
          "The time added is later than the serving time, or missing.",
          "The dish in the log does not match the approved menu for that day.",
          "An expired supplement, or one without documents confirming its origin.",
        ],
      },
      {
        heading: "The vitamin enrichment log in WeSetup",
        paragraphs: [
          "In WeSetup, the number of portions is pulled from the day's menu, and the service immediately calculates how much supplement to add. The nurse records the addition on a phone, the time is set automatically, and the manager gets a reminder if there is no entry by lunchtime. For inspections, the beverage and dessert vitamin enrichment journal is exported to PDF in the familiar format.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate article for the vitamin enrichment log. Skipping vitamin enrichment in a children's or medical institution is a breach of catering requirements, and without records the institution has no way to confirm it is being done:",
      items: [
        "Art. 6.6 CAO RF — breach of sanitary and epidemiological requirements for catering: for legal entities RUB 20,000 to 40,000 or suspension of activity for up to 90 days;",
        "Art. 6.3 CAO RF — breach of legislation on the sanitary and epidemiological well-being of the population: for legal entities RUB 10,000 to 20,000 or suspension of activity for up to 90 days.",
      ],
      note: `${FINES_NOTE} For state-funded institutions, a fine is usually accompanied by a compliance order and a follow-up check.`,
    },
  },

  ration_control: {
    sample: {
      caption:
        "A kindergarten statement for the first ten days of November: for each food group, the norm and the actual amount issued per child per day, with the deviation in per cent. The meat shortfall is explained in the notes.",
      columns: ["Period", "Food group", "Norm, g", "Actual, g", "Deviation, %", "Notes"],
      rows: [
        ["01.11–10.11.2026", "Milk and fermented dairy products", "350", "342", "−2.3", "—"],
        ["01.11–10.11.2026", "Meat", "55", "48", "−12.7", "Replaced with fish on 05.11; adjust the menu"],
        ["01.11–10.11.2026", "Fish", "37", "44", "+18.9", "Replaced meat on 05.11"],
        ["01.11–10.11.2026", "Fresh vegetables", "280", "286", "+2.1", "—"],
        ["01.11–10.11.2026", "Fresh fruit", "185", "170", "−8.1", "Disruption in apple deliveries"],
      ],
    },
    sections: [
      {
        heading: "Who must monitor the diet",
        paragraphs: [
          "Comparing the actual diet with the norms is done by institutions with organised catering: kindergartens, schools, camps, hospitals, sanatoriums, care homes for the elderly. The average daily food sets for different ages and types of institution are set by SanPiN 2.3/2.4.4282-26. Cafes and workplace canteens have no such norms and do not keep this statement.",
        ],
      },
      {
        heading: "Who calculates the actual diet and how",
        paragraphs: [
          "It is calculated by the medical worker, the dietary nurse or the food technologist, and in a school by the person in charge of catering. The sources are the menu requisitions and the product issue notes for the period. The amount of each product is divided by the number of days and the number of people fed, giving the amount per person per day, which is then compared with the norm.",
          "Only what was actually issued for cooking is counted. Products that arrived at the storeroom but did not go into the menu are excluded — otherwise the statement will show norms being met when they were not.",
          "The calculation period is 10 days or a month, as set in the production control programme. At the end of the period, the statement is signed by whoever did the calculation and approved by the manager. It is kept together with the menu requisitions and issue notes so that the calculation can be rechecked.",
        ],
      },
      {
        heading: "What to do when there is a deviation from the norm",
        bullets: [
          "Record the reason in the notes: a product substitution, supply disruption, quarantine in a group.",
          "Check whether the shortfall was made up by a substitution from the table of equivalent replacements.",
          "Adjust the next period's menu so that the food group gets back to the norm.",
          "If there is a systematic shortfall, look into purchasing and portion yields, not just the menu.",
        ],
      },
      {
        heading: "What Rospotrebnadzor and parents look at",
        paragraphs: [
          "The inspector compares the statement with the menu, the issue notes and the prepared food quality checks: if the statement shows the meat norm met but meat dishes rarely appear on the menu, the calculation will be questioned. Parent committees in schools are also increasingly asking for these statements. One or two deviations with an explanation and a menu correction raise no questions, but a chronic shortfall with no explanation is grounds for a compliance order.",
        ],
      },
      {
        heading: "Calculating the diet electronically",
        paragraphs: [
          "In WeSetup, the diet monitoring record is compiled from the menu and write-offs for the period, deviations are calculated automatically and highlighted if they exceed the permitted limits. The responsible person only needs to check the calculation, add the reason in the notes and, for an inspection, export the table to PDF.",
        ],
      },
    ],
    fines: {
      intro:
        "There is no separate fine for the statement itself. But failing to meet nutrition norms in a children's or medical institution is a breach of catering requirements, and these records are the main document used to check it:",
      items: [
        "Art. 6.6 CAO RF — breach of sanitary and epidemiological requirements for catering: for legal entities RUB 20,000 to 40,000 or suspension of activity for up to 90 days.",
      ],
      note: `${FINES_NOTE} For a contract catering supplier, falling short of the norms can also give the customer grounds for a claim.`,
    },
  },

  daily_samples: {
    sample: {
      caption:
        "Samples taken from lunch in a school canteen: at least 100 g from every dish, including the side dish and bread, with bread taken as a whole slice. The disposal date is entered straight away, 48 hours after sampling.",
      columns: ["Date, meal", "Dish", "Sample weight, g", "Sampling time", "Storage, °C", "Disposal", "Taken by"],
      rows: [
        ["17.11.2026, lunch", "Pea soup", "100", "12:05", "+4", "19.11 at 12:10", "Ivanova M. P."],
        ["17.11.2026, lunch", "Chicken cutlet", "1 pc, 82", "12:07", "+4", "19.11 at 12:10", "Ivanova M. P."],
        ["17.11.2026, lunch", "Mashed potatoes", "120", "12:07", "+4", "19.11 at 12:10", "Ivanova M. P."],
        ["17.11.2026, lunch", "Dried fruit compote", "150", "12:08", "+4", "19.11 at 12:10", "Ivanova M. P."],
        ["17.11.2026, lunch", "Rye bread", "1 slice", "12:08", "+4", "19.11 at 12:10", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Where daily samples are taken",
        paragraphs: [
          "Samples are mandatory in institutional catering: kindergartens, schools, camps, hospitals, sanatoriums, and also for those who prepare meals for them under contract. The requirement is set by SanPiN 2.3/2.4.4282-26. Ordinary cafes do not take samples, but many workplace canteens and caterers serving events do so voluntarily — a sample protects them too.",
        ],
      },
      {
        heading: "How to take and store a sample properly",
        bullets: [
          "Take a sample from every dish of the meal, including side dishes, sauces, bread and drinks — after the quality check and before serving starts.",
          "A portioned sample weighs at least 100 g; individual items (cutlets, cheese pancakes, pies) are taken whole, at least one piece.",
          "Containers must be clean, boiled or sanitised, with lids; each dish goes in a separate container.",
          "Each container is labelled with the date, the meal and the name of the dish.",
          "Samples are kept for 48 hours in a separate fridge or on a dedicated shelf at +2…+6 °C, with no access for unauthorised persons.",
        ],
      },
      {
        heading: "Who is responsible and what to do after 48 hours",
        paragraphs: [
          "Samples are taken by a cook or a medical worker appointed by internal order, and the same person is responsible for disposal. After 48 hours, the samples are disposed of and the containers are washed and disinfected. If anyone who ate the meals falls ill during those two days, the samples are not thrown away: they are kept until Rospotrebnadzor specialists arrive.",
        ],
      },
      {
        heading: "Mistakes that make a sample useless",
        bullets: [
          "Not all dishes were sampled — for example, no bread or no salad from the additional menu.",
          "The sample is under 100 g, or only half a cutlet was taken.",
          "Samples are kept in a shared fridge together with food products.",
          "There is no record of the storage temperature, or the fridge is not monitored with a thermometer.",
          "Samples are disposed of early “to free up space”.",
        ],
      },
      {
        heading: "The daily sample log in electronic form",
        paragraphs: [
          "In WeSetup, the list of dishes for each meal comes from the day's menu; the cook records sampling on a phone and sees which dishes have not yet been sampled. The sampling time is recorded automatically, the disposal date is filled in straight away, and a reminder arrives after 48 hours. The daily food sample collection and storage journal is exported to PDF in the layout of the paper form.",
        ],
      },
    ],
    fines: {
      intro:
        "The CAO RF has no separate article on daily samples. Missing samples or sample records are a breach of SanPiN catering requirements, and in the event of food poisoning in a group they are a serious aggravating circumstance:",
      items: [
        "Art. 6.6 CAO RF — breach of sanitary and epidemiological requirements for catering: for legal entities RUB 20,000 to 40,000 or suspension of activity for up to 90 days;",
        "Art. 6.3 CAO RF — breach of legislation on the sanitary and epidemiological well-being of the population: for legal entities RUB 10,000 to 20,000 or suspension of activity for up to 90 days.",
      ],
      note: `${FINES_NOTE} Without samples, the kitchen has no way to prove that its dishes were not the cause of the poisoning.`,
    },
  },

  complaint_register: {
    sample: {
      caption:
        "Two weeks of entries: each complaint shows the channel, the issue, the investigation outcome and the action taken. The last column shows whether the case is closed and what response the guest received.",
      columns: ["Date", "Channel", "Complaint", "Investigation", "Action", "Status"],
      rows: [
        ["03.11.2026", "Verbal, in the dining room", "Soup served cold", "Serving temperature 58 °C, bain-marie not switched on", "Dish replaced, waiters briefed", "Closed"],
        ["07.11.2026", "Website review", "Hair in salad", "Cook on shift without a hat", "Apology and compensation, work clothing check", "Closed"],
        ["11.11.2026", "Phone", "Felt unwell after a delivery order", "Quality checks and daily samples show no deviations, no complaints from other guests", "Reply to the guest, monitoring", "Closed"],
        ["15.11.2026", "Social media", "Allergen missing from the ingredients", "The delivery menu does not mention nuts", "Menu corrected", "In progress"],
      ],
    },
    sections: [
      {
        heading: "Why every complaint should be registered",
        paragraphs: [
          "The RF Law “On Consumer Rights Protection” gives a guest the right to demand a replacement dish, a price reduction or a refund for a service of inadequate quality, and sets deadlines for responding to a claim. Registration shows that the claim was accepted and dealt with on time.",
          "For the HACCP system, a complaint is a signal that a process has failed. One complaint about a cold dish is an incident; three in a month mean temperature control at the serving line is not working. Without a single register, such repetitions go unnoticed.",
        ],
      },
      {
        heading: "What to register",
        bullets: [
          "Quality and safety claims: foreign objects, taste, smell, temperature, short portions.",
          "Reports of feeling unwell after eating — even if the guest does not ask for compensation.",
          "Complaints about allergens and dish ingredients.",
          "Reviews on websites and social media that describe a specific incident.",
          "Claims from catering clients and from organisations supplied with meals.",
        ],
      },
      {
        heading: "How to investigate a complaint",
        paragraphs: [
          "The responsible person — the floor manager, general manager or food technologist — records the issue, the date and the contact details on the day it is received. They then pull the records for that dish: the prepared food quality check, temperatures, the shift's hygiene check, and the daily samples if these are taken. Based on this, they identify the cause and the action: a briefing, a change of supplier, a change to the technological card.",
          "If a guest reports symptoms of food poisoning, the investigation must happen the same day: keep any remaining product and samples, do not throw away the batch of raw materials, and check for similar reports.",
        ],
      },
      {
        heading: "What is checked at inspections and audits",
        bullets: [
          "Whether each complaint has a conclusion about the cause, not just “we apologised”.",
          "Whether corrective actions have been closed and their effectiveness verified.",
          "Whether the registered complaints match the reviews on public platforms.",
          "Whether recurring complaints are analysed when the HACCP plan is reviewed.",
        ],
      },
      {
        heading: "The complaint register in WeSetup",
        paragraphs: [
          "In WeSetup, a complaint is registered on a phone right in the dining room and immediately becomes a corrective action task with an assignee and a deadline. The manager sees open cases and recurring causes, and at an inspection exports the complaint register to PDF together with the history of actions taken.",
        ],
      },
    ],
    fines: {
      intro:
        "The law does not directly require such a log: it is a HACCP system procedure. What gets fined is what lies behind the complaint — a poor-quality dish or a breach of sanitary requirements that it has revealed:",
      items: [
        "Art. 14.4 Part 1 CAO RF — selling goods, performing work or providing services of inadequate quality: for legal entities RUB 20,000 to 30,000;",
        "Art. 6.6 CAO RF — breach of sanitary and epidemiological requirements for catering: for legal entities RUB 20,000 to 40,000 or suspension of activity for up to 90 days.",
      ],
      note: `${FINES_NOTE} A guest's complaint to Rospotrebnadzor often triggers an unscheduled inspection, and a register with investigations shows that the business responds on its own.`,
    },
  },

  finished_product: {
    sample: {
      caption:
        "Quality check of lunch in a canteen: each dish has been assessed for appearance, taste and smell, its temperature measured, and the committee has approved it for serving. One dish was withdrawn from the serving line, and the reason is given in its row.",
      columns: ["Time", "Dish", "Sensory assessment", "Temperature, °C", "Decision", "Committee"],
      rows: [
        ["11:30, 17.11.2026", "Chicken noodle soup", "No remarks", "78", "Approved for serving", "Ivanova M. P., Kuznetsov D. V."],
        ["11:35, 17.11.2026", "Beef goulash", "No remarks", "74", "Approved for serving", "Ivanova M. P., Kuznetsov D. V."],
        ["11:40, 17.11.2026", "Boiled rice", "Sticky, overcooked and dry", "70", "Withdrawn, new batch prepared", "Ivanova M. P., Kuznetsov D. V."],
        ["11:55, 17.11.2026", "Boiled rice, new batch", "No remarks", "72", "Approved for serving", "Ivanova M. P., Kuznetsov D. V."],
        ["12:00, 17.11.2026", "Fresh cabbage salad", "No remarks", "8", "Approved for serving", "Ivanova M. P., Kuznetsov D. V."],
      ],
    },
    sections: [
      {
        heading: "Who sits on the food quality assessment committee",
        paragraphs: [
          "The committee members are approved by the manager's internal order. In a cafe or restaurant, this is usually the head chef or sous-chef and a second employee — a food technologist or administrator. In a school or kindergarten, the committee includes the medical worker and a representative of the administration, and parent committees may also check the menu and the quality checks. In production, it is the food technologist and the shift foreman.",
          "The cook who prepared the dish may be present, but the decision is made by the committee: nobody should assess their own work.",
        ],
      },
      {
        heading: "How to carry out the quality check",
        bullets: [
          "Assess every batch before serving starts, not one dish for the whole shift.",
          "Compare with the technological card: yield, appearance, texture, colour, smell, taste.",
          "Measure the temperature with a probe in the centre of the dish, not on the surface.",
          "Taste with clean utensils, using a separate spoon for each dish.",
          "Record the decision and the time of approval for serving; a dish without this mark is not served.",
        ],
      },
      {
        heading: "If a dish fails the quality check",
        paragraphs: [
          "The dish is withdrawn from the serving line and the reason is recorded specifically: “undersalted”, “off smell”, “temperature below the norm”. If the defect can be fixed without risk — reheating, cooking until done — a repeat check is carried out after rework and recorded in a separate row. A dish with signs of spoilage, foreign matter or insufficient heat treatment of meat or poultry is not fixed but written off.",
          "Repeated remarks about the same dish are a reason to review the technological card or brief the cook.",
        ],
      },
      {
        heading: "What the inspector looks at",
        bullets: [
          "The quality check time is before serving starts, not after lunch.",
          "All dishes on the day's menu are in the log, including side dishes, sauces and drinks.",
          "The assessment is specific — “no remarks” is acceptable, but not a single tick for the whole day.",
          "All committee members have signed, and the membership matches the internal order.",
        ],
      },
      {
        heading: "The prepared food quality log on a phone",
        paragraphs: [
          "In WeSetup, the shift's dishes are pulled from the menu or the accounting system, and a committee member assesses each one on a phone at the serving line and enters the temperature. The entry time is set automatically, withdrawn dishes are immediately visible to the manager, and the prepared food quality inspection journal is exported to PDF in the layout of the paper form.",
        ],
      },
    ],
    fines: {
      intro:
        "The CAO RF has no separate article for missing quality check records. But serving dishes without quality control breaches SanPiN 2.3/2.4.4282-26 and TR CU 021/2011, and a poor-quality dish violates consumer rights:",
      items: [
        "Art. 6.6 CAO RF — breach of sanitary and epidemiological requirements for catering: for legal entities RUB 20,000 to 40,000 or suspension of activity for up to 90 days;",
        "Art. 14.43 CAO RF — breach of technical regulation requirements (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000;",
        "Art. 14.4 Part 1 CAO RF — selling goods, performing work or providing services of inadequate quality: for legal entities RUB 20,000 to 30,000.",
      ],
      note: FINES_NOTE,
    },
  },
};
