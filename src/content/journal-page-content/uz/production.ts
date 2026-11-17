/**
 * Uzbek (Latin) translation of the intake, production and physical-hazard
 * journal page blocks (spec journal-page-content-i18n-2026-11). Same shape
 * and the same fine numbers as the Russian source in `../production.ts`.
 */

import type { JournalPageContent } from "../types";

const NOTE = "Summalar 2026-yil noyabr holatidagi RF KoAP tahriri bo‘yicha keltirilgan.";

const KOAP_INTRO = "RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksi (KoAP) bo‘yicha javobgarlik:";

const FINE_6_6 =
  "KoAP 6.6-moddasi — aholini ovqatlantirishni tashkil etishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish;";

const FINE_14_43 =
  "KoAP 14.43-moddasi — texnik reglamentlar (TR TS 021/2011) talablarini buzish: yakka tartibdagi tadbirkorlar (YaTT) uchun 20 000 dan 30 000 ₽ gacha, yuridik shaxslar uchun 100 000 dan 300 000 ₽ gacha";

const FINE_14_4 =
  "KoAP 14.4-moddasi 1-qismi — sifatsiz tovarlarni sotish, sifatsiz ishlarni bajarish yoki xizmatlar ko‘rsatish: yuridik shaxslar uchun 20 000 dan 30 000 ₽ gacha.";

const MERCURY_VSD = "VSD «Merkuriy» FDATda so‘ndirilgan";

