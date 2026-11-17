import type { JournalPageContent } from "../types";

/**
 * Uzbek (Latin) translation of `../sanitary.ts`: same structure, same numbers
 * in the fines items (articles and amounts of the Russian Code of
 * Administrative Offences).
 */

const FINE_6_6 =
  "KoAPning 6.6-moddasi — aholini ovqatlantirishni tashkil etishga doir sanitariya-epidemiologik talablarni buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib turish;";
const FINE_6_3 =
  "KoAPning 6.3-moddasi — sanitariya-epidemiologik osoyishtalikni ta’minlash sohasidagi qonunchilikni buzish: yuridik shaxslar uchun 10 000 dan 20 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib turish;";
const FINE_6_4 =
  "KoAPning 6.4-moddasi — xonalar, binolar va uskunalardan foydalanishga doir sanitariya-epidemiologik talablarni buzish: yuridik shaxslar uchun 10 000 dan 20 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib turish;";
const FINE_14_43 =
  "KoAPning 14.43-moddasi — texnik reglamentlar (TR TS 021/2011) talablarini buzish: yakka tartibdagi tadbirkorlar (YaTT) uchun 20 000 dan 30 000 ₽ gacha, yuridik shaxslar uchun 100 000 dan 300 000 ₽ gacha;";
const FINE_5_27_1 =
  "KoAPning 5.27.1-moddasi 1-qismi — mehnatni muhofaza qilish talablarini buzish: mansabdor shaxslar va YaTT uchun 2 000 dan 5 000 ₽ gacha, yuridik shaxslar uchun 50 000 dan 80 000 ₽ gacha;";
const FINE_8_2 =
  "KoAPning 8.2-moddasi 1-qismi — chiqindilar bilan muomala qilish talablarini buzish: yuridik shaxslar uchun 100 000 dan 250 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib turish;";
const FINE_14_4 =
  "KoAPning 14.4-moddasi 1-qismi — sifatsiz tovar sotish, sifatsiz ish bajarish yoki xizmat ko‘rsatish: yuridik shaxslar uchun 20 000 dan 30 000 ₽ gacha;";

/** The last fines item ends with a full stop instead of «;». */
function finesList(...items: string[]): string[] {
  return items.map((item, index) => (index === items.length - 1 ? item.replace(/;$/, ".") : item));
}

/** Full name of the code, used once per page in the fines intro. */
const KOAP = "RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP)";

const NOTE = "Summalar — KoAPning 2026-yil noyabr holatidagi tahririga ko‘ra.";

