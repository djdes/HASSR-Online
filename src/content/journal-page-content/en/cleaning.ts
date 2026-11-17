import type { JournalPageContent } from "../types";

export const CLEANING_PAGE_CONTENT_EN: Record<string, JournalPageContent> = {
  cleaning: {
    sample: {
      caption:
        "This is what one shift looks like: for each area there is the type of cleaning, the product and its concentration, who did the work and the supervisor’s sign-off. Routine and deep cleaning sit side by side in the same journal.",
      columns: ["Date", "Room / area", "Type of cleaning", "Time", "Product, concentration", "Done by", "Checked by"],
      rows: [
        ["03.11.2026", "Hot kitchen", "Routine", "08:10–08:35", "Nika-Super, 1%", "Smirnova E. V.", "Accepted, Ivanova M. P."],
        ["03.11.2026", "Cold kitchen", "Routine", "11:40–12:00", "Progress, 0.5%", "Kozlov A. A.", "Accepted, Ivanova M. P."],
        ["03.11.2026", "Washing room", "Routine", "15:20–15:45", "Nika-Extra M, 1%", "Smirnova E. V.", "Accepted, Ivanova M. P."],
        ["03.11.2026", "Storeroom, cold rooms", "Deep", "16:00–17:30", "Deo-Chlor, 0.05%", "Kozlov A. A.", "Accepted, Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Who must keep a cleaning log",
        paragraphs: [
          "Every catering business and food production site keeps one: cafes, restaurants, canteens, bars, bakeries, caterers, school and hospital kitchens. The requirement comes from SanPiN 2.3/2.4.4282-26 (daily wet cleaning, wiping tables after every guest, rules for cleaning equipment) and from the HACCP-based production control programme (TR CU 021/2011).",
          "Shops with a deli counter, kindergartens, medical and cosmetology practices need the same records — only the areas and frequency differ. The person in charge is usually the production manager, head chef or administrator: they check the work and sign in the “Checked by” column.",
        ],
      },
      {
        heading: "Routine and deep cleaning: how to record them",
        paragraphs: [
          "Routine cleaning happens every day, often several times per shift: washing floors, wiping tables and work surfaces, sinks and equipment, taking out waste. In our form it is marked with “R” in the day’s cell.",
          "Deep cleaning follows the schedule in the production control programme — usually once a month, and more often in kitchens of children’s and medical facilities. Walls are washed floor to ceiling, along with ceilings, light fittings, extraction hoods and the outside of cold rooms, and everything is disinfected after washing. It is marked with “G”, while days off and days without cleaning get a “/”. If deep cleaning is signed off by a separate person, it is easier to track it in a dedicated deep cleaning schedule.",
        ],
      },
      {
        heading: "What to record",
        bullets: [
          "Date and shift — they show how regular the cleaning is and where gaps occur.",
          "Room or area: hot and cold kitchens, washing room, storeroom, dining room, staff toilet.",
          "Type of cleaning: routine or deep, plus disinfection where needed.",
          "The detergent or disinfectant and the working concentration of the solution.",
          "The surname of the employee who did the cleaning.",
          "The supervisor’s mark and signature confirming the work was accepted.",
        ],
      },
      {
        heading: "How long to keep it and what the inspector checks",
        paragraphs: [
          "Keep completed sheets for at least a year: during scheduled and unscheduled inspections Rospotrebnadzor usually asks for the last 12 months of records. The inspector compares the entries with the cleaning schedule, looks for gaps and backdated entries, checks that products and concentrations match their instructions for use, and makes sure the supervisor has signed.",
        ],
      },
      {
        heading: "Electronic cleaning records instead of paper",
        paragraphs: [
          "A paper form is easy to fill in for show — a whole week at once. In WeSetup an employee scans the QR code at the kitchen entrance, picks the area and records the cleaning on their phone in a few seconds; the time is logged automatically and any backdated correction shows up in the history. The manager sees which areas have been cleaned today, gets reminders about missed ones and, before an inspection, exports the cleaning journal to PDF in the same layout as the printed form.",
        ],
      },
    ],
    fines: {
      intro:
        "The CAO RF has no separate fine for not keeping this journal. But without records the business cannot prove that cleaning and disinfection take place, and the inspector records a breach of sanitary requirements:",
      items: [
        "Art. 6.6 of the CAO RF — violation of sanitary and epidemiological requirements for catering: for legal entities RUB 20,000 to 40,000 or suspension of activities for up to 90 days;",
        "Art. 6.3 of the CAO RF — violation of sanitary legislation on the premises: for legal entities RUB 10,000 to 20,000 or suspension of activities for up to 90 days;",
        "Art. 14.43 of the CAO RF — violation of technical regulations (TR CU 021/2011): for sole proprietors RUB 20,000 to 30,000, for legal entities RUB 100,000 to 300,000.",
      ],
      note: "Amounts are based on the CAO RF as amended in November 2026. A carefully kept journal is the first document requested at an inspection and the best evidence that the sanitary regime is being followed.",
    },
  },
};
