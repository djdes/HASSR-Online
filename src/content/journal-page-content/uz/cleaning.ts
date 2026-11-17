import type { JournalPageContent } from "../types";

/**
 * Uzbek (Latin) translation of `../cleaning.ts`: same structure, same numbers
 * in the fines items (articles and amounts of the Russian Code of
 * Administrative Offences).
 */
export const CLEANING_PAGE_CONTENT_UZ: Record<string, JournalPageContent> = {
  cleaning: {
    sample: {
      caption:
        "Bir smenadagi yozuvlar shunday ko‘rinadi: har bir hudud uchun tozalash turi, vosita va uning konsentratsiyasi, ijrochi hamda mas’ul shaxsning ishni qabul qilgani haqidagi belgisi. Joriy va umumiy tozalash bitta jurnalda yonma-yon qatorlarda yoziladi.",
      columns: ["Sana", "Xona / hudud", "Tozalash turi", "Vaqt", "Vosita, konsentratsiya", "Ijrochi", "Nazorat"],
      rows: [
        ["03.11.2026", "Issiq sex", "Joriy", "08:10–08:35", "Nika-Super, 1 %", "Smirnova E. V.", "Qabul qilindi, Ivanova M. P."],
        ["03.11.2026", "Sovuq sex", "Joriy", "11:40–12:00", "Progress, 0,5 %", "Kozlov A. A.", "Qabul qilindi, Ivanova M. P."],
        ["03.11.2026", "Yuvish xonasi", "Joriy", "15:20–15:45", "Nika-Ekstra M, 1 %", "Smirnova E. V.", "Qabul qilindi, Ivanova M. P."],
        ["03.11.2026", "Ombor, sovutish kameralari", "Umumiy", "16:00–17:30", "Deo-Xlor, 0,05 %", "Kozlov A. A.", "Qabul qilindi, Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Xonalarni tozalash jurnalini kim yuritishi shart",
        paragraphs: [
          "Jurnalni barcha umumiy ovqatlanish korxonalari va oziq-ovqat ishlab chiqarishlari yuritadi: kafe, restoranlar, oshxonalar, barlar, novvoyxonalar, keytering, maktab va shifoxonalarning oziq-ovqat bloklari. Bu talab SanPiN 2.3/2.4.4282-26 dan (har kuni nam tozalash, har bir mehmondan keyin stolni artish, tozalash inventari qoidalari) hamda HACCP tamoyillari asosidagi ishlab chiqarish nazorati dasturidan (TR TS 021/2011) kelib chiqadi.",
          "Xuddi shunday hisob kulinariya bo‘limi bor do‘konlarda, bolalar bog‘chalarida, tibbiyot va kosmetologiya kabinetlarida ham kerak — faqat hududlar va davriylik o‘zgaradi. Mas’ul qilib ishlab chiqarish mudiri, bosh oshpaz yoki administrator tayinlanadi: u ishni qabul qiladi va nazorat ustunida imzo qo‘yadi.",
        ],
      },
      {
        heading: "Joriy va umumiy tozalash: qanday belgilanadi",
        paragraphs: [
          "Joriy tozalash har kuni, ko‘pincha smenada bir necha marta o‘tkaziladi: pollarni yuvish, stollar va ish yuzalarini, rakovinalar va uskunalarni tozalash, chiqindilarni olib chiqish. Bizning shaklda u kun katagida «T» harfi bilan belgilanadi.",
          "Umumiy tozalash ishlab chiqarish nazorati dasturidagi jadval bo‘yicha, odatda oyda bir marta, bolalar va tibbiyot muassasalarining oziq-ovqat bloklarida esa tez-tez o‘tkaziladi: devorlar butun balandligi bo‘yicha, shiftlar, yoritgichlar, so‘rg‘ichlar, sovutish kameralarining tashqi tomoni yuviladi, yuvishdan keyin dezinfeksiya qilinadi. U «G» harfi bilan, dam olish kunlari va tozalash bo‘lmagan kunlar esa «/» bilan belgilanadi. Agar umumiy tozalashni alohida mas’ul qabul qilsa, uni umumiy tozalashlar jadvalida alohida yuritish qulayroq.",
        ],
      },
      {
        heading: "Jurnalga nimalar yoziladi",
        bullets: [
          "Sana va smena — ular bo‘yicha muntazamlik va o‘tkazib yuborilgan kunlar ko‘rinadi.",
          "Xona yoki hudud: issiq va sovuq sex, yuvish xonasi, ombor, zal, xodimlar sanuzeli.",
          "Tozalash turi: joriy yoki umumiy, kerak bo‘lsa — dezinfeksiya.",
          "Yuvish yoki dezinfeksiya vositasi va ishchi eritmaning konsentratsiyasi.",
          "Tozalashni bajargan xodimning familiyasi.",
          "Mas’ul shaxsning ishni qabul qilgani haqidagi belgisi va imzosi.",
        ],
      },
      {
        heading: "Qancha saqlanadi va tekshiruvchi nimaga qaraydi",
        paragraphs: [
          "To‘ldirilgan varaqlar kamida bir yil saqlanadi: rejali va rejadan tashqari tekshiruvda Rospotrebnadzor odatda oxirgi 12 oylik yozuvlarni so‘raydi. Tekshiruvchi jurnalni tozalash jadvali bilan solishtiradi, o‘tkazib yuborilgan kunlar yoki orqa sana bilan yozilgan qatorlar yo‘qligini, vositalar va konsentratsiyalar qo‘llash yo‘riqnomalariga mosligini hamda mas’ul shaxs imzolari borligini ko‘radi.",
        ],
      },
      {
        heading: "Qog‘oz o‘rniga elektron tozalash hisobi",
        paragraphs: [
          "Qog‘oz blankani rasmiyatchilik uchun bir haftaga birdaniga to‘ldirib qo‘yish oson. WeSetup’da xodim sex kirishidagi QR-kodni skanerlaydi, hududni tanlaydi va tozalashni telefondan bir necha soniyada belgilaydi; yozuv vaqti avtomatik qayd etiladi, orqa sana bilan qilingan tuzatish esa tarixda ko‘rinib turadi. Rahbar bugun qaysi hududlar tozalanganini ko‘radi, o‘tkazib yuborilganlar haqida eslatma oladi, tekshiruv oldidan esa jurnalni bosma blanka shaklida PDF’ga yuklab oladi.",
        ],
      },
    ],
    fines: {
      intro:
        "RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) bunday jurnal yo‘qligi uchun alohida jarima yo‘q. Ammo yozuvlarsiz korxona tozalash va dezinfeksiya o‘tkazilayotganini isbotlay olmaydi, inspektor esa sanitariya talablari buzilganini qayd etadi:",
      items: [
        "KoAPning 6.6-moddasi — ovqatlanishni tashkil etishga doir sanitariya-epidemiologik talablarni buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib turish;",
        "KoAPning 6.3-moddasi — xonalarda sanitariya qonunchiligini buzish: yuridik shaxslar uchun 10 000 dan 20 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib turish;",
        "KoAPning 14.43-moddasi — texnik reglamentlar (TR TS 021/2011) talablarini buzish: yakka tartibdagi tadbirkorlar (YaTT) uchun 20 000 dan 30 000 ₽ gacha, yuridik shaxslar uchun 100 000 dan 300 000 ₽ gacha.",
      ],
      note: "Summalar — KoAPning 2026-yil noyabr holatidagi tahririga ko‘ra. Puxta to‘ldirilgan jurnal — tekshiruvda birinchi so‘raladigan hujjat va sanitariya rejimiga rioya qilinayotganining eng yaxshi dalili.",
    },
  },
};