export const SANITARY_PAGE_CONTENT_UZ: Record<string, JournalPageContent> = {
  climate_control: {
    sample: {
      caption:
        "Ikki kunlik yozuvlar: har bir xona bo‘yicha ertalabki va kechki harorat hamda nisbiy namlik o‘lchovi. Me’yordan og‘ish bo‘lgan qatorda nima qilingani va natijani kim tekshirgani ko‘rsatilgan.",
      columns: ["Sana", "Xona", "Vaqt", "Harorat, °C", "Namlik, %", "Og‘ishda ko‘rilgan choralar", "Mas’ul"],
      rows: [
        ["10.11.2026", "Quruq mahsulotlar ombori", "08:00", "+18", "58", "—", "Petrova A. S."],
        ["10.11.2026", "Quruq mahsulotlar ombori", "19:00", "+19", "61", "—", "Petrova A. S."],
        ["10.11.2026", "Sabzavot ombori", "08:05", "+9", "88", "—", "Petrova A. S."],
        ["11.11.2026", "Quruq mahsulotlar ombori", "08:00", "+18", "76", "Shamollatish yoqildi, un qoplari stellajga ko‘tarildi; 11:00 da — 62 %", "Petrova A. S., Ivanova M. P."],
        ["11.11.2026", "Issiq sex", "12:30", "+27", "55", "—", "Kozlov A. A."],
      ],
    },
    sections: [
      {
        heading: "Harorat va namlik nazorati qayerda kerak",
        paragraphs: [
          "O‘lchovlar xomashyo va tayyor mahsulot saqlanadigan barcha xonalarda olinadi: quruq mahsulotlar omborlari, sabzavot omborlari, konserva va ichimliklar saqlanadigan omborxonalar, shuningdek ishlab chiqarish sexlari. Saqlash sharoitlarini ishlab chiqaruvchi yorlig‘ida belgilaydi, SanPiN 2.3/2.4.4282-26 ularga rioya qilishni, TR TS 021/2011 esa buni ishlab chiqarish nazorati dasturi doirasida hujjat bilan tasdiqlashni talab qiladi.",
          "Kafe va oshxonalarda odatda ikki-uchta nuqta yetarli: quruq ombor, sabzavot ombori va issiq sex. Ishlab chiqarishda va ulgurji savdo omborlarida nuqtalar ko‘proq — sharoiti har xil bo‘lgan har bir saqlash hududiga bittadan.",
        ],
      },
      {
        heading: "Qanday asboblar bilan o‘lchash kerak",
        bullets: [
          "Nazorat qilinadigan har bir xonada termometr va gigrometr (yoki psixrometr) — eshiklar, batareyalar va ventilyatsiyadan uzoqda, devorda.",
          "Qiyoslash muddati o‘tmagan asboblar: qiyoslanmagan gigrometr ko‘rsatkichini tekshiruvchi qabul qilmasligi mumkin.",
          "Xona uchun me’yor ombordagi eng talabchan mahsulot yorlig‘idan olinadi va jurnal sarlavhasiga yoziladi — xodim ruxsat etilgan oraliqni darhol ko‘rib turadi.",
        ],
      },
      {
        heading: "Ko‘rsatkichlar me’yordan chiqsa nima qilish kerak",
        paragraphs: [
          "Og‘ish darhol yoziladi, «normal» qiymatga tuzatib qo‘yilmaydi. Keyin tartib bilan: sababni topish (ochiq eshik, o‘chirilgan ventilyatsiya, suv oqishi, stellaj yonidagi batareya), uni bartaraf etish, sezgir mahsulotlarni mos xonaga ko‘chirish va bir-ikki soatdan keyin qayta o‘lchash. Agar mahsulot uzoq vaqt sharoitdan tashqarida saqlangan bo‘lsa, undan foydalanish haqida ishlab chiqarish nazorati uchun mas’ul shaxs qaror qiladi, shubhali partiya esa belgi bilan alohida qo‘yiladi.",
        ],
      },
      {
        heading: "Tekshiruvchi topadigan odatiy xatolar",
        bullets: [
          "Har kuni bir xil raqamlar — yozuvlar «xotiradan» qilinganining belgisi.",
          "Omborda un, yorma yoki sabzavot saqlansa ham namlik umuman o‘lchanmaydi.",
          "Og‘ish yozilgan, choralar ustuni esa bo‘sh.",
          "Asbob issiqlik uskunasi tepasida yoki kirish eshigi yonida osilgan.",
        ],
      },
      {
        heading: "Iqlim hisobi elektron shaklda",
        paragraphs: [
          "WeSetup’da ko‘rsatkichlar ombor devoridagi QR-kod orqali telefondan kiritiladi, vaqt avtomatik qo‘yiladi, me’yordan tashqari qiymat esa ajratib ko‘rsatiladi va choralarni yozishni talab qiladi. Xonada harorat va namlik datchigi bo‘lsa, yozuvlar o‘zi paydo bo‘ladi, rahbar esa oraliqdan chiqish haqida xabarnoma oladi. Tuzatishlar tarixda saqlanadi, jurnal bosma blanka shaklida PDF’ga yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `${KOAP} bunday yozuvlar yo‘qligi uchun alohida modda yo‘q. Ammo mahsulotni saqlash sharoitlari buzilishini tekshiruvchi sanitariya talablari va texnik reglament talablarining buzilishi deb baholaydi:`,
      items: finesList(FINE_6_6, FINE_6_3, FINE_14_43),
      note: NOTE,
    },
  },

  cold_equipment_control: {
    sample: {
      caption:
        "Sovutkich va muzlatkichlar bo‘yicha smenalik yozuvlar: me’yor, ertalabki va kechki ko‘rsatkichlar hamda harorat chegaradan chiqsa ko‘rilgan choralar. Solishtirish kamera ichidagi nazorat termometri bo‘yicha olib boriladi.",
      columns: ["Sana", "Uskuna", "Me’yor, °C", "Ertalab, °C", "Kechqurun, °C", "Og‘ishda ko‘rilgan choralar", "Mas’ul"],
      rows: [
        ["12.11.2026", "1-sovutkich shkafi, sut mahsulotlari", "+2…+6", "+4", "+5", "—", "Smirnova E. V."],
        ["12.11.2026", "2-sovutish kamerasi, sovutilgan go‘sht", "0…+4", "+2", "+3", "—", "Smirnova E. V."],
        ["12.11.2026", "3-muzlatkich sandiq", "−18 dan yuqori emas", "−20", "−19", "—", "Smirnova E. V."],
        ["12.11.2026", "Sovutkichli stol, sovuq sex", "+2…+6", "+5", "+9", "Eshik zichlagichi almashtirildi, mahsulotlar 1-shkafga o‘tkazildi; 20:30 da — +5", "Smirnova E. V., Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Sovutish uskunalari uchun kim javob beradi",
        paragraphs: [
          "Jurnal shakli SanPiN 2.3/2.4.4282-26 ning 2-ilovasida berilgan, shuning uchun uni tez buziladigan mahsulot saqlaydigan barcha korxonalar yuritadi: kafe, oshxonalar, maktab va shifoxonalarning oziq-ovqat bloklari, qandolatxonalar, kulinariya bo‘limi bor do‘konlar. Buyruq bilan mas’ul tayinlanadi — odatda bosh oshpaz, omborchi yoki smenaning katta oshpazi. U ko‘rsatkichlarni oladi va imzo qo‘yadi, ishlab chiqarish mudiri esa haftada bir marta yozuvlarni ko‘rib chiqadi.",
        ],
      },
      {
        heading: "Ko‘rsatkichlarni qanday to‘g‘ri olish kerak",
        bullets: [
          "Faqat tabloga emas, kamera ichidagi alohida termometrga qarash: o‘rnatilgan datchik bug‘latkich yonidagi havo haroratini ko‘rsatadi.",
          "Termometrni o‘rta tokchada saqlash — eshik yonida ham, devorga taqab ham emas.",
          "O‘lchovni ommaviy yuklashdan oldin va eshik ochilgandan so‘ng darhol emas, biroz kutib olish.",
          "Me’yorni kamerada saqlanadigan mahsulotga qarab ko‘rsatish: sovutilgan go‘sht uchun u sabzavotlarga qaraganda qat’iyroq.",
          "Har bir uskunaga korpusdagi stiker bilan bir xil raqam berish.",
        ],
      },
      {
        heading: "Harorat me’yordan chiqsa",
        paragraphs: [
          "Avval oddiy narsalar tekshiriladi: eshik yopiqmi, zichlagich butunmi, bug‘latkichni muz bosmaganmi, kamera iliq mahsulot bilan haddan tashqari to‘lmaganmi. Keyin mahsulot soz uskunaga o‘tkaziladi, servis xizmati chaqiriladi va o‘lchov takrorlanadi. Uzoq vaqt iliqda qolgan mahsulotlarni mas’ul shaxs baholaydi: ularni termik ishlovga yuborish yoki dalolatnoma bilan hisobdan chiqarish mumkin. Bularning barchasi choralar ustuniga qisqacha yoziladi — tekshiruvchi uchun ideal raqamlardan ko‘ra ko‘rilgan choralarni ko‘rish muhimroq.",
        ],
      },
      {
        heading: "Inspektor nimaga qaraydi",
        paragraphs: [
          "Tekshiruv paytidagi termometr ko‘rsatkichini oxirgi yozuv bilan solishtiradi, har bir sovutkichning jurnalda qatori borligini, termometrlarning esa qiyoslangan yoki kalibrlanganini tekshiradi. Haftalab bir xil qiymatlar va oshxona ishlagan bo‘lsa-da, dam olish kunlari yozuv yo‘qligi shubha uyg‘otadi.",
        ],
      },
      {
        heading: "Sovutkichlarni elektron nazorat qilish",
        paragraphs: [
          "WeSetup’da har bir sovutkichga QR-kod yopishtiriladi: oshpaz uni skanerlaydi va haroratni kiritadi, vaqt avtomatik qayd etiladi. Me’yordan tashqari qiymat darhol belgilanadi va tizim ko‘rilgan choralarni yozishni so‘raydi. Simsiz termometr ulangan bo‘lsa, ko‘rsatkichlar xodimlar ishtirokisiz keladi, og‘ishda esa rahbar xabarnoma oladi. O‘tkazib yuborilgan o‘lchovlar umumiy ko‘rinishda ko‘rinadi, PDF 2-ilova shaklida yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `Aynan to‘ldirilmagan jurnal uchun ${KOAP} jarima yo‘q, ammo yozuvlarsiz korxona tez buziladigan mahsulotlar kerakli haroratda saqlanganini isbotlay olmaydi. Tekshiruvchi sanitariya talablari va texnik reglament buzilganini qayd etadi:`,
      items: finesList(FINE_6_6, FINE_14_43, FINE_6_4),
      note: `${NOTE} Agar sovutkichda saqlash sharoiti buzilgan mahsulot topilsa, u jarimadan tashqari alohida olib qo‘yiladi.`,
    },
  },

  cleaning_ventilation_checklist: {
    sample: {
      caption:
        "Bir kunlik nazorat ro‘yxati: har bir xona bo‘yicha nam tozalash, yuzalarga ishlov berish va shamollatish vaqti, ijrochi va kim tekshirgani bilan belgilangan.",
      columns: ["Sana", "Xona", "Tartib", "Vaqt", "Ijrochi", "Nazorat"],
      rows: [
        ["16.11.2026", "Ovqatlanish zali", "Ochilishdan oldin shamollatish", "08:30–08:45", "Kozlova T. N.", "Ivanova M. P."],
        ["16.11.2026", "Ovqatlanish zali", "Polni nam tozalash, stollarga ishlov berish", "15:10–15:40", "Kozlova T. N.", "Ivanova M. P."],
        ["16.11.2026", "Xodimlar kiyim almashtirish xonasi", "Nam tozalash, shamollatish", "16:00–16:20", "Kozlova T. N.", "Ivanova M. P."],
        ["16.11.2026", "Sabzavot sexi", "Stollar va rakovinalarga ishlov berish, yalpi shamollatish", "17:30–17:50", "Belov I. S.", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Bu nazorat ro‘yxati kimlar uchun",
        paragraphs: [
          "U shamollatish shunchaki ochiq deraza emas, balki alohida majburiy tartib bo‘lgan joylarda kerak: maktab oshxonalari va bolalar bog‘chalarining oziq-ovqat bloklarida, ovqatlanish zallarida, xodimlarning kiyim almashtirish va maishiy xonalarida, doimiy kiritish-chiqarish ventilyatsiyasi bo‘lmagan sexlarda. SanPiN 2.3/2.4.4282-26 xonalarni toza saqlash va havo almashinuvini ta’minlashni talab qiladi, nazorat ro‘yxati esa bu jadval bo‘yicha bajarilayotganini ko‘rsatadi.",
          "Agar sizda tozalash jurnali allaqachon yuritilayotgan bo‘lsa, bu hujjat uni takrorlamaydi: unda kun davomidagi qisqa, takrorlanadigan tartiblar nazoratchi belgisi bilan jamlangan.",
        ],
      },
      {
        heading: "Tartiblar ro‘yxatini qanday tuzish kerak",
        bullets: [
          "Xonalarni, jumladan yordamchi xonalarni sanab chiqish: zal, kiyim almashtirish xonasi, xodimlar sanuzeli, tozalash inventari omborchasi.",
          "Har bir xona uchun tartib va vaqtni ko‘rsatish: ochilishdan oldin va tig‘iz soatlardan keyin shamollatish, smenadan keyin nam tozalash.",
          "Ijrochi va nazoratchini tayinlash — tekshiruv o‘z-o‘zini belgilashga aylanmasligi uchun ular turli odamlar bo‘lsin.",
          "Ro‘yxatni xona kirishiga osib qo‘yish — xodim nimani va qachon qilishini ko‘rib tursin.",
          "Derazasiz xonalar uchun havo almashinuvini ventilyatsiya ta’minlashini belgilab, uning yoqilganini tekshirib borish.",
        ],
      },
      {
        heading: "Tartib bajarilmagan bo‘lsa",
        paragraphs: [
          "O‘tkazib yuborilgan tartib bo‘yab yashirilmaydi va orqa sana bilan yozib qo‘yilmaydi. Nazoratchi tartib bajarilmaganini belgilaydi, sababini (xodim ishga chiqmagan, ta’mir tufayli deraza yopiq) va ish keyinroq qachon bajarilganini ko‘rsatadi. O‘tkazib yuborishlar takrorlansa, jadval yoki vazifalar taqsimoti o‘zgartiriladi — shunda tekshiruvchi qoidabuzarlik payqalgani va tuzatilganini ko‘radi.",
        ],
      },
      {
        heading: "Maktab va bolalar bog‘chalari uchun xususiyatlar",
        paragraphs: [
          "Ta’lim muassasalarida sanitariya rejimi tez-tez tekshiriladi va tekshiruvchi odatda shamollatish belgilarini ish tartibi bilan solishtiradi: ovqatlanish zalida bolalar bor paytda shamollatilmaydi, u guruhlar kelishidan oldin va ketganidan keyin o‘tkaziladi. Bu vaqt oraliqlarini nazorat ro‘yxati jadvaliga oldindan kiritib qo‘yish qulay.",
        ],
      },
      {
        heading: "Shamollatish nazorat ro‘yxati telefonda",
        paragraphs: [
          "WeSetup’da xodim tartibni xona eshigidagi QR-kod orqali belgilaydi, vaqt o‘zi yoziladi. Jadval sozlamalarda bir marta beriladi va belgi kerakli soatgacha paydo bo‘lmasa, xizmat eslatadi. Nazoratchi bajarilganini bir bosishda tasdiqlaydi, tuzatishlar tarixda ko‘rinadi, istalgan davr uchun varaq esa PDF’ga yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `${KOAP} nazorat ro‘yxati yo‘qligi uchun maxsus jarima yo‘q. Tekshiruvchi xonalarning sanitariya holatini baholaydi, yozuvlar esa tozalash va shamollatish muntazam o‘tkazilayotganini ko‘rsatishning yagona yo‘li:`,
      items: finesList(FINE_6_6, FINE_6_4),
      note: NOTE,
    },
  },

  general_cleaning: {
    sample: {
      caption:
        "Noyabr jadvali: har bir uchastka uchun umumiy tozalashning rejadagi va haqiqiy sanasi, ijrochi va qabul qilingani haqida belgi. Ko‘chirish darhol ko‘rinadi, sababi o‘sha qatorning o‘zida yozilgan.",
      columns: ["Uchastka", "Rejadagi sana", "Haqiqiy sana", "Vosita, konsentratsiya", "Ijrochi", "Qabul qildi"],
      rows: [
        ["Issiq sex", "02.11.2026", "02.11.2026", "Nika-Xlor, 0,1 %", "Smirnova E. V.", "Ivanova M. P."],
        ["Sovuq sex", "09.11.2026", "09.11.2026", "Nika-Xlor, 0,1 %", "Kozlov A. A.", "Ivanova M. P."],
        ["Ombor va sovutish kameralari", "16.11.2026", "17.11.2026 (ko‘chirildi: tovar qabuli)", "Deo-Xlor, 0,05 %", "Kozlov A. A.", "Ivanova M. P."],
        ["Yuvish xonasi", "23.11.2026", "", "", "Smirnova E. V.", ""],
        ["Ovqatlanish zali", "30.11.2026", "", "", "Belov I. S.", ""],
      ],
    },
    sections: [
      {
        heading: "Umumiy tozalash jadvali tozalash jurnalidan nimasi bilan farq qiladi",
        paragraphs: [
          "Tozalash jurnali kundalik joriy ishlarni qayd etadi. Umumiy tozalash jadvali esa rejalashtirish hujjati: bir oy oldindan qaysi uchastka qachon to‘liq tozalanishi yozib qo‘yiladi, tozalashdan keyin esa reja yoniga haqiqiy sana va ishni qabul qilgan shaxsning imzosi qo‘yiladi. Rospotrebnadzor inspektori aynan rejani haqiqat bilan solishtiradi, shuning uchun jadvalsiz umumiy tozalashlar davriyligini isbotlash qiyin.",
        ],
      },
      {
        heading: "Bir oylik jadvalni qanday tuzish kerak",
        bullets: [
          "Korxonani uchastkalarga bo‘lish: sexlar, yuvish xonalari, omborlar, sovutish kameralari, zal, maishiy xonalar.",
          "Sanalarni bir kunda butun ishlab chiqarish jarayoni to‘xtab qolmaydigan qilib taqsimlash.",
          "Ijrochi va ishni qabul qiluvchini — ishlab chiqarish mudiri yoki bosh oshpazni ko‘rsatish.",
          "Har bir uchastka uchun vosita va konsentratsiyani uning yo‘riqnomasi bo‘yicha oldindan belgilash.",
          "Jadvalni oy boshlanishidan oldin rahbar imzosi bilan tasdiqlash.",
          "Alohida obyektlarni hisobga olish: bolalar va tibbiyot muassasalarining oziq-ovqat bloklarida umumiy tozalash oddiy kafega qaraganda tez-tez o‘tkaziladi — davriylik ishlab chiqarish nazorati dasturida mustahkamlanadi.",
        ],
      },
      {
        heading: "Umumiy tozalashga nimalar kiradi",
        paragraphs: [
          "Devorlarni butun balandligi bo‘yicha, eshiklar, derazalar va deraza tokchalarini, yoritgichlar va shiftlarni yuvish; ventilyatsiya panjaralari va so‘rg‘ich soyabonlarini tozalash; uskunalarni tashqi tomondan, iloji bo‘lsa surib qo‘yib yuvish; sovutkichlarni eritib, yuvish; oxirida — yuzalarni dezinfeksiya qilish. Tozalash vaqtida mahsulotlar va toza idishlar olib qo‘yiladi yoki yopib qo‘yiladi.",
        ],
      },
      {
        heading: "Qabul qilish va ko‘chirishlar",
        paragraphs: [
          "Mas’ul shaxs tozalashdan keyin uchastkani ko‘zdan kechiradi va shundan keyingina imzo qo‘yadi. Ish to‘liq bajarilmagan bo‘lsa, u qabul qilinmaydi, nimani tugatish kerakligi ko‘rsatiladi. Sanani ko‘chirish mumkin, ammo sababi va yangi sana o‘sha qatorga yoziladi: izohsiz bo‘sh qolgan haqiqiy sana — tekshiruvdagi tez-tez uchraydigan e’tiroz.",
          "Qabul qilishda joriy tozalashda ko‘rinmaydigan joylarga qarash foydali: uskunalar orqasi, so‘rg‘ich tepasi, stellajlar osti, sovutish kamerasidagi bug‘latkich atrofi.",
        ],
      },
      {
        heading: "Qog‘oz o‘rniga elektron jadval",
        paragraphs: [
          "WeSetup’da bir oylik jadval bir necha bosishda tuziladi, sanadan bir kun oldin ijrochi Telegram’da eslatma oladi. Bajarilganini u uchastkadagi QR-kod orqali telefondan belgilaydi, vaqt avtomatik qayd etiladi, mas’ul shaxs esa qabulni o‘z vazifalar ro‘yxatida tasdiqlaydi. Muddati o‘tgan tozalashlar ajratib ko‘rsatiladi, ko‘chirishlar tarixi saqlanadi, reja va haqiqat esa bitta jadval ko‘rinishida PDF’ga yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `${KOAP} jadval yo‘qligi uchun alohida jarima yo‘q. Umumiy tozalashlar o‘tkazilayotganining tasdig‘i bo‘lmasa, tekshiruvchi xonalarni saqlash va ovqatlanishni tashkil etishga doir sanitariya talablari buzilganini qayd etadi:`,
      items: finesList(FINE_6_6, FINE_6_4),
      note: NOTE,
    },
  },

  uv_lamp_runtime: {
    sample: {
      caption:
        "Bitta nurlatgich bo‘yicha yozuvlar: har bir yoqish davomiyligi bilan va soatlarning yig‘ma jami — undan lampani almashtirishgacha qancha resurs qolgani ko‘rinadi.",
      columns: ["Sana", "Xona / nurlatgich", "Yoqildi", "O‘chirildi", "Ishlash vaqti", "Boshidan beri ishlagan, soat", "Mas’ul"],
      rows: [
        ["13.11.2026", "Sovuq sex, 1-retsirkulyator", "07:00", "09:00", "2 soat", "6 412", "Belov I. S."],
        ["13.11.2026", "Sovuq sex, 1-retsirkulyator", "13:00", "15:00", "2 soat", "6 414", "Belov I. S."],
        ["14.11.2026", "Sovuq sex, 1-retsirkulyator", "07:00", "09:00", "2 soat", "6 416", "Belov I. S."],
        ["14.11.2026", "Qandolatchilik sexi, 2-ochiq turdagi nurlatgich", "21:00", "21:30", "30 daq", "3 105", "Melnikova O. G."],
      ],
    },
    sections: [
      {
        heading: "Bakteritsid nurlatgichlar qayerda qo‘llaniladi",
        paragraphs: [
          "Nurlatgichlar sovuq sexlarda, qandolatchilik va tayyor mahsulot sexlarida, porsiyalash va qadoqlash xonalarida, oziq-ovqat bloklari qoshidagi tibbiyot kabinetlarida ishlatiladi. Havoni zararsizlantirishga doir talablar SP 3.1.3597-20 da, qurilmalarning o‘ziga doir talablar esa GOST R 59527-2021 da belgilangan. Hisob har bir nurlatgich uchun alohida yuritiladi.",
        ],
      },
      {
        heading: "Ochiq nurlatgichlar va retsirkulyatorlar — hisobdagi farqi",
        bullets: [
          "Ochiq turdagi nurlatgich faqat odamlar yo‘qligida yoqiladi; qatorda vaqt muhim — sexda hech kim bo‘lmagani ko‘rinib tursin.",
          "Retsirkulyator (yopiq turdagi) odamlar bor paytda ishlaydi, rejimini ishlab chiqaruvchi yo‘riqnomasi belgilaydi.",
          "Ishlagan soatlar korpus bo‘yicha emas, lampa bo‘yicha hisoblanadi: lampa almashtirilgach, hisob qaytadan boshlanadi.",
          "Sarlavhada buyum pasportidagi model, quvvat va lampa resursi ko‘rsatiladi.",
          "Nurlatgich ta’mirlangani yoki uzoq vaqt ishlamay turgani ham yoziladi — hisobdagi tanaffus izohli bo‘lsin.",
        ],
      },
      {
        heading: "Lampalarni almashtirish va utilizatsiya qilish",
        paragraphs: [
          "Ishlagan soatlar resursga yaqinlashganda, lampa hali yonib turgan bo‘lsa ham almashtiriladi: bakteritsid nurlanish ko‘rinadigan yorug‘likdan oldinroq pasayadi. Almashtirish sanasi va yangi lampa raqami jurnalga yoziladi. Ishlatilgan simobli lampalarni umumiy chiqindi bilan tashlab bo‘lmaydi — ular yopiq idishda saqlanadi va shartnoma asosida ixtisoslashgan tashkilotga topshiriladi, topshirish dalolatnomalari saqlab qo‘yiladi.",
        ],
      },
      {
        heading: "Joyida nimalar tekshiriladi",
        paragraphs: [
          "Inspektor ishlagan soatlarni pasportdagi resurs bilan solishtiradi, ochiq nurlatgich xodimlar ishlayotgan paytda yoqilmayaptimi, qaraydi va almashtirilgan lampalarni utilizatsiya qilish hujjatlarini so‘raydi. Tez-tez uchraydigan xato — jurnal yuritiladi, ammo soatlar jamlanmaydi, shuning uchun lampani qachon almashtirishni hech kim bilmaydi. Nurlatgich pasporti va foydalanish yo‘riqnomasi jurnal yonida saqlanadi — ularni ko‘pincha ko‘rsatishni so‘rashadi.",
        ],
      },
      {
        heading: "Ishlagan soatlar hisobi kalkulyatorsiz",
        paragraphs: [
          "WeSetup’da xodim yoqish va o‘chirishni nurlatgichdagi QR-kod orqali telefondan belgilaydi, vaqt avtomatik qo‘yiladi, boshidan beri ishlagan soatlar esa o‘zi jamlanadi. Lampa resursga yaqinlashganda mas’ul shaxs Telegram’da xabarnoma oladi. Almashtirish alohida yozuv bilan belgilanadi, tarix saqlanadi, jurnal tekshiruv uchun PDF’ga yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `Ishlagan soatlar hisobi yo‘qligi uchun ${KOAP} to‘g‘ridan-to‘g‘ri jarima yo‘q. Xavf oqibatlarda: samarasiz zararsizlantirish sanitariya talablarini buzish, simobli lampalarni maishiy chiqindi bilan tashlash esa chiqindilar bilan muomala qilish qoidalarini buzish deb baholanadi:`,
      items: finesList(FINE_6_3, FINE_6_4, FINE_8_2),
      note: NOTE,
    },
  },

  disinfectant_usage: {
    sample: {
      caption:
        "Vositalarning kirimi va sarfi haqidagi yozuvlar: hujjatlari bilan partiya, ishchi eritmalarni konsentratsiyasi bilan tayyorlash va har bir berishdan keyingi qoldiq.",
      columns: ["Sana", "Vosita", "Amal", "Miqdor", "Konsentratsiya, maqsad", "Qoldiq", "Mas’ul"],
      rows: [
        ["05.11.2026", "Nika-Xlor, tabletkalar", "Kirim, 0926-partiya, yo‘riqnoma va ro‘yxatdan o‘tkazish hujjatlari bor", "300 donadan 3 banka", "—", "900 dona", "Ivanova M. P."],
        ["06.11.2026", "Nika-Xlor, tabletkalar", "Eritma tayyorlandi", "10 l ga 7 dona (yo‘riqnoma bo‘yicha)", "0,1 %, issiq sex yuzalari", "893 dona", "Smirnova E. V."],
        ["06.11.2026", "Nika-Ekstra M", "Eritma tayyorlandi", "10 l ga 100 ml", "1 %, yuvish xonasining pollari va devorlari", "4,9 l", "Kozlov A. A."],
        ["07.11.2026", "Septolit-Profi, qo‘l uchun antiseptik", "Uchastkaga berildi", "1 l", "Tayyor, sex kirishi", "3 l", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Muntazam sotib olinsa ham, dezinfeksiya vositalarini nega hisobga olish kerak",
        paragraphs: [
          "SanPiN 2.3/2.4.4282-26 yuvish va dezinfeksiya vositalarini yo‘riqnoma bo‘yicha qo‘llashni va ularni mahsulotlardan alohida saqlashni talab qiladi. Kirim va sarf hisobi vositalar barcha tozalashlarga yetishini, faqat ro‘yxatdan o‘tgan preparatlar ishlatilishini va xodimlar eritmalarni to‘g‘ri konsentratsiyada tayyorlashini ko‘rsatadi. Agar tozalash jurnalida oyiga 20 ta dezinfeksiya yozilgan bo‘lsa-yu, vosita uchtasiga yetadigan miqdorda sarflangan bo‘lsa, tekshiruvchi buni payqaydi.",
        ],
      },
      {
        heading: "Qabul qilish va saqlash tartibi",
        bullets: [
          "Qabulda qo‘llash yo‘riqnomasi, davlat ro‘yxatidan o‘tkazilganlik hujjatlari va yaroqlilik muddatini tekshirish; partiya raqamini yozib qo‘yish.",
          "Alohida qulflanadigan shkaf yoki xonada, ishlab chiqaruvchining asl idishida saqlash.",
          "Ishchi eritmali idishlarga yorliq yopishtirish: nomi, konsentratsiyasi, tayyorlangan sanasi, eritmaning yaroqlilik muddati.",
          "Konsentratlarga faqat o‘qitilgan, mehnatni muhofaza qilish bo‘yicha yo‘riqnomadan o‘tgan va himoya vositalari bilan ta’minlangan xodimlarni qo‘yish.",
          "Eritma tayyorlashdan oldin konsentratning yaroqlilik muddati va qadog‘i butunligini tekshirish.",
        ],
      },
      {
        heading: "Ishchi eritmalarni qanday tayyorlash kerak",
        paragraphs: [
          "Konsentratsiya va ta’sir qilish vaqti aniq obyekt uchun ishlab chiqaruvchi yo‘riqnomasidan olinadi: idishlar, yuzalar, sanitariya-texnik jihozlar, qo‘llar. Eritmalar alohida xona yoki hududda, qo‘lqop, ko‘zoynak va fartukda, ventilyatsiya ishlab turganda tayyorlanadi. Suyultirish jadvalini tayyorlash joyi yonidagi devorga osib qo‘ygan ma’qul: shunda «chamalab» qilinadigan xatolar kamayadi.",
        ],
      },
      {
        heading: "Odatiy qoidabuzarliklar",
        bullets: [
          "Qo‘llash yo‘riqnomasi yo‘q yoki yaroqlilik muddati o‘tgan vosita.",
          "Yorliqsiz, ichimlik shishasiga solingan eritma.",
          "Dezinfeksiya vositalari mahsulotlar bilan bir tokchada saqlanadi.",
          "Xodim o‘zi tayyorlayotgan eritmaning konsentratsiyasini ayta olmaydi.",
        ],
      },
      {
        heading: "WeSetup’da qoldiq va sarf",
        paragraphs: [
          "WeSetup’da kirim bir marta kiritiladi, qoldiq esa har bir sarf yozuvidan keyin qayta hisoblanadi. Xodim eritma tayyorlaganini telefondan belgilaydi, vaqt va ijrochi avtomatik qayd etiladi. Rahbar vosita qachon tugashini ko‘radi, jurnal esa ishlatilayotgan vositalar ro‘yxati bilan birga PDF’ga yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `${KOAP} bunday hisob yo‘qligi uchun alohida modda yo‘q. Ammo ro‘yxatdan o‘tmagan vositalardan foydalanish, noto‘g‘ri konsentratsiya yoki mahsulotlar yonida saqlashni tekshiruvchi sanitariya talablarini buzish, konsentratlar bilan himoya vositalarisiz ishlashni esa mehnatni muhofaza qilish talablarini buzish deb baholaydi:`,
      items: finesList(FINE_6_6, FINE_6_3, FINE_5_27_1),
      note: NOTE,
    },
  },

  sanitary_day_control: {
    sample: {
      caption:
        "Bitta sanitariya kunining nazorat ro‘yxati: har bir band ijrochi va bajarilgani haqidagi belgi bilan. Bajarilmagan band sababi va muddati ko‘rsatilgan holda ko‘chirilgan.",
      columns: ["Sana", "Tartib", "Uchastka", "Ijrochi", "Bajarildi", "Tekshirdi"],
      rows: [
        ["27.11.2026", "Sovutkichlarni eritish va yuvish", "Sovuq sex, ombor", "Kozlov A. A.", "Ha", "Ivanova M. P."],
        ["27.11.2026", "Devorlar, eshiklar va yoritgichlarni yuvish", "Issiq sex", "Smirnova E. V.", "Ha", "Ivanova M. P."],
        ["27.11.2026", "So‘rg‘ich soyabonlari va filtrlarini tozalash", "Issiq sex", "«VentServis» MChJ, 211-dalolatnoma", "Ha", "Ivanova M. P."],
        ["27.11.2026", "Tozalash inventari va markirovkasini qayta ko‘rib chiqish", "Inventar omborchasi", "Belov I. S.", "Ha", "Ivanova M. P."],
        ["27.11.2026", "Derazalarni tashqaridan yuvish", "Ovqatlanish zali", "Belov I. S.", "Yo‘q — yomg‘ir, 30.11 ga ko‘chirildi", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Sanitariya kuni umumiy tozalashdan nimasi bilan farq qiladi",
        paragraphs: [
          "Umumiy tozalash uchastkalar bo‘yicha o‘tadi va butun korxona ishini to‘xtatmaydi. Sanitariya kuni esa to‘xtash demak: mahsulotlar va idishlar olib qo‘yiladi, ishlar barcha hududlarda bir vaqtda olib boriladi, bundan tashqari oddiy smenalarda qo‘l yetmaydigan vazifalar hal qilinadi — inventarni qayta ko‘rib chiqish, so‘rg‘ichni tozalash, markirovkani tekshirish, mayda ta’mir. Nazorat ro‘yxati hech narsa tushib qolmasligi uchun har bir bandni qayd etadi.",
        ],
      },
      {
        heading: "Sanitariya kunini qanday tayyorlash kerak",
        bullets: [
          "Bir hafta oldin sanani tasdiqlash va zal yopiq bo‘lsa, mehmonlarni ogohlantirish.",
          "Dezinfeksiya vositalari va tozalash inventari yetishini tekshirish.",
          "Pudratchilar bilan vaqtni kelishish: ventilyatsiyani tozalash, hasharot va kemiruvchilarga qarshi ishlov, sovutkichlar servisi.",
          "Nazorat ro‘yxati bandlarini ijrochilarga har biriga tushunarli ish hajmi tegadigan qilib taqsimlash.",
          "Tozalash vaqtida mahsulotlar ko‘chiriladigan joyni va ko‘chirib bo‘lmaydigan narsalarni yopish uchun plyonkani tayyorlash.",
          "Kun oxirida barcha uchastkalarni aylanib chiqadigan bitta tekshiruvchini tayinlash.",
        ],
      },
      {
        heading: "Band bajarilmagan bo‘lsa",
        paragraphs: [
          "Nazorat ro‘yxatining qadri — haqiqatni ko‘rsatishida. Bandni bajarishning iloji bo‘lmasa, bu sababi va yangi sanasi bilan belgilanadi, keyin esa haqiqatda bajarilgani haqida belgi qo‘yiladi. Rospotrebnadzor tekshiruvchisi barcha bandlari yopilgan-u, so‘rg‘ich soyaboni yog‘ bosgan varaqdan ko‘ra izohli ko‘chirishni osonroq qabul qiladi.",
        ],
      },
      {
        heading: "Turli muassasalar uchun xususiyatlar",
        paragraphs: [
          "Maktab va bolalar oziq-ovqat bloklarida sanitariya kuni dam olish kunlari yoki ta’tilga qo‘yiladi, kecha-kunduz ishlaydigan muassasalarda esa hududlar bo‘yicha bir necha kechaga bo‘linadi. Ishlab chiqarishda unga odatda liniyalarni qismlarga ajratib yuvish va dezinfeksiya qilish kiradi, uskunalar bo‘yicha belgilar esa yuvish jurnalida takrorlanadi. Sanitariya holatiga doir talablar SanPiN 2.3/2.4.4282-26 va ishlab chiqarish nazorati dasturidan olinadi.",
        ],
      },
      {
        heading: "Shablon bo‘yicha sanitariya kuni",
        paragraphs: [
          "WeSetup’da tartiblar ro‘yxati tashkilot shabloni sifatida saqlanadi va har bir yangi sanitariya kuniga qo‘yiladi. Ijrochilar o‘z bandlarini telefonga oladi va bajarilganini joyida belgilaydi, vaqt avtomatik qayd etiladi. Tekshiruvchi yopilmagan bandlarni real vaqtda ko‘radi, pudratchilar dalolatnomalari qatorga biriktiriladi, yakun PDF’ga yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `Nazorat ro‘yxatining o‘zi yo‘qligi uchun ${KOAP} jarima yo‘q. Biroq e’tiborsiz qolgan sanitariya izlarini — so‘rg‘ichdagi yog‘, iflos sovutkichlar, nosoz inventar — tekshiruvchi sanitariya talablarining buzilishi sifatida qayd etadi:`,
      items: finesList(FINE_6_6, FINE_6_4),
      note: NOTE,
    },
  },

  equipment_cleaning: {
    sample: {
      caption:
        "Smena davomida uskunalarni yuvish va dezinfeksiya qilish yozuvlari: qaysi uskuna, qanday tartibda, qaysi vosita bilan va qanday konsentratsiyada, kim bajargani va kim tekshirgani.",
      columns: ["Sana, vaqt", "Uskuna", "Tartib", "Vosita, konsentratsiya, ta’sir vaqti", "Ijrochi", "Tekshirdi"],
      rows: [
        ["18.11.2026, 14:30", "MIM-300 go‘sht maydalagich", "Qismlarga ajratish, yuvish, dezinfeksiya, quritish, yig‘ish", "Nika-Xlor, 0,1 %, 15 daq", "Smirnova E. V.", "Ivanova M. P."],
        ["18.11.2026, 15:10", "Slayser, sovuq sex", "Qismlarga ajratish, pichoq va karetkani yuvish, dezinfeksiya qilish", "Nika-Ekstra M, 0,5 %, 15 daq", "Kozlov A. A.", "Ivanova M. P."],
        ["18.11.2026, 16:00", "Xamir qorgich, qandolatchilik sexi", "Xamir idishi va ilgakni yuvish, chayish", "Ishqoriy yuvish vositasi, 1 %", "Melnikova O. G.", "Ivanova M. P."],
        ["18.11.2026, 22:00", "Parokonvektomat", "Avtoyuvish dasturi", "Avtoyuvish tabletkalari, yo‘riqnoma bo‘yicha", "Belov I. S.", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Uskunalar nega xonalardan alohida hisobga olinadi",
        paragraphs: [
          "Go‘sht maydalagich, slayser yoki xamir qorgich mahsulot bilan bevosita aloqada bo‘ladi, qismlarda qolgan qiyma yoki krem qoldiqlari esa mikrobiologik ifloslanishga to‘g‘ridan-to‘g‘ri yo‘l. Shuning uchun uskunalar uchun tartib yuzalarni tozalashdan qat’iyroq: qismlarga ajratish, har bir detalni yuvish, ta’sir vaqtiga rioya qilib dezinfeksiya qilish va quritish majburiy. SanPiN 2.3/2.4.4282-26 uskunalarni yo‘riqnomalar bo‘yicha yuvish va dezinfeksiya qilishni, HACCP dasturi esa buni yozuvlar bilan tasdiqlashni talab qiladi.",
        ],
      },
      {
        heading: "Yuvish ketma-ketligi",
        bullets: [
          "Uskunani tarmoqdan uzish va ishlab chiqaruvchi yo‘riqnomasi bo‘yicha qismlarga ajratish.",
          "Mahsulot qoldiqlarini olib tashlash, detallarni yuvish vositasi qo‘shilgan issiq suvda yuvish.",
          "Chayish va ko‘rsatilgan ta’sir vaqti bilan dezinfeksiya eritmasida ishlov berish.",
          "Agar vosita yo‘riqnomasi talab qilsa, ichimlik suvi bilan chayish.",
          "Detallarni quritish va uskunani toza qo‘l bilan yoki qo‘lqopda yig‘ish.",
        ],
      },
      {
        heading: "Turli uskunalarni qanchalik tez-tez yuvish kerak",
        paragraphs: [
          "Davriylik mahsulotga bog‘liq: xom go‘sht va baliq uchun uskunalar har safar ishlatilgandan keyin va smena oxirida, tayyor mahsulot uchun esa mahsulot turi almashganda ham yuviladi. Parokonvektomatlar va pechlar odatda kun oxirida o‘rnatilgan dastur bo‘yicha yuviladi. Jadvallarni ishlab chiqarish nazorati dasturida mustahkamlab, har bir uskuna turi yoniga chop etib qo‘yish qulay.",
        ],
      },
      {
        heading: "Inspektor nimani payqaydi",
        bullets: [
          "Ko‘zdan kechirishda go‘sht maydalagich qismlarida yoki slayser pichog‘i ostida mahsulot qoldiqlari.",
          "Xom va tayyor mahsulot uchun ishlatiladigan uskunaga kuniga bitta yozuv.",
          "Vosita va konsentratsiya ko‘rsatilmagan yoki ular yo‘riqnomaga mos kelmaydi.",
          "Tekshirgan shaxsning imzosi yo‘q — demak, nazorat o‘tkazilmagan.",
          "Qismlarga ajratilgan detallar polda yoki xomashyo yonidagi yuvilmagan stolda quritiladi.",
        ],
      },
      {
        heading: "Yuvish belgilari telefondan",
        paragraphs: [
          "WeSetup’da har bir uskuna turi uchun o‘z davriyligi va tartibi sozlanadi. Oshpaz korpusdagi QR-kodni skanerlaydi, yuvishni belgilaydi va vositani ro‘yxatdan tanlaydi — konsentratsiya o‘zi qo‘yiladi, vaqt avtomatik yoziladi. O‘tkazib yuborilgan yuvishlar rahbarga ko‘rinadi, tuzatishlar tarixda saqlanadi, jurnal PDF’ga yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `Uskunalarni yuvish yozuvlari yo‘qligi uchun ${KOAP} maxsus modda yo‘q. Agar uskuna iflos bo‘lsa yoki dezinfeksiya qilinmasa, tekshiruvchi sanitariya talablari va texnik reglamentning ishlab chiqarish jarayonlariga doir talablari buzilganini qayd etadi:`,
      items: finesList(FINE_6_6, FINE_6_4, FINE_14_43),
      note: NOTE,
    },
  },

  intensive_cooling: {
    sample: {
      caption:
        "Sovutish partiyalari bo‘yicha yozuvlar: taom va hajmi, boshida va oxirida harorat va vaqt, sovutish usuli va mas’ul. Oxirgi qatorda sovutish me’yorga sig‘magan — partiya bilan nima qilingani ko‘rsatilgan.",
      columns: ["Sana", "Taom, hajm", "Boshlanishi: vaqt, °C", "Tugashi: vaqt, °C", "Usul", "Natija", "Mas’ul"],
      rows: [
        ["19.11.2026", "Palov, 12 kg", "11:05, +72", "11:55, +4", "Shok sovutish shkafi", "Me’yorda", "Kozlov A. A."],
        ["19.11.2026", "Tovuq sho‘rvasi, 20 l", "13:20, +85", "14:30, +5", "Shok sovutish shkafi, 5 l li gastroyemkostlar", "Me’yorda", "Kozlov A. A."],
        ["19.11.2026", "Qiyma kotletlar, 120 dona", "15:00, +70", "15:50, +3", "Shok sovutish shkafi", "Me’yorda", "Smirnova E. V."],
        ["20.11.2026", "Beshamel sousi, 6 l", "10:40, +78", "13:10, +14", "Sovutish kamerasi", "Sig‘madi — partiya hisobdan chiqarildi, 37-dalolatnoma", "Smirnova E. V., Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Sovutish nazorati qachon kerak",
        paragraphs: [
          "Hisobni oldindan tayyorlab, issiq taomlarni saqlash uchun sovutadigan barcha korxonalar yuritadi: yarim tayyor mahsulot va tayyor ovqat ishlab chiqarishlari, keytering, oshxona-fabrikalar, ertangi kun uchun tayyorlov qiladigan restoranlar, cook-chill texnologiyasi bo‘yicha ishlaydigan oziq-ovqat bloklari. Tez sovutish odatda HACCP rejasidagi kritik nazorat nuqtasi bo‘lib, muddat va haroratlar taomning texnologik hujjatlarida belgilanadi. Jarayonlar xavfsizligiga doir umumiy talablar SanPiN 2.3/2.4.4282-26 da berilgan.",
        ],
      },
      {
        heading: "Me’yorga sig‘ish uchun qanday sovutish kerak",
        bullets: [
          "Mahsulotni katta qozonda sovutmasdan, sayoz gastroyemkostlarga bir necha santimetr qatlam qilib yoyish.",
          "Sovutish tugaguncha idishlarni zich yopmaslik.",
          "Issiq taomni boshqa mahsulotlar turgan oddiy sovutkichga qo‘ymaslik — u uddalay olmaydi va yonidagi mahsulotlarni isitadi.",
          "Haroratni yuzada emas, mahsulot markazida zondli termometr bilan o‘lchash.",
          "Boshlanish vaqtini idish shkafga qo‘yilishi bilanoq yozish.",
        ],
      },
      {
        heading: "Taom o‘z vaqtida sovumasa",
        paragraphs: [
          "Bunday partiya nomuvofiq hisoblanadi. Qarorni HACCP rejasi bo‘yicha mas’ul shaxs qabul qiladi: taom dalolatnoma bilan hisobdan chiqariladi yoki, texnologiya ruxsat bersa, qayta qizdirilib darhol tarqatishga beriladi. Uni saqlash mumkin emas. Sabab uskunadan (shkaf haddan tashqari yuklangan, nosozlik) yoki texnologiya buzilishidan qidiriladi va natija ustuniga nima qilingani yoziladi.",
        ],
      },
      {
        heading: "Tekshiruvda ko‘rinadigan xatolar",
        bullets: [
          "Barcha partiyalarda boshlanish va tugash vaqti bir xil — yozuvlar aniq shablon bo‘yicha qilingan.",
          "Zondli termometr yo‘q yoki u tekshiruvdan o‘tmagan.",
          "Vaqt yozuvlarisiz oddiy kamerada sovutish.",
          "Me’yorga sig‘magan partiya bilan nima qilingani ko‘rsatilmagan.",
        ],
      },
      {
        heading: "WeSetup’da sovutish nazorati",
        paragraphs: [
          "Oshpaz partiyani shkafga yuklash paytida telefondan kiritadi, boshlanish vaqti avtomatik qo‘yiladi, kerakli muddatga esa o‘lchov qilish haqida eslatma keladi. Yakuniy harorat yoki vaqt me’yordan tashqarida bo‘lsa, tizim partiya bo‘yicha qarorni ko‘rsatishni talab qiladi. Shok shkafida simsiz termometr bo‘lsa, sovutish datchik ma’lumotlari bilan tasdiqlanadi. Jurnal PDF’ga yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `Yozuvlar yo‘qligi uchun ${KOAP} alohida jarima yo‘q, ammo tez sovutish TR TS 021/2011 tartibga soladigan ishlab chiqarish jarayonlariga kiradi. Rejim buzilishi va bunday mahsulotni chiqarishni tekshiruvchi quyidagicha baholaydi:`,
      items: finesList(FINE_14_43, FINE_6_6, FINE_14_4),
      note: NOTE,
    },
  },

  transport_temperature: {
    sample: {
      caption:
        "Qatnovlar bo‘yicha yozuvlar: transport, yo‘nalish, mahsulot, yuklash va tushirishdagi harorat. Ikki o‘lchovdan sovuq yoki issiq zanjir saqlanganmi-yo‘qmi, ko‘rinadi.",
      columns: ["Sana", "Transport, yo‘nalish", "Mahsulot", "Yuklash: vaqt, °C", "Tushirish: vaqt, °C", "Mas’ul"],
      rows: [
        ["17.11.2026", "Gazel A123BV, 5-maktab", "Termokonteynerlardagi tushliklar", "11:10, +78", "11:40, +71", "Petrov S. A."],
        ["17.11.2026", "Gazel A123BV, «Solnishko» bolalar bog‘chasi", "Sut mahsulotlari", "07:20, +3", "07:55, +5", "Petrov S. A."],
        ["18.11.2026", "Refrijerator E456KM, Lesnaya ko‘chasidagi kafe", "Muzlatilgan yarim tayyor mahsulotlar", "06:30, −20", "07:45, −18", "Nikolayev D. V."],
        ["18.11.2026", "Gazel A123BV, «Severniy» ofisi", "Salat va gazaklar, keytering", "10:00, +4", "11:15, +8", "Petrov S. A., e’tiroz bilan qabul qilindi, salatlar qaytarildi"],
      ],
    },
    sections: [
      {
        heading: "Tashish vaqtidagi harorat hisobi kimga kerak",
        paragraphs: [
          "Yozuvlarni mahsulotni o‘zi tashiydigan korxonalar yuritadi: maktab ovqatlanishi kombinatlari, keytering, tayyor ovqat yetkazib berish, mahsulotni o‘z nuqtalariga tarqatadigan ishlab chiqarishlar, tarmoqlarning markaziy oshxonalari. TR TS 021/2011 tashishda ishlab chiqaruvchi belgilagan sharoitlarga rioya qilinishini, transport va idish esa mahsulotni yomonlashtirmasligini talab qiladi. Agar mahsulotni yetkazib beruvchi olib kelsa, harorat qabul paytida kirish nazorati jurnalida qayd etiladi.",
        ],
      },
      {
        heading: "O‘lchovlarni qanday tashkil etish kerak",
        bullets: [
          "Yuklashdan oldin kuzov tozaligini tekshirish va refrijeratorni rejimga chiqishi uchun oldindan yoqish.",
          "Faqat kuzovdagi havoni emas, mahsulot haroratini o‘lchash: nazorat birligida zondli termometr bilan yoki logger ko‘rsatkichlari bo‘yicha.",
          "Ikkinchi o‘lchovni qabul qiluvchi huzurida, tushirish paytida olish.",
          "Issiq taomlarni termokonteynerlarda, sovuq va issiq taomlarni alohida tashish.",
          "Mahsulotga tegadigan haydovchi yoki ekspeditorda shaxsiy tibbiy daftarcha bo‘lishi shart.",
        ],
      },
      {
        heading: "Mahsulot harorat buzilgan holda yetib kelsa",
        paragraphs: [
          "Qabul qiluvchi partiyani qabul qilmaslikka haqli. Og‘ish haqiqiy qiymati bilan yoziladi, mahsulot qaytariladi yoki mas’ul shaxs qaroriga qadar ajratib qo‘yiladi, sababi esa aniqlanadi: uzoq yo‘nalish, sovutish qurilmasining buzilishi, oldindan sovutilmagan mahsulotni yuklash. Takroriy holatlarda yo‘nalish yoki bir qatnovdagi nuqtalar soni o‘zgartiriladi va konteynerlarga sovuq akkumulyatorlari qo‘shiladi.",
        ],
      },
      {
        heading: "Maktab ovqatlanishi va keyteringning xususiyatlari",
        paragraphs: [
          "Maktab va bolalar bog‘chalariga tushlik yetkazishda tekshiruvchilar yo‘ldagi vaqtga va qabul qiluvchidagi issiq taomlar haroratiga e’tibor beradi, shuning uchun tushirishni qabul qiluvchi tomon imzolaydi. Keyteringda vaqt zaxirasi muhim: salat va desertlar oxirida yuklansa, haroratini eng uzoq saqlaydi. Termokonteynerlar va kuzov qatnovdan keyin yuviladi va ishlov beriladi, xomashyo va tayyor mahsulot uchun esa turli idishlar ishlatiladi — tekshiruvchi buning qanday tashkil etilganini so‘rashi mumkin.",
        ],
      },
      {
        heading: "Qatnov yozuvlari haydovchi telefonidan",
        paragraphs: [
          "WeSetup’da haydovchi yoki ekspeditor yuklash va tushirishdagi haroratni telefondan kiritadi, vaqt avtomatik qayd etiladi, yo‘nalish va mashina ro‘yxatdan tanlanadi. Og‘ish ajratib ko‘rsatiladi va ko‘rilgan chorani yozishni talab qiladi. Rahbar kunning barcha qatnovlarini bitta jadvalda ko‘radi, jurnal esa PDF’ga yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `Yozuvlar yo‘qligi uchun ${KOAP} alohida modda yo‘q. Harorat rejimini buzib tashish — TR TS 021/2011 ning tashishga doir talablarini buzish, maktab va ijtimoiy ovqatlanish uchun esa ovqatlanishni tashkil etishga doir sanitariya talablarini ham buzish hisoblanadi:`,
      items: finesList(FINE_14_43, FINE_6_6),
      note: NOTE,
    },
  },

  pest_control: {
    sample: {
      caption:
        "Bir oylik yozuvlar: pudratchining rejali ishlovlari va tuzoqlarni o‘zimiz ko‘zdan kechirishimiz. Har bir yozuvda ish turi, vosita, obyekt va xona yopib qo‘yiladigan vaqt ko‘rsatilgan.",
      columns: ["Sana", "Ijrochi", "Ish turi", "Obyekt", "Vosita", "Kutish muddati", "Imzo"],
      rows: [
        ["03.11.2026", "«DezServis» MChJ, dezinfektor Sergeyev V. P.", "Deratizatsiya, konteynerlardagi xo‘raklarni almashtirish", "Ombor, yerto‘la, konteyner maydonchasi", "Xo‘rak stansiyalaridagi rodentitsid", "Talab qilinmaydi", "Ivanova M. P."],
        ["03.11.2026", "«DezServis» MChJ, dezinfektor Sergeyev V. P.", "Dezinseksiya", "Yuvish xonasi, issiq sex", "Plintuslar bo‘ylab insektitsid gel", "4 soat, sex 08:00 da ochildi", "Ivanova M. P."],
        ["14.11.2026", "Kozlov A. A.", "Tuzoqlar va yopishqoq varaqlarni ko‘zdan kechirish", "Sxema bo‘yicha barcha xonalar", "—", "—", "Ivanova M. P."],
        ["24.11.2026", "«DezServis» MChJ, dezinfektor Sergeyev V. P.", "Buyurtma bo‘yicha rejadan tashqari dezinseksiya (yuvish xonasida suvaraklar)", "Yuvish xonasi", "Insektitsid gel", "4 soat", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Dezinseksiya va deratizatsiyani kim o‘tkazadi",
        paragraphs: [
          "Hasharotlar va kemiruvchilardan himoya barcha ovqatlanish obyektlari, oziq-ovqat savdosi va oziq-ovqat ishlab chiqarishlari uchun majburiy. Talablar SanPiN 3.3686-21 va SanPiN 3.5.2.3472-17 da belgilangan. Amalda ishlovlarni shartnoma asosida ixtisoslashgan tashkilot bajaradi, korxona esa kirishni ta’minlaydi, tashriflar orasida xo‘rak stansiyalari holatini kuzatadi va hisob yuritadi. Pudratchi bilan ishlash uchun mas’ul buyruq bilan tayinlanadi.",
        ],
      },
      {
        heading: "Shartnoma va hujjatlarda nimalar bo‘lishi kerak",
        bullets: [
          "Obyektlar va xonalar ro‘yxati, ish turlari va rejali ishlovlar davriyligi.",
          "Tuzoqlar va xo‘rak stansiyalarining raqamlari ko‘rsatilgan joylashuv sxemasi.",
          "Har bir tashrifdan keyin ishlatilgan vositalar ko‘rsatilgan bajarilgan ishlar dalolatnomalari.",
          "Qo‘llaniladigan vositalar hujjatlari: yo‘riqnomalar va davlat ro‘yxatidan o‘tkazilganligi haqidagi ma’lumotlar.",
          "Hasharot yoki kemiruvchilar aniqlansa, buyurtma bo‘yicha rejadan tashqari ishlov berish tartibi.",
        ],
      },
      {
        heading: "Xonani ishlovga qanday tayyorlash kerak",
        paragraphs: [
          "Mahsulotlar, idishlar va inventar olib qo‘yiladi yoki zich yopiladi, uskunalar plyonka bilan yopiladi. Ish vaqtida va kutish muddati davomida xodimlar xonaga kirmaydi. Kutish muddati tugagach, xona shamollatiladi, ish yuzalari yuviladi va shundan keyingina ovqat tayyorlash qayta boshlanadi. Kutish muddati vosita yo‘riqnomasi va pudratchi dalolatnomasidan olinadi.",
        ],
      },
      {
        heading: "Tekshiruvchi nimaga qaraydi",
        paragraphs: [
          "Shartnoma, dalolatnomalar va sxema borligi, sxemadagi va joyidagi tuzoq raqamlarining mosligi, hasharot va kemiruvchilar izlari yo‘qligi, derazalardagi to‘rlar va eshik zichlagichlarining butunligi. Rodentitsidlar mahsulotlar yonida saqlanmayaptimi va ishlab chiqarish hududlarida sochilib yotgan xo‘raklar yo‘qmi, alohida tekshiriladi. Agar pudratchi tashriflari orasida xodimlar zararkunanda izlarini payqasa, bu yoziladi va rejadan tashqari ishlovga buyurtma beriladi — tekshiruvchi tezkor munosabatni qadrlaydi.",
        ],
      },
      {
        heading: "Ishlovlar va dalolatnomalar bir joyda",
        paragraphs: [
          "WeSetup’da ishlov haqidagi yozuvga pudratchi dalolatnomasining surati yoki skan nusxasi biriktiriladi, shuning uchun hujjatlar yo‘qolmaydi. Kutish muddati yozuvga kiritiladi va xodimlar xonadan qachon yana foydalanish mumkinligini ko‘radi. Tuzoqlarni o‘zimiz ko‘zdan kechirishimiz stansiyadagi QR-kod orqali belgilanadi, jurnal esa dalolatnomalar bilan birga PDF’ga yuklanadi.",
        ],
      },
    ],
    fines: {
      intro: `${KOAP} jurnal yo‘qligi uchun alohida jarima yo‘q. Ammo obyektda hasharot yoki kemiruvchilar bo‘lsa-yu, muntazam ishlovlar haqida hujjatlar bo‘lmasa, tekshiruvchi sanitariya talablari buzilganini qayd etadi:`,
      items: finesList(FINE_6_6, FINE_6_3, FINE_6_4),
      note: `${NOTE} Zararkunandalar ommaviy ko‘payib ketgan bo‘lsa, sud ishlov o‘tkazilgunga qadar faoliyatni to‘xtatib qo‘yishi mumkin.`,
    },
  },
};