export const PRODUCTION_PAGE_CONTENT_UZ: Record<string, JournalPageContent> = {
  perishable_rejection: {
    sample: {
      caption:
        "Bir tonggi qabul yozuvlari: har bir partiya o‘z hujjati va realizatsiya muddati bilan alohida qatorda. Oxirgi partiya baholashdan o‘tmadi va yetkazib beruvchiga qaytarildi — sababi va dalolatnoma raqami to‘g‘ridan-to‘g‘ri jurnalda ko‘rinadi.",
      columns: ["Kelib tushgan vaqt", "Mahsulot, qadoq, ishlab chiqarilgan sana", "Ishlab chiqaruvchi / yetkazib beruvchi", "Miqdori", "Xavfsizlik hujjati", "Organoleptik baho", "Saqlash, oxirgi muddat", "Mas’ul"],
      rows: [
        ["16.11.2026, 07:40", "Ichimlik suti 3,2 %, 1 l paket, ish. chiq. 15.11.2026", "«Molochniy dvor» MChJ", "40 l", MERCURY_VSD, "Mos keladi", "+2…+6 °C, 20.11.2026 gacha", "Ivanova M. P."],
        ["16.11.2026, 07:45", "Tvorog 9 %, 0,5 kg briket, ish. chiq. 15.11.2026", "«Molochniy dvor» MChJ", "12 kg", MERCURY_VSD, "Mos keladi", "+2…+6 °C, 19.11.2026 gacha", "Ivanova M. P."],
        ["16.11.2026, 08:20", "Sovutilgan tovuq filesi, 1 kg lotok, ish. chiq. 14.11.2026", "«Ptitsekombinat Severniy» MChJ", "25 kg", MERCURY_VSD, "Mos keladi", "0…+4 °C, 19.11.2026 gacha", "Ivanova M. P."],
        ["16.11.2026, 08:25", "Smetana 20 %, 0,4 kg stakan, ish. chiq. 15.11.2026", "«Molochniy dvor» MChJ", "30 dona", "Muvofiqlik deklaratsiyasi, VSD", "Mos kelmaydi: 3 donasining qopqog‘i shishgan", "Partiya qaytarildi, № 47 dalolatnoma", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Qaysi mahsulotlar qabulda brakerajdan o‘tkaziladi",
        paragraphs: [
          "Sovuq zanjir talab qiladigan va yaroqlilik muddati qisqa mahsulotlar tez buziladigan hisoblanadi: sut va sut mahsulotlari, go‘sht va parranda, baliq, tuxum, kulinariya yarim tayyor mahsulotlari, kremli qandolat mahsulotlari, tayyor salatlar. Sut mahsulotlarining markirovkasi va muomalasiga talablar TR TS 033/2013 da belgilangan, tavsiya etilgan hisob shakli esa SanPiN 2.3/2.4.4282-26 da keltirilgan.",
          "Bakaleya, sabzavotlar va ichimliklar odatda umumiy qabul jurnalida rasmiylashtiriladi. Brakeraj qabuldagi xato tezda zaharlanish xavfiga aylanadigan joyda kerak, shuning uchun bitta yetkazib beruvchidan bir nechta pozitsiya kelgan bo‘lsa ham, har bir partiya alohida baholanadi.",
        ],
      },
      {
        heading: "Partiyani bosqichma-bosqich qabul qilish",
        bullets: [
          "Mashinani tekshiring: kuzov tozaligi va sovutish qurilmasi ishlashini ko‘ring, mahsulot haroratini zondli termometr bilan o‘lchang.",
          "Hujjatlarni solishtiring: hayvonot mahsulotlari uchun «Merkuriy» FDATdagi veterinariya kuzatuv hujjati (VSD), muvofiqlik deklaratsiyasi, yuk xati.",
          "Markirovkani TR TS 022/2011 bo‘yicha tekshiring: nomi, ishlab chiqaruvchi, ishlab chiqarilgan sana, yaroqlilik muddati, saqlash shartlari.",
          "Qadoq va organoleptikani baholang: butunligi, bombaj yo‘qligi, rangi, hidi, konsistensiyasi.",
          "Qabul qilingan partiyani darhol sovutkichga joylang — qabulga ketgan vaqt yaroqlilik muddatini yeb qo‘ymasligi kerak.",
        ],
      },
      {
        heading: "Partiya baholashdan o‘tmasa",
        paragraphs: [
          "Bunday mahsulot qabul qilinganlari bilan aralashtirilmaydi: u «Brak / qaytarish» deb belgilangan joyga ajratiladi, haydovchi yoki yetkazib beruvchi vakili bilan dalolatnoma tuziladi va izohga belgi qo‘yiladi. «Merkuriy»dagi VSD rad etish yoki qisman qaytarish bilan so‘ndiriladi, aks holda partiya sizda hisobda qolib ketadi. Agar o‘sha yetkazib beruvchi bir oy ichida ikkinchi marta brak olib kelsa, bu tuzatuvchi harakat uchun asos: shartnomani, yetkazib berish shartlarini qayta ko‘rib chiqing yoki yetkazib beruvchini almashtiring.",
        ],
      },
      {
        heading: "Tekshiruvchi topadigan odatiy xatolar",
        bullets: [
          "Organoleptika ustuni bir hafta oldinga bitta «me’yor» so‘zi bilan to‘ldirib qo‘yilgan.",
          "Hujjat raqami «Merkuriy»dagi VSD bilan mos kelmaydi yoki xavfsizlik hujjati o‘rniga yuk xati raqami yozilgan.",
          "Realizatsiyaning oxirgi muddati qo‘yilmagan va omborda muddati o‘tgan mahsulot turibdi.",
          "Mas’ul shaxsning imzosi yo‘q yoki yozuvni o‘sha kuni ishlamagan odam qilgan.",
        ],
      },
      {
        heading: "Telefonda elektron brakeraj jurnali",
        paragraphs: [
          "WeSetup’da omborchi jurnalni ombor eshigidagi QR kod orqali ochadi, mahsulot va yetkazib beruvchini ma’lumotnomadan tanlaydi, yorliq va hujjatni suratga oladi — surat qatorga biriktiriladi. Yozuv vaqti avtomatik qo‘yiladi, realizatsiya muddati tugashiga yaqinlashganda ajratib ko‘rsatiladi, tuzatishlar esa tarixda saqlanadi. Tekshiruv oldidan jurnal SanPiN shaklida PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) brakeraj yo‘qligi uchun alohida modda yo‘q. Ammo yozuvlarsiz mahsulot hujjatlar bilan va lozim holatda qabul qilinganini isbotlab bo‘lmaydi, inspektor esa buni sanitariya talablari yoki texnik reglamentni buzish deb baholaydi:",
      items: [
        FINE_6_6,
        "KoAP 14.43-moddasi — texnik reglamentlar (TR TS 021/2011, TR TS 033/2013) talablarini buzish: yakka tartibdagi tadbirkorlar (YaTT) uchun 20 000 dan 30 000 ₽ gacha, yuridik shaxslar uchun 100 000 dan 300 000 ₽ gacha.",
      ],
      note: `${NOTE} Agar muomalada VSDsiz mahsulot topilsa, veterinariya hisobi ham alohida tekshiriladi.`,
    },
  },

  incoming_control: {
    sample: {
      caption:
        "Bir qabul smenasi yozuvlari: quruq mahsulotlar, sabzavotlar va sut mahsulotlari bitta jurnalda. Har bir yetkazib berish bo‘yicha qaysi hujjatlar va markirovka tekshirilgani hamda qanday qaror qabul qilingani, jumladan qisman qaytarish ham ko‘rinadi.",
      columns: ["Sana, vaqt", "Yetkazib beruvchi, yuk xati", "Mahsulot", "Miqdori", "Yaroqlilik muddati", "Hujjatlar va markirovka", "Qaror", "Qabul qildi"],
      rows: [
        ["17.11.2026, 08:15", "«Ovoshnaya baza» MChJ, yuk xati № 1184", "Yuvilgan kartoshka", "50 kg", "27.11.2026 gacha", "Deklaratsiya, qopdagi yorliq", "Qabul qilindi", "Kozlov A. A."],
        ["17.11.2026, 09:30", "«Bakaleya-Opt» MChJ, UPD № 562", "Oliy navli bug‘doy uni", "100 kg (4 qop)", "17.08.2027 gacha", "Deklaratsiya, markirovka to‘liq", "Qabul qilindi", "Kozlov A. A."],
        ["17.11.2026, 10:05", "«Molochniy dvor» MChJ, UPD № 3307", "Qaymoq 33 %, 1 l", "12 l", "25.11.2026 gacha", MERCURY_VSD, "Qabul qilindi", "Kozlov A. A."],
        ["17.11.2026, 11:20", "«Bakaleya-Opt» MChJ, UPD № 571", "Rafinadlangan kungaboqar yog‘i, 5 l", "4 dona", "10.2027 gacha", "1 ta shishada quyilgan sana yo‘q", "3 dona qabul qilindi, 1 dona qaytarildi, № 12 dalolatnoma", "Kozlov A. A."],
      ],
    },
    sections: [
      {
        heading: "Umumiy qabul tez buziladigan mahsulotlar brakerajidan nimasi bilan farq qiladi",
        paragraphs: [
          "Qabuldan har bir yetkazib berish o‘tadi: bakaleya, sabzavotlar, ichimliklar, qadoq, oshxona uchun yuvish vositalari. Bu yerda mahsulot kelib tushgani, yuk xati bilan solishtirish, hujjatlar va markirovka qayd etiladi. Tez buziladigan mahsulotlar qo‘shimcha ravishda brakeraj jurnalida baholanadi: u yerda organoleptika va realizatsiyaning oxirgi muddati yoziladi.",
          "Bunday bo‘linish qulay: omborchida yetkazib berishlarning bitta kundalik ro‘yxati bo‘ladi, bosh oshpazda esa xavfi yuqori mahsulotlar bo‘yicha batafsil manzara.",
        ],
      },
      {
        heading: "Yetkazib berishni qabul qilish tartibi",
        bullets: [
          "Nomlar va miqdorni yuk xati bilan solishtiring, tortiladigan tovarni o‘z tarozingizda qayta torting.",
          "Xavfsizlik hujjatlarini tekshiring: muvofiqlik deklaratsiyasi, hayvonot mahsulotlari uchun VSD.",
          "Markirovkani TR TS 022/2011 bo‘yicha o‘qing: tarkibi, ishlab chiqaruvchi, ishlab chiqarilgan sana, yaroqlilik muddati, saqlash shartlari.",
          "Qadoqni ko‘zdan kechiring: ochilgan, ho‘l, ezilgan joylar va zararkunanda izlari yo‘qmi.",
          "Qolgan yaroqlilik muddatini baholang: qabul paytidagi minimal qoldiqni yetkazib beruvchi bilan shartnomada belgilab qo‘yish qulay.",
        ],
      },
      {
        heading: "Rad etish yoki qisman qaytarishni qanday rasmiylashtirish",
        paragraphs: [
          "Mos kelmaydigan tovar omborga qabul qilinmaydi va qoldiqqa kiritilmaydi. Ikki nusxada tafovut yoki qaytarish dalolatnomasi tuziladi, uni omborchi va haydovchi imzolaydi, dalolatnoma raqami jurnal qatoriga yoziladi. Agar tovar allaqachon tushirilgan bo‘lsa, u olib ketilguncha «Qaytarish» belgisi bilan alohida saqlanadi — shunda u adashib ishga ketmaydi.",
        ],
      },
      {
        heading: "Yozuvlardan yetkazib beruvchilar bilan ishlashda qanday foydalanish",
        paragraphs: [
          "Oyiga bir marta jurnalni to‘liq ko‘rib chiqish foydali: qaysi yetkazib beruvchilar tovarni ko‘proq hujjatsiz, qisqa muddat bilan yoki shikastlangan qadoqda olib keladi. Bunday tahlil GOST R ISO 22000-2019 bo‘yicha tashqi yetkazib beruvchilarni baholashning bir qismidir: uning natijalariga ko‘ra ma’qullangan yetkazib beruvchilar ro‘yxati va shartnoma shartlari yangilanadi.",
        ],
      },
      {
        heading: "Qog‘oz blank o‘rniga elektron qabul",
        paragraphs: [
          "WeSetup’da omborchi jurnalni ombor kirishidagi QR kod orqali ochadi, yetkazib beruvchini ma’lumotnomadan tanlaydi va yuk xati hamda yorliqlarni suratga oladi — suratlar yozuvda saqlanadi. Qabul vaqti avtomatik qayd etiladi, tuzatishlar tarixda ko‘rinadi, qaytarishda esa ilova sababni ko‘rsatishni talab qiladi. Istalgan davr uchun jurnal PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro: `Qabul jurnali yo‘qligi uchun maxsus jarima yo‘q. Xavf boshqa joyda: yozuvlarsiz korxona mahsulot xavfsizlik hujjatlari bilan va yo‘l qo‘yiladigan yaroqlilik muddati bilan kelib tushganini isbotlay olmaydi. ${KOAP_INTRO}`,
      items: [FINE_6_6, `${FINE_14_43}.`],
      note: NOTE,
    },
  },

  fryer_oil: {
    sample: {
      caption:
        "Bitta frityur apparati bo‘yicha uch kunlik yozuvlar: qovurishdan oldin va keyin yog‘ bahosi, keyingi kunga o‘tuvchi qoldiq va almashtirish. Uchinchi qator baho pasayishi va ishlatilgan yog‘ni utilizatsiya qilish qanday rasmiylashtirilishini ko‘rsatadi.",
      columns: ["Qovurish boshlanishi", "Yog‘ turi", "Qovurishdan oldingi baho", "Mahsulot", "Tugashi", "Qovurishdan keyingi baho", "Qoldiq / utilizatsiya qilindi", "Nazoratchi"],
      rows: [
        ["12.11.2026, 10:00", "Rafinadlangan kungaboqar yog‘i (yangi)", "5 ball", "Fri kartoshka, naggetslar", "16:30", "5 ball", "6 kg / —", "Petrov S. A."],
        ["13.11.2026, 10:00", "O‘tuvchi qoldiq + 1 kg qo‘shildi", "5 ball", "Fri kartoshka", "16:00", "4 ball", "6,5 kg / —", "Petrov S. A."],
        ["14.11.2026, 10:00", "O‘tuvchi qoldiq", "4 ball", "Fri kartoshka, pishloqli tayoqchalar", "15:10", "3 ball: qoraygan, begona hid", "— / 6 kg, yog‘ almashtirildi", "Petrov S. A."],
        ["14.11.2026, 15:30", "Rafinadlangan kungaboqar yog‘i (yangi)", "5 ball", "Fri kartoshka", "22:00", "5 ball", "7 kg / —", "Orlova N. S."],
      ],
    },
    sections: [
      {
        heading: "Frityur yog‘ini organoleptika bo‘yicha qanday baholash",
        paragraphs: [
          "Yog‘ ikki marta baholanadi: qovurish boshlanishidan oldin va tugaganidan keyin. Rangi va tiniqligiga qaraladi, hidlanadi va ta’mi tatib ko‘riladi; har bir ko‘rsatkich 5 ballik shkala bo‘yicha ballarga o‘tkaziladi, bunda 5 — o‘zgarishsiz yangi yog‘. Ballar odamdan odamga «suzib» ketmasligi uchun baholashni bitta tayinlangan xodim — oshpaz yoki bosh oshpaz o‘tkazadi.",
          "Agar oshxonada qutbli birikmalar testeri bo‘lsa, uning ko‘rsatkichlari organoleptik baho yonida yoziladi. Yog‘ almashtiriladigan chegara ishlab chiqarish nazorati dasturida belgilab qo‘yiladi va ish jarayonida o‘zgartirilmaydi.",
        ],
      },
      {
        heading: "Yog‘ni qachon almashtirish kerak",
        bullets: [
          "Baho korxonada belgilangan chegaradan pastga tushdi.",
          "Yog‘ qoraydi, quyuqlashdi, oddiy haroratda kuchli ko‘piklanadi yoki tutaydi.",
          "Achchiq ta’m, taxir yoki «baliq» hidi paydo bo‘ldi va u boshqa taomlarga o‘tmoqda.",
          "Yog‘da filtrlash bilan ketmaydigan ko‘p qurum va ushoqlar bor.",
        ],
        paragraphs: [
          "Yangi yog‘ qo‘shish bahoni nolga tushirmaydi: aralashma sifati qaytadan tekshiriladi va alohida qatorga yoziladi.",
        ],
      },
      {
        heading: "O‘tuvchi qoldiq va utilizatsiya",
        paragraphs: [
          "Smena oxirida yog‘ filtrlanadi va tortiladi yoki frityur apparatining o‘lchov belgilari bo‘yicha o‘lchanadi: bu ertaga ishga ketadigan o‘tuvchi qoldiq. Almashtirilgan yog‘ utilizatsiya ustuniga kilogrammda yoziladi. U kanalizatsiyaga to‘kilmaydi, balki yopiq idishga yig‘ilib, ishlatilgan yog‘larni shartnoma bo‘yicha olib ketadigan tashkilotga topshiriladi; topshirish dalolatnomasi yoki yuk xati jurnal bilan birga saqlanadi.",
        ],
      },
      {
        heading: "Tekshiruvchi nimaga qaraydi",
        bullets: [
          "Barcha baholar bir xil — oylab 5 balldan, birorta ham almashtirishsiz.",
          "Utilizatsiya qilingan yog‘ hajmi xaridlar bilan mos kelmaydi: yog‘ sarflangan va topshirilganidan ko‘proq sotib olinadi.",
          "Ikkinchi frityur apparati yoki tungi smena bo‘yicha yozuvlar yo‘q.",
          "Ishlab chiqarish nazorati dasturida almashtirish chegarasi ko‘rsatilmagan.",
        ],
      },
      {
        heading: "Frityurni ilovada hisobga olish",
        paragraphs: [
          "WeSetup’da har bir frityur apparatining o‘z QR kodi bor: oshpaz uni skanerlaydi, qovurishdan oldin va keyin ball qo‘yadi, kerak bo‘lsa yog‘ni suratga oladi. Vaqt avtomatik qayd etiladi, baho chegaradan past bo‘lsa, ilova sababni ko‘rsatish va almashtirishni belgilashni so‘raydi, rahbar esa bildirishnoma oladi. Barcha apparatlar bo‘yicha jurnal xuddi shu shaklda PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro: `Frityur yog‘larini hisobga olmaganlik uchun alohida jarima yo‘q. Ammo sifatini yo‘qotgan yog‘dan foydalanish sanitariya talablari va mahsulot xavfsizligi talablarini buzish hisoblanadi, yozuvlarsiz esa korxona yog‘ o‘z vaqtida almashtirilayotganini tasdiqlay olmaydi. ${KOAP_INTRO}`,
      items: [FINE_6_6, `${FINE_14_43}.`],
      note: NOTE,
    },
  },

  incoming_raw_materials_control: {
    sample: {
      caption:
        "Novvoyxonaning bir kunlik yozuvlari: xomashyo, ingredientlar va qadoqlash plyonkasi bir xil nazoratdan o‘tadi. Oxirgi partiyaga ruxsat berilmadi — u bo‘yicha yetkazib beruvchiga reklamatsiya ochildi.",
      columns: ["Sana", "Xomashyo / material", "Yetkazib beruvchi, partiya", "Hujjat", "Qadoq va markirovka", "TU / GOST ga muvofiqlik", "Qaror", "Nazoratchi"],
      rows: [
        ["10.11.2026", "Novvoylik uchun oliy navli bug‘doy uni", "«Melnitsa Povoljya» MChJ, 4417-partiya", "Muvofiqlik deklaratsiyasi, sifat guvohnomasi", "Qoplar butun, markirovka to‘liq", "Mos keladi", "Ruxsat berildi", "Orlova N. S."],
        ["10.11.2026", "Presslangan novvoylik xamirturushi", "«Drojjevoy zavod» MChJ, 1110-partiya", "Muvofiqlik deklaratsiyasi", "Briketlar shikastlanmagan, +4 °C", "Mos keladi", "Ruxsat berildi", "Orlova N. S."],
        ["10.11.2026", "Non qadoqlash uchun polipropilen plyonka", "«Upak-Prom» MChJ, P-2231-partiya", "Muvofiqlik deklaratsiyasi", "«Oziq-ovqat mahsulotlari uchun» belgisi bor, hidsiz", "Mos keladi", "Ruxsat berildi", "Orlova N. S."],
        ["10.11.2026", "Quritilgan mayiz", "«Suxofrukti-Opt» MChJ, 2610-partiya", "Muvofiqlik deklaratsiyasi", "1 ta quti yirtilgan, namlik izlari", "Mos kelmaydi", "Qaytarildi, № 8 reklamatsiya", "Orlova N. S."],
      ],
    },
    sections: [
      {
        heading: "HACCP tizimida xomashyoni kirish nazorati nima uchun kerak",
        paragraphs: [
          "Xomashyo — mahsulotga biologik, kimyoviy va fizik xavflar tushishi mumkin bo‘lgan birinchi nuqta. TR TS 021/2011 ishlab chiqaruvchidan HACCP tamoyillariga asoslangan tartiblarni joriy etishni talab qiladi, kelib tushayotgan xomashyoni nazorat qilish esa ularning majburiy qismidir. Qadoqlash materiallari xomashyo bilan teng tekshiriladi: ular mahsulot bilan bevosita aloqada bo‘ladi va unga hid yoki zararli moddalar o‘tkazishi mumkin.",
        ],
      },
      {
        heading: "Kirish nazorati rejasini qanday tuzish",
        bullets: [
          "Korxona sotib oladigan xomashyo, ingredientlar va qadoqlar ro‘yxati.",
          "Har bir pozitsiya bo‘yicha nima tekshiriladi: hujjatlar, markirovka, qadoq, harorat, organoleptika.",
          "Qabul mezonlari — markirovkada va yetkazib beruvchi spetsifikatsiyasida ko‘rsatilgan TU yoki GOST ga tayangan holda.",
          "Ishlab chiqarish nazorati dasturi bo‘yicha qaysi ko‘rsatkichlar qanday davriylikda laboratoriyaga yuboriladi.",
          "Ruxsat berish to‘g‘risida kim qaror qabul qiladi va uning o‘rnini kim bosadi.",
        ],
      },
      {
        heading: "Partiya bo‘yicha qaror: ruxsat, karantin, qaytarish",
        paragraphs: [
          "Hammasi joyida bo‘lsa, partiya ishlab chiqarishga qo‘yiladi. Agar hujjat yetishmasa yoki laboratoriya tahlili kerak bo‘lsa, partiya karantinga olinadi: yorliq bilan alohida saqlanadi va qaror chiqquncha ishlatilmaydi. Mos kelmaydigan partiya yetkazib beruvchiga reklamatsiya bilan qaytariladi, reklamatsiya raqami jurnalga yoziladi.",
          "Bitta yetkazib beruvchida takrorlanadigan nomuvofiqliklar tuzatuvchi harakat sifatida ko‘rib chiqiladi: tashish shartlari, shartnoma talablari tekshiriladi, zarur bo‘lsa yetkazib beruvchi auditi o‘tkaziladi yoki u almashtiriladi.",
        ],
      },
      {
        heading: "Qadoqlash materiallari: nimani tekshirish kerak",
        bullets: [
          "Oziq-ovqat mahsulotlari bilan aloqa qilish uchun mo‘ljallanganligi haqidagi markirovka.",
          "Begona hid, ifloslanish, rulon yoki qutilarning shikastlari yo‘qligi.",
          "O‘lcham va qalinlikning buyurtmaga mosligi — qadoqning germetikligi shunga bog‘liq.",
          "Aynan shu partiyaga berilgan muvofiqlik hujjati.",
        ],
      },
      {
        heading: "Kirish nazoratining elektron jurnali",
        paragraphs: [
          "WeSetup’da nazoratchi xomashyo va yetkazib beruvchini ma’lumotnomadan tanlaydi, markirovka va hujjatni suratga oladi, tekshiruv natijasini belgilaydi. Yozuv vaqti avtomatik qayd etiladi, tuzatishlar tarixda saqlanadi, rad etilganda esa tizim yetkazib beruvchiga reklamatsiya rasmiylashtirishni taklif qiladi. Audit uchun jurnal kerakli davr bo‘yicha PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro: `Jurnalning o‘zi uchun jarima yo‘q: bu HACCP ning ichki tartibi. Ammo tekshiruvda korxona kirish nazorati yozuvlarini ko‘rsata olmasa, bu TR TS 021/2011 talab qiladigan HACCP tamoyillariga asoslangan tartiblarni bajarmaslik deb baholanadi. ${KOAP_INTRO}`,
      items: [
        `${FINE_14_43};`,
        "KoAP 6.3-moddasi — sanitariya-epidemiologik osoyishtalikni ta’minlash sohasidagi qonunchilikni buzish: yuridik shaxslar uchun 10 000 dan 20 000 ₽ gacha yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish.",
      ],
      note: NOTE,
    },
  },

  batch_release: {
    sample: {
      caption:
        "Non sexining bir smenalik yozuvlari: har bir partiya bo‘yicha jo‘natishdan oldin nima tekshirilgani va qarorni kim qabul qilgani. Ikkinchi partiya yorliqdagi xato tufayli to‘xtatildi va qayta tekshiruvdan so‘ng alohida qatorda ruxsat oldi.",
      columns: ["Sana", "Mahsulot", "Partiya", "Miqdori", "Nima tekshirildi", "Qaror", "Mas’ul"],
      rows: [
        ["16.11.2026", "Qolipli bug‘doy noni", "261116-01", "320 dona", "Ta’mi va hidi me’yorda, 10 dona massasi chegarada, yorliq to‘g‘ri", "Ruxsat berildi", "Petrov S. A."],
        ["16.11.2026", "Kesilgan baton", "261116-02", "180 dona", "Yorliqda ishlab chiqarilgan sana noto‘g‘ri", "Ruxsat berilmadi, qayta qadoqlash", "Petrov S. A."],
        ["16.11.2026", "Kesilgan baton", "261116-02", "180 dona", "Yorliqlar almashtirildi, tanlab 10 dona tekshirildi", "Ruxsat berildi", "Petrov S. A."],
        ["16.11.2026", "«Vinegret» salati, 250 g", "261116-05", "60 qadoq", "Organoleptika, germetiklik, mahsulot +4 °C", "Ruxsat berildi", "Orlova N. S."],
      ],
    },
    sections: [
      {
        heading: "Partiyani chiqarishga kim haqli",
        paragraphs: [
          "Ruxsat berish huquqi buyruq bilan aniq shaxslarga biriktiriladi: texnolog, ishlab chiqarish boshlig‘i, smena ustasi. Muhimi, qarorni jo‘natishga shoshayotgan odam emas, balki sifat uchun javob beradigan xodim qabul qilishi kerak. Jurnalda aynan vakolatli xodim imzo chekadi — imzodan keyin chiqarish uchun mas’uliyatni kim o‘z zimmasiga olgani tushunarli bo‘ladi.",
        ],
      },
      {
        heading: "Ruxsat berishdan oldin nimani tekshirish",
        bullets: [
          "Smena davomidagi kritik nazorat nuqtalari yozuvlari: pishirish yoki termik ishlov berish harorati, sovutish.",
          "Partiyadan olingan tanlov bo‘yicha organoleptika va tashqi ko‘rinish.",
          "Massa yoki birliklar soni — ishlab chiqarish topshirig‘i bilan solishtirib.",
          "TR TS 022/2011 bo‘yicha markirovka: nomi, tarkibi, ishlab chiqarilgan sana, yaroqlilik muddati, saqlash shartlari, ishlab chiqaruvchi.",
          "Yuklashdan oldin qadoqning butunligi va mahsulot harorati.",
        ],
      },
      {
        heading: "Partiya raqamini qanday berish",
        paragraphs: [
          "Partiya — ma’lum vaqt ichida bir xil sharoitda chiqarilgan bir xil mahsulot. Amalda raqam sana, liniya yoki smenadan yig‘iladi: masalan, 261116-02 — 2026-yil 16-noyabr, kunning ikkinchi partiyasi. Raqam yorliqqa bosiladi va tovarga ilova qilinadigan hujjatlarda ko‘rsatiladi, shunda xaridor da’vosi bo‘yicha ruxsat yozuvini va partiya qaysi xomashyodan tayyorlanganini darhol topish mumkin.",
        ],
      },
      {
        heading: "Agar partiyaga ruxsat berilmasa",
        paragraphs: [
          "Partiya ajratib qo‘yiladi va «Ruxsat berilmagan» yorlig‘i bilan belgilanadi, jurnalga sabab va keyingi qaror yoziladi: nuqsonni bartaraf etish, qayta qadoqlash, qayta ishlash yoki hisobdan chiqarish. Tuzatilgandan keyin partiya qaytadan tekshiriladi va yangi qator kiritiladi — dastlabki yozuv o‘chirilmaydi. Agar bir xil sabab takrorlansa, tuzatuvchi harakat ochiladi va muammo manbai jarayonning o‘zidan qidiriladi.",
        ],
      },
      {
        heading: "WeSetup’da partiyalarga ruxsat berish",
        paragraphs: [
          "Mas’ul xodim jurnalni telefondan to‘g‘ridan-to‘g‘ri qadoqlash liniyasi yonida ochadi, mahsulotni ma’lumotnomadan tanlaydi va tekshirilgan bandlarni belgilaydi. Qaror vaqti va muallif avtomatik qayd etiladi, rad etilganda sababni ko‘rsatish kerak, tuzatishlar tarixda qoladi. Yozuv partiya raqami bo‘yicha qidiruvda topiladi, davr bo‘yicha jurnal esa PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro: `Ruxsat berish yozuvlari yo‘qligi uchun alohida jarima yo‘q. Ammo mahsulotni tekshiruvsiz va tasdiqlovchi yozuvlarsiz chiqarish TR TS 021/2011 ni buzish hisoblanadi, muomalada sifatsiz yoki noto‘g‘ri markirovkalangan partiya chiqib qolsa, tovarning o‘zi uchun ham javobgarlik yuzaga keladi. ${KOAP_INTRO}`,
      items: [`${FINE_14_43};`, FINE_14_4],
      note: NOTE,
    },
  },

  product_writeoff: {
    sample: {
      caption:
        "Bir haftalik yozuvlar: har bir holat bo‘yicha — partiya, miqdor, sabab va utilizatsiya usuli, uch kishilik komissiya imzolari. Sabablar turlicha va ulardan pul qayerda yo‘qotilayotgani ko‘rinadi.",
      columns: ["Sana", "Nomi", "Partiya, yaroqlilik muddati", "Miqdori", "Hisobdan chiqarish sababi", "Utilizatsiya", "Komissiya"],
      rows: [
        ["10.11.2026", "Ichimlik yogurti 2,5 %, 0,3 l", "1031-partiya, 09.11.2026 gacha", "8 dona", "Yaroqlilik muddati o‘tgan", "Shartnoma bo‘yicha utilizatsiyaga topshirildi", "Petrov, Ivanova, Kozlov"],
        ["11.11.2026", "Sovutilgan tovuq filesi", "2208-partiya, 15.11.2026 gacha", "3,2 kg", "Sovutkich ishdan chiqdi, mahsulot +12 °C da saqlangan", "Shartnoma bo‘yicha utilizatsiyaga topshirildi", "Petrov, Ivanova, Kozlov"],
        ["12.11.2026", "Oliy navli bug‘doy uni", "4417-partiya, 01.06.2027 gacha", "12 kg", "Tomdan suv o‘tganda qop namlangan", "Shartnoma bo‘yicha utilizatsiyaga topshirildi", "Petrov, Ivanova, Kozlov"],
        ["14.11.2026", "«Medovik» torti, 1 kg", "261113-03-partiya, 18.11.2026 gacha", "2 dona", "Deformatsiya, qadoq shikastlangan", "Shartnoma bo‘yicha utilizatsiyaga topshirildi", "Petrov, Ivanova, Kozlov"],
      ],
    },
    sections: [
      {
        heading: "Hisobdan chiqarish dalolatnomasi birlamchi hisob hujjati sifatida",
        paragraphs: [
          "402-FZ-son Federal qonunga ko‘ra har bir xo‘jalik hayoti fakti birlamchi hujjat bilan rasmiylashtiriladi. Hisobdan chiqarish uchun bu majburiy rekvizitlarga ega dalolatnoma: hujjat nomi, sana, tashkilot nomi, nima sodir bo‘lgani, natura va pul ko‘rinishidagi miqdor, mas’ul shaxslarning lavozimlari va imzolari. Dalolatnoma shaklini tashkilot o‘zi tasdiqlaydi — WeSetup’dagi jurnalda bu ustunlarning barchasi bor.",
          "Rasmiylashtirilgan dalolatnomasiz buxgalteriya mahsulot qiymatini asosli ravishda hisobdan chiqara olmaydi, kamomad esa moddiy javobgar shaxs zimmasida qolib ketadi.",
        ],
      },
      {
        heading: "Komissiya tarkibiga kim kiradi",
        paragraphs: [
          "Komissiya tarkibi rahbar buyrug‘i bilan tayinlanadi. Odatda bular bosh oshpaz yoki ishlab chiqarish mudiri, omborchi yoki tovarshunos va boshqaruvchi. Moddiy javobgar shaxs ishtirok etishi mumkin, lekin mahsulotni yolg‘iz o‘zi hisobdan chiqarmasligi kerak: bir necha kishining imzosi ham korxonani, ham xodimning o‘zini himoya qiladi.",
        ],
      },
      {
        heading: "Hisobdan chiqarish tartibi bosqichma-bosqich",
        bullets: [
          "Mahsulotni ajratib qo‘ying va ishga ketmasligi uchun «Hisobdan chiqarishga» deb belgilang.",
          "Torting yoki sanab chiqing, markirovkali qadoqni suratga oling.",
          "Aniq sababni ko‘rsating: yaroqlilik muddati, saqlash shartlarining buzilishi, yetkazib beruvchi braki, ishlab chiqarishda buzilish.",
          "Mahsulotni qanday utilizatsiya qilishni hal qiling va utilizatsiyaga topshirish hujjatini ilova qiling.",
          "Dalolatnomani komissiya bilan imzolang va buxgalteriyaga topshiring; aybdor yetkazib beruvchi bo‘lsa — unga da’vo yuboring.",
        ],
      },
      {
        heading: "Hisobdan chiqarish ma’lumotlaridan qanday foydalanish",
        paragraphs: [
          "Oyiga bir marta yozuvlarni sabablar bo‘yicha guruhlang. Yaroqlilik muddati bo‘yicha hisobdan chiqarishlar ko‘p bo‘lsa — buyurtma hajmlarini va «birinchi kelgan — birinchi ketadi» tartibini qayta ko‘rib chiqing. Saqlash shartlarining buzilishi takrorlansa — sovutish uskunalari va harorat jurnalini tekshiring. Bitta yetkazib beruvchidan brak kelsa — bu reklamatsiya va uni almashtirish uchun asos. Shunda hisobdan chiqarish rasmiyatchilikdan yo‘qotishlarni kamaytirish vositasiga aylanadi.",
        ],
      },
      {
        heading: "Mahsulotni elektron shaklda hisobdan chiqarish",
        paragraphs: [
          "WeSetup’da xodim yozuvni telefondan yaratadi va surat ilova qiladi, komissiya a’zolari uni o‘z telefonlarida tasdiqlaydi — smena bo‘ylab bir-birini qidirib yurmasdan. Sana va imzolar avtomatik qayd etiladi, tuzatishlar tarixda ko‘rinadi, partiya bo‘yicha darhol yetkazib beruvchiga reklamatsiya ochish mumkin. Dalolatnoma buxgalteriya uchun PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Hisobdan chiqarish dalolatnomasining o‘zi buxgalteriya hisobi hujjati, uning yo‘qligi uchun sanitariya jarimalari yo‘q. Usiz soliq organi hisobdan chiqarilgan mahsulot qiymatini xarajat sifatida qabul qilmasligi mumkin. Asosiy xavf boshqa: agar muddati o‘tgan yoki buzilgan mahsulot hisobdan chiqarilmay, muomalada qolgan yoki taomlarga tushgan bo‘lsa, RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksi (KoAP) bo‘yicha javobgarlik yuzaga keladi:",
      items: [`${FINE_14_43};`, FINE_14_4],
      note: NOTE,
    },
  },

  traceability_test: {
    sample: {
      caption:
        "Bitta rejali test yozuvlari: ikki zanjir to‘liq tiklandi, uchinchisi uzildi — unning bir qismi ombordan berish yozuvlarida topilmadi. U bo‘yicha tuzatuvchi harakat ochildi.",
      columns: ["Test sanasi", "Boshlang‘ich nuqta", "Yo‘nalish", "Nima topildi", "Miqdori", "Test vaqti", "Natija", "O‘tkazdi"],
      rows: [
        ["05.11.2026", "Smetana 20 %, 1102-partiya, «Molochniy dvor» MChJ", "Oldinga: xomashyo → taomlar", "02–04.11.2026 dagi borshch, sirniki, smetanali sous", "15 kg: 14,2 kg sarflangan, 0,8 kg omborda", "1 soat 40 daqiqa", "O‘tdi", "Ivanova M. P."],
        ["05.11.2026", "Tovuq kotleti, 03.11.2026 dagi chiqarish", "Orqaga: taom → xomashyo", "Tovuq filesi, 2208-partiya, «Merkuriy» FDATdagi VSD; tuxum, non", "120 porsiya", "2 soat 15 daqiqa", "O‘tdi", "Ivanova M. P."],
        ["05.11.2026", "Bug‘doy uni, 4417-partiya", "Oldinga: xomashyo → taomlar", "03.11.2026 dagi quymoqlar; pirojkilar bo‘yicha sarf yozuvi topilmadi", "25 kg: 23 kg tasdiqlandi, 2 kg topilmadi", "3 soat 50 daqiqa", "O‘tmadi, CAPA № 14", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Kuzatuvchanlik testi nima va u nima uchun kerak",
        paragraphs: [
          "TR TS 021/2011 oziq-ovqat mahsulotlari kuzatuvchan bo‘lishini talab qiladi: korxona xomashyoni kimdan olganini va tayyor mahsulot qayerga ketganini bilishi kerak. GOST R ISO 22000-2019 bunga kuzatuvchanlik tizimini tekshirib turish zarurligini qo‘shadi. Test — partiyani o‘quv tarzida qaytarib olish: bitta xomashyo partiyasi yoki bitta taom tanlanadi va zanjir yozuvlar bo‘yicha xuddi mehmon shikoyati yoki yetkazib beruvchidan qaytarib olish haqida xat kelgandek tiklanadi.",
        ],
      },
      {
        heading: "Testni bosqichma-bosqich qanday o‘tkazish",
        bullets: [
          "Boshlang‘ich nuqtani xodimlarni ogohlantirmasdan tanlang: yuk xatidagi xomashyo partiyasi yoki aniq sanadagi taom.",
          "Boshlanish vaqtini belgilab qo‘ying.",
          "Zanjirni hujjatlar bo‘yicha bosib o‘ting: yuk xati va VSD, qabul jurnali, ombordan berish, yarim tayyor mahsulotlar markirovkasi, texnologik kartalar, tayyor mahsulot brakeraj jurnali.",
          "Balansni chiqaring: qancha kelib tushgan, qancha sarflangan, qancha qolgan va hisobdan chiqarilgan.",
          "Vaqtni, natijani va topilgan uzilishlarni yozib qo‘ying.",
        ],
      },
      {
        heading: "Qanday natija muvaffaqiyatli hisoblanadi",
        paragraphs: [
          "Agar zanjir to‘liq tiklangan va HACCP dasturida belgilangan vaqt me’yoriga sig‘gan bo‘lsa, massa balansi esa texnologik yo‘qotishlar uchun ruxsat etilgan kichik xatolik bilan mos kelsa, test o‘tgan hisoblanadi. Hammasi topilgan, ammo qidiruv yarim kun davom etgan bo‘lsa, bu ham signal: haqiqiy qaytarib olishda mahsulot mehmonlarga yetib borishga ulguradi.",
        ],
      },
      {
        heading: "Agar zanjir uzilsa",
        paragraphs: [
          "Uzilish deyarli har doim uch joydan birida bo‘ladi: mahsulot markirovkasiz boshqa idishga solingan, ombordan berish yozilmagan yoki jurnalda partiya raqami ko‘rsatilmagan. Har bir uzilish bo‘yicha tuzatuvchi harakat ochiladi, mas’ul va muddat tayinlanadi, bir oydan keyin esa o‘sha mahsulotlar guruhi bo‘yicha test takrorlanadi.",
        ],
      },
      {
        heading: "WeSetup’da kuzatuvchanlik",
        paragraphs: [
          "Qabul, brakeraj va hisobdan chiqarish WeSetup’da yuritilganda partiya raqami turli jurnallar yozuvlarini bog‘laydi: u bo‘yicha qidiruv xomashyo qachon kelganini, uni kim qabul qilganini va qaysi kunlari ishlatilganini ko‘rsatadi. Test soatlar o‘rniga daqiqalar oladi, vaqt avtomatik qayd etiladi, bayonnoma esa auditor uchun PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro: `O‘tkazilmagan test uchun jarima yo‘q: bu HACCP ning ichki tartibi. Ammo mahsulot kuzatuvchanligini ta’minlash talabi TR TS 021/2011 da yozilgan, agar tekshiruv yoki partiyani qaytarib olishda korxona yetkazib berish zanjirini tiklay olmasa, bu texnik reglamentni buzish hisoblanadi. ${KOAP_INTRO}`,
      items: [`${FINE_14_43}.`],
      note: `${NOTE} Mehmonlar zaharlanganda kuzatuvchanlik yo‘qligi korxonaning himoyasini jiddiy qiyinlashtiradi.`,
    },
  },

  metal_impurity: {
    sample: {
      caption:
        "Novvoyxonaning ikki kunlik yozuvlari: xomashyo elaklarning magnit separatorlaridan o‘tadi, qadoqlash liniyasidagi metall detektori esa test namunalari bilan tekshiriladi. Bir un partiyasida sim topildi — partiya to‘xtatildi.",
      columns: ["Sana, smena", "Xomashyo / nazorat", "Partiya", "O‘tkazildi, kg", "Aralashmalar massasi, g", "Aralashmalar tavsifi", "Ko‘rilgan choralar", "Imzo"],
      rows: [
        ["10.11.2026, 1-smena", "Oliy navli bug‘doy uni", "4417", "1 200", "0", "—", "—", "Petrov S. A."],
        ["10.11.2026, 1-smena", "Shakar qumi", "0915", "300", "0,2", "Mayda ferromagnit chang", "Magnit tozalandi, ma’lumotlar texnologga berildi", "Petrov S. A."],
        ["11.11.2026, 2-smena", "Javdar uni (obdirka)", "1029", "800", "1,4", "Taxminan 4 mm li sim bo‘lagi, temir kuyindisi", "Partiya to‘xtatildi, yetkazib beruvchiga reklamatsiya", "Orlova N. S."],
        ["11.11.2026, 2-smena", "Qadoqlash liniyasining metall detektori", "—", "—", "—", "Qora, rangli metall va zanglamaydigan po‘lat test namunalari aniqlandi", "Soz ishlayapti", "Orlova N. S."],
      ],
    },
    sections: [
      {
        heading: "Magnitlar va metall detektorlari qayerga o‘rnatiladi",
        paragraphs: [
          "Magnit separatorlar un, shakar, yorma va ziravorlar elaklariga — sochiluvchan xomashyo oqim bilan o‘tadigan joylarga o‘rnatiladi. Metall detektori liniya oxiriga, qadoqlashdan oldin yoki keyin qo‘yiladi, toki mahsulotga ishlab chiqarishning o‘zida tushgan narsa ushlab qolinsin. Nazorat kerakmi va qaysi nuqtada — bu xavflar tahlili asosida hal qilinadi: ba’zi korxonalarda bu kritik nazorat nuqtasi, boshqalarida — majburiy dastlabki dastur.",
        ],
      },
      {
        heading: "Nazoratni qanday o‘tkazish",
        bullets: [
          "Magnitlarni jadval bo‘yicha tozalang — odatda smena oxirida va har bir partiya qayta ishlangandan keyin.",
          "Olingan aralashmalarni toza qog‘ozga yig‘ing, torting va tavsiflang: chang, qirindi, sim, detal bo‘laklari.",
          "Metall detektorini turli metallardan yasalgan test namunalari bilan smena boshida, qayta sozlashdan keyin va ish oxirida tekshiring.",
          "Agar detektor namunani aniqlamasa, oxirgi muvaffaqiyatli tekshiruvdan beri chiqarilgan barcha mahsulotni qayta tekshiring.",
        ],
      },
      {
        heading: "Topilmalarni qanday baholash",
        paragraphs: [
          "Mayda ferromagnit chang izlari sochiluvchan xomashyoda uchrab turadi va odatda magnit ishlayotganini bildiradi. Xavotirli signal — yirik bo‘laklar yoki aralashmalar massasining partiyadan partiyaga oshib borishi. Manba ikki yo‘nalishda qidiriladi: yetkazib beruvchi xomashyosi va korxonaning o‘z uskunalari. Elaklar, pichoqlar, shneklar yeyilganda o‘ziga xos qirindi hosil bo‘ladi, shuning uchun topilmalarni texnik xizmat ko‘rsatish jurnali bilan solishtirish foydali.",
        ],
      },
      {
        heading: "Metall topilganda nima qilish kerak",
        paragraphs: [
          "Xomashyo yoki mahsulot partiyasi ajratib qo‘yiladi, qayta tekshiriladi va shundan keyingina uning taqdiri hal qilinadi: takroriy nazoratdan so‘ng ruxsat berish, yetkazib beruvchiga qaytarish yoki utilizatsiya. Topilma tahlil qilinguncha markirovkalangan paketda saqlanadi — u reklamatsiya uchun kerak. Agar manba sex ichida bo‘lsa, uskuna ta’mirlanguncha to‘xtatiladi va tuzatuvchi harakat ochiladi.",
        ],
      },
      {
        heading: "Metall aralashmalarni telefondan hisobga olish",
        paragraphs: [
          "WeSetup’da har bir elak va detektorning o‘z QR kodi bor: operator uni skanerlaydi, topilmaning massasi va suratini kiritadi, test namunalari bilan tekshiruv natijasini belgilaydi. Vaqt avtomatik qayd etiladi, topilma haqida rahbar bildirishnoma oladi, rejali tekshiruv o‘tkazib yuborilgani esa darhol ko‘rinadi. Jurnal PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro: `Bu jurnal uchun alohida jarima yo‘q: bu HACCP tizimida fizik xavflarni nazorat qilish tartibi. Ammo mahsulotga metall tushgan bo‘lsa-yu, korxona nazorat o‘tkazilganini ko‘rsata olmasa, bu TR TS 021/2011 ni buzish hisoblanadi. ${KOAP_INTRO}`,
      items: [`${FINE_14_43};`, FINE_14_4],
      note: NOTE,
    },
  },

  glass_items_list: {
    sample: {
      caption:
        "Uchastkalar bo‘yicha ro‘yxatdan parcha: har bir buyumning raqami, materiali, soni va himoyasi bor. Izohlarda mo‘rt buyumlar imkon qadar sinmaydiganlariga almashtirilishi ko‘rinadi.",
      columns: ["№", "Uchastka", "Buyum", "Material", "Soni", "Himoya / izoh", "Tekshirildi"],
      rows: [
        ["1-1", "Issiq sex", "Chiroq plafoni", "Shisha", "6", "Himoya to‘ri", "03.11.2026"],
        ["1-2", "Issiq sex", "Parokonvektomatning ko‘rish oynasi", "Toblangan shisha", "2", "—", "03.11.2026"],
        ["2-1", "Sovuq sex", "Qopqoqli ziravor idishi", "Mo‘rt plastik", "8", "30.11.2026 gacha polipropilen idishlarga almashtirish", "03.11.2026"],
        ["3-1", "Qandolat sexi", "Vitrina-shkaf eshigi", "Shisha", "1", "Himoya plyonkasi", "03.11.2026"],
        ["4-1", "Ombor", "Devor soati", "Shisha", "1", "Saqlash zonasidan tashqariga ko‘chirish", "03.11.2026"],
      ],
    },
    sections: [
      {
        heading: "Ro‘yxatga nimalarni kiritish kerak",
        bullets: [
          "Chiroqlar, plafonlar, insektitsid tutqichlarining lampalari.",
          "Derazalar, shisha eshiklar, vitrinalar, ko‘zgular.",
          "Uskunalarning ko‘rish oynalari va shkalalari, tarozi displeylari, shisha termometrlar.",
          "Shisha va mo‘rt plastikdan yasalgan idish va inventar: bankalar, konteynerlar, o‘lchov idishlari, qopqoqlar.",
          "Soatlar, shisha lavhalar, himoya ekranlari.",
        ],
      },
      {
        heading: "Ro‘yxatni uchastkalar bo‘yicha qanday tuzish",
        paragraphs: [
          "Ro‘yxat sex rejasi bilan xonalarni aylanib chiqib tuziladi: har bir uchastkada yuqoridan pastga qaraladi — ship, devorlar, uskunalar, ish stollari. Buyumlarga «uchastka–pozitsiya» ko‘rinishidagi raqam beriladi va imkon bo‘lsa yorliq bilan belgilanadi, toki singanda aynan nima singanini darhol tushunish mumkin bo‘lsin. Har bir buyum uchun aylanib chiqilgan sanadagi holati ko‘rsatiladi. Ro‘yxatni HACCP tizimi uchun mas’ul shaxs tasdiqlaydi; butunlikni rejali tekshirishlar shu ro‘yxat bo‘yicha o‘tkaziladi.",
        ],
      },
      {
        heading: "Mo‘rt buyumlar sonini qanday kamaytirish",
        paragraphs: [
          "Eng yaxshi ro‘yxat — qisqa ro‘yxat. Shisha plafonlar polikarbonat tarqatgichli chiroqlarga almashtiriladi yoki to‘r bilan yopiladi, vitrina oynalariga himoya plyonkasi yopishtiriladi, shisha idishlar metall yoki sinmaydigan plastik idishlarga almashtiriladi. Shaxsiy shisha buyumlar — shishalar, bankalar, zarurat bo‘lmasa ko‘zoynaklar — ishlab chiqarish zonasiga olib kirilmaydi; bu qoida xodimlar uchun yo‘riqnomada mustahkamlanadi.",
        ],
      },
      {
        heading: "Ro‘yxatni qachon yangilash kerak",
        bullets: [
          "Uskuna sotib olinganda, almashtirilganda yoki boshqa joyga ko‘chirilganda.",
          "Har bir sinish holatidan keyin, agar buyum tiklanmagan yoki boshqasiga almashtirilgan bo‘lsa.",
          "Xonalar qayta rejalashtirilganda va ularning vazifasi o‘zgarganda.",
          "Ichki audit natijalariga ko‘ra.",
        ],
      },
      {
        heading: "Auditda topiladigan tez-tez uchraydigan bo‘shliqlar",
        bullets: [
          "Ish zonalari ustidagi buyumlar ro‘yxatga kirmay qolgan: so‘rg‘ich chiroqlari, sovutish kameralaridagi lampalar.",
          "Ro‘yxatdagi soni haqiqatdagisi bilan mos kelmaydi, chunki ta’mirdan keyin ro‘yxat yangilanmagan.",
          "Buyumlar uchastkasiz yozilgan — singanda qayerdan qidirish va nimani solishtirish noma’lum.",
          "Ro‘yxat bor, lekin u bo‘yicha rejali tekshiruvlar o‘tkazilmaydi.",
        ],
      },
      {
        heading: "WeSetup’da mo‘rt buyumlar ro‘yxati",
        paragraphs: [
          "WeSetup’da ro‘yxat uchastkalar bo‘yicha yuritiladi va shisha nazorati jurnali bilan bog‘langan: rejali tekshiruvda xodim o‘z uchastkasidagi buyumlar ro‘yxatini ko‘radi va ular joyida va butunligini telefondan belgilaydi. Ro‘yxatdagi o‘zgarishlar sana va muallif bilan tarixda saqlanadi, amaldagi versiya esa PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro: `Ro‘yxat yo‘qligi uchun maxsus jarima yo‘q. Bu fizik xavflarni boshqarish uchun HACCP tizimi hujjati: usiz korxona mahsulotga shisha tushish xavfi TR TS 021/2011 talab qilganidek baholangan va nazorat qilinayotganini ko‘rsata olmaydi. ${KOAP_INTRO}`,
      items: [`${FINE_14_43}.`],
      note: NOTE,
    },
  },

  glass_control: {
    sample: {
      caption:
        "Ikki rejali aylanib chiqish yozuvlari: har bir uchastka bo‘yicha buyumlar soni ro‘yxat bilan solishtiriladi. Uchinchi qator plafon singanda holat va uchastkadagi mahsulot bo‘yicha qaror qanday rasmiylashtirilishini ko‘rsatadi.",
      columns: ["Sana", "Uchastka", "Ro‘yxat bo‘yicha", "Joyida, butun", "Aniqlandi", "Ko‘rilgan choralar", "Tekshirdi"],
      rows: [
        ["02.11.2026", "Issiq sex", "8", "8", "—", "—", "Ivanova M. P."],
        ["02.11.2026", "Sovuq sex", "10", "9", "№ 2-1 konteyner qopqog‘ida yoriq", "Olib tashlandi, polipropilen idishga almashtirildi", "Ivanova M. P."],
        ["09.11.2026, 10:40", "Issiq sex", "8", "7", "№ 1-1 plafon singan", "Ish to‘xtatildi, siniqlar yig‘ildi, 14 kg mahsulot utilizatsiya qilindi, № 5 dalolatnoma", "Komissiya: Ivanova M. P., Petrov S. A., Kozlov A. A."],
        ["09.11.2026", "Ombor", "3", "3", "—", "—", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Rejali tekshiruv: uchastkalarni qanday aylanib chiqish",
        paragraphs: [
          "Aylanib chiqish davriyligi HACCP dasturida belgilanadi, ko‘pincha — haftada bir marta. Tekshiruvchi xotiraga emas, buyumlar ro‘yxatiga tayanib yuradi: har birini raqami bo‘yicha topadi, joyida ekanini, yoriqlar, uchgan joylar va bo‘shashgan mahkamlagichlar yo‘qligini tekshiradi. «Joyida va butun» soni ro‘yxat bilan mos kelishi kerak; har qanday tafovut yoziladi va o‘sha kuniyoq ko‘rib chiqiladi.",
          "Shu bilan birga uchastkada ro‘yxatda yo‘q mo‘rt buyumlar paydo bo‘lmaganiga qaraladi: ziravorli shisha banka, shaxsiy krujka, yangi lampa. Ular zonadan olib chiqiladi yoki ro‘yxatga kiritiladi — ikkinchisi faqat buyumsiz ishlab bo‘lmasa.",
        ],
      },
      {
        heading: "Shisha singanda harakatlar tartibi",
        bullets: [
          "Uchastkada ishni to‘xtating va mas’ul shaxsga xabar bering.",
          "Siniqlar sochilgan zonani o‘rab qo‘ying, undan mahsulot va inventarni olib chiqmang.",
          "Siniqlarni cho‘tka va xokandoz bilan yig‘ing, polni, uskunalarni, tokchalarni va xodimlar kiyimini tekshiring.",
          "Yig‘ilgan bo‘laklarni bir joyga qo‘ying va butun buyum shakli bilan solishtiring — hammasi topildimi.",
          "Zonani tozalang, mas’ul shaxs ruxsatidan keyin ishni qayta boshlang.",
        ],
      },
      {
        heading: "Mahsulot taqdiri bo‘yicha qaror",
        paragraphs: [
          "Siniqlar sochilishi mumkin bo‘lgan zonadagi barcha ochiq mahsulot va yarim tayyor mahsulotlar utilizatsiya qilinadi — ularda mayda siniqlar yo‘qligini tekshirishning iloji yo‘q. Yopiq idishdagi mahsulot ko‘zdan kechiriladi, idish tashqaridan yuviladi. Utilizatsiya qilingan miqdor va qaror komissiya imzolaydigan dalolatnoma bilan rasmiylashtiriladi; dalolatnoma raqami jurnalga yoziladi.",
        ],
      },
      {
        heading: "Har bir holatdan keyin sabablarni tahlil qilish",
        paragraphs: [
          "Har bir sinish va topilgan har bir yoriq bo‘yicha tuzatuvchi harakat ochiladi: buyum nega singan, uni sinmaydiganiga almashtirish mumkinmi, himoya kerakmi. Agar mo‘rt buyum olib tashlangan yoki almashtirilgan bo‘lsa, ro‘yxat darhol yangilanadi — aks holda keyingi aylanib chiqishda son mos kelmaydi.",
        ],
      },
      {
        heading: "WeSetup’da shisha nazorati",
        paragraphs: [
          "Tekshiruvchi aylanib chiqishni telefondan ochadi, ro‘yxatdan o‘z uchastkasidagi buyumlarni ko‘radi va har birini belgilaydi. Yozuv vaqti avtomatik qayd etiladi, sinish holatida ilova bosqichma-bosqich yo‘l ko‘rsatadi, zona surati va komissiya imzolarini so‘raydi, rahbar esa bildirishnoma oladi. Istalgan davr uchun jurnal PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro: `Bu jurnal uchun alohida jarima yo‘q: mo‘rt buyumlarni nazorat qilish — HACCP tartibi. Ammo siniq mahsulotga tushgan bo‘lsa-yu, tekshiruvlar va sinishdagi harakatlar haqida yozuvlar bo‘lmasa, korxona fizik xavf nazorat qilinganini tasdiqlay olmaydi. ${KOAP_INTRO}`,
      items: [`${FINE_14_43};`, FINE_14_4],
      note: NOTE,
    },
  },

  tableware_breakage: {
    sample: {
      caption:
        "Kafening uch kunlik yozuvlari: zalda, barda va oshxonada singan idishlar. Siniqlar mahsulotga yoki muzga tushishi mumkin bo‘lgan holatlar alohida ustunda qabul qilingan qaror bilan birga ko‘rinadi.",
      columns: ["Sana, vaqt", "Nima sindi", "Soni", "Qayerda", "Sababi", "Siniqlar yig‘ildi", "Mahsulotlar", "Mas’ul"],
      rows: [
        ["12.11.2026, 13:20", "Chuqur likopcha", "1", "Zal, 7-stol", "Patnisdan tushib ketdi", "Ha, zona tekshirildi", "Ta’sir qilmadi", "Sidorova A. V."],
        ["12.11.2026, 16:05", "Stakan", "2", "Bar", "Yuvishda yorilgan", "Ha", "Bunkerdagi muz tashlandi, bunker yuvildi", "Sidorova A. V."],
        ["13.11.2026, 11:40", "Shisha salat idishi", "1", "Sovuq sex, tayyorlov stoli", "Qo‘ldan sirpanib ketdi", "Ha", "1,5 kg to‘g‘ralgan bodring hisobdan chiqarildi", "Ivanova M. P."],
        ["14.11.2026, 19:10", "Vino bokali", "1", "Idish yuvish xonasi", "Yuvishda uchgan joy aniqlandi", "Ha", "Ta’sir qilmadi", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Qaysi holatlar yoziladi",
        paragraphs: [
          "Har bir sinish yoziladi — zalda, tarqatishda, barda, idish yuvish xonasida va oshxonada, hatto bitta piyola singan bo‘lsa ham. Yuvish yoki dasturxon tuzash paytida topilgan uchgan va yorilgan idishlar ham shu yerga kiritiladi: bunday idish singani kabi xavfli, u «smena oxirigacha» emas, darhol muomaladan olinadi.",
        ],
      },
      {
        heading: "Hech narsa qolmasligi uchun siniqlarni qanday yig‘ish",
        bullets: [
          "Siniqlarni qo‘l bilan yig‘mang: cho‘tka, xokandoz, qalin qo‘lqoplardan foydalaning.",
          "Siniqlar sochilgan radiusda, stollar va uskunalar ostida polni ko‘zdan kechiring, mayda zarralarni nam salfetka bilan yig‘ing.",
          "Mehmon stolidagi qo‘shni likopchalar, anjomlar va stakanlarni tekshiring, shubha bo‘lsa almashtiring.",
          "Axlatni olib chiqadigan odam jarohatlanmasligi uchun siniqlarni qalin paket yoki qutiga soling.",
          "Agar idish ochiq mahsulotlar, muz ustida yoki idishlar turgan yuvgichda singan bo‘lsa — mahsulotlarni hisobdan chiqaring, yuvgichni bo‘shating va tekshiring.",
        ],
      },
      {
        heading: "Oylik yozuvlar nimani ko‘rsatadi",
        paragraphs: [
          "Oyiga bir marta jurnalni to‘liq ko‘rib chiqish foydali. Agar sinish bir joyda takrorlansa, sabab odatda ishni tashkil etishda bo‘ladi: haddan tashqari yuklangan patnislar, beqaror stellajlar, iflos idishlarni qaytarish zonasining torligi, idish yuvish mashinasining qattiq rejimi. Agar ko‘proq yangi xodimlar sindirsa — yo‘l-yo‘riq berish kerak. Sinish yozuvlari idishlarni inventarizatsiya qilishda ham yordam beradi: kamomadni hujjat bilan izohlash mumkin.",
        ],
      },
      {
        heading: "HACCP dasturi bilan bog‘liqlik",
        paragraphs: [
          "Shisha va chinni siniqlari — korxona TR TS 021/2011 bo‘yicha xavflar tahlilida hisobga olishi kerak bo‘lgan fizik xavf. Singan idishlarni hisobga olish — bu xavfni boshqarishning oddiy va tekshirsa bo‘ladigan chorasi. Sinishdagi harakatlar tartibini qisqa yo‘riqnoma bilan mustahkamlab, uni bar va yuvish joyiga osib qo‘yish qulay.",
        ],
      },
      {
        heading: "Telefonda singan idishlar jurnali",
        paragraphs: [
          "WeSetup’da ofitsiant yoki idish yuvuvchi yozuvni yarim daqiqada kiritadi: ro‘yxatdan buyum va joyni tanlaydi, siniqlar yig‘ilganini va yaqinda mahsulotlar bo‘lgan-bo‘lmaganini belgilaydi. Vaqt avtomatik qayd etiladi, rahbar smena davomidagi holatlarni va sabablar bo‘yicha statistikani ko‘radi, jurnal esa PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro: `Bunday hisob yo‘qligi uchun alohida jarima yo‘q: bu korxonaning ichki tartibi. Ammo mehmon taomda siniq topsa, korxona xavfli mahsulot va sifatsiz xizmat uchun javob beradi, siniqlarni yig‘ish haqidagi yozuvlar esa choralar ko‘rilganini ko‘rsatishning kam sonli usullaridan biri. ${KOAP_INTRO}`,
      items: [`${FINE_14_43};`, FINE_14_4],
      note: NOTE,
    },
  },
};
