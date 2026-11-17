/**
 * Uskunalar, favqulodda vaziyatlar, basseynlar, sterilizatsiya, tibbiy
 * chiqindilar va ichki auditlar jurnallari sahifalari bloklarining o‘zbekcha
 * tarjimasi (spec journal-page-content-i18n-2026-11): to‘ldirish namunasi,
 * bo‘limlar va jarimalar. Shakli va jarimalardagi raqamlar rus manbasi
 * (../equipment.ts) bilan bir xil.
 */

import type { JournalPageContent } from "../types";

const NOTE =
  "Summalar RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksining (KoAP) 2026-yil noyabr holatidagi tahririga ko‘ra keltirilgan.";

const FINE_6_6 =
  "RF KoAP 6.6-moddasi — aholini ovqatlantirishni tashkil etishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 20 000 rubldan 40 000 rublgacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish;";
const FINE_6_3 =
  "RF KoAP 6.3-moddasi — aholining sanitariya-epidemiologik osoyishtaligini ta’minlash sohasidagi qonunchilikni buzish: yuridik shaxslar uchun 10 000 rubldan 20 000 rublgacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish;";
const FINE_6_4 =
  "RF KoAP 6.4-moddasi — xonalar, binolar, inshootlar va uskunalardan foydalanishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 10 000 rubldan 20 000 rublgacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish;";
const FINE_14_43 =
  "RF KoAP 14.43-moddasi — texnik reglamentlar (TR TS 021/2011) talablarini buzish: yakka tartibdagi tadbirkorlar (YaTT) uchun 20 000 rubldan 30 000 rublgacha, yuridik shaxslar uchun 100 000 rubldan 300 000 rublgacha jarima;";
const FINE_14_4 =
  "RF KoAP 14.4-moddasining 1-qismi — sifatsiz xizmat ko‘rsatish: yuridik shaxslar uchun 20 000 rubldan 30 000 rublgacha jarima;";

/** Ro‘yxatning oxirgi bandi: nuqtali vergul o‘rniga nuqta. */
const last = (item: string) => item.replace(/;$/, ".");

export const EQUIPMENT_PAGE_CONTENT_UZ: Record<string, JournalPageContent> = {
  equipment_maintenance: {
    sample: {
      caption:
        "Bir oylik yozuvlar shunday ko‘rinadi: har bir uskuna bo‘yicha ish turi, ijrochi, natija va keyingi texnik xizmat sanasi. Rejali texnik xizmat ham, pudratchi bajargan ishlar ham bitta jadvalda yuritiladi.",
      columns: ["Sana", "Uskuna", "Ish turi", "Ijrochi", "Natija", "Keyingi texnik xizmat"],
      rows: [
        ["04.11.2026", "Bug‘-konvektomat, issiq sex", "Bug‘ generatorini tozalash, eshik zichlagichini tekshirish", "«TexServis» MChJ, Lebedev K. A.", "Soz, 112-son dalolatnoma", "04.02.2027"],
        ["06.11.2026", "1-sonli sovutish kamerasi, ombor", "Kondensatorni tozalash, sovutish agenti bosimini tekshirish", "«Xolod-Servis» MChJ, Orlov P. S.", "Soz, 87-son dalolatnoma", "06.12.2026"],
        ["10.11.2026", "Idish yuvish mashinasi, yuvish xonasi", "Filtrlarni almashtirish, chayish haroratini tekshirish", "Novikov D. V., texnik", "Soz", "10.12.2026"],
        ["14.11.2026", "Go‘sht maydalagich, go‘sht sexi", "Pichoq va panjaralarni charxlash, reduktorni moylash", "Novikov D. V., texnik", "Soz", "14.01.2027"],
        ["16.11.2026", "So‘rish soyaboni, issiq sex", "Yog‘ ushlagich filtrlarni tozalash", "Kozlov A. A.", "Bitta filtr qiyshaygan — yangisi buyurtma qilindi", "23.11.2026"],
      ],
    },
    sections: [
      {
        heading: "Texnik xizmat hisobini kim yuritadi va kim javob beradi",
        paragraphs: [
          "Hisobni mahsulot xavfsizligi uskunaning sozligiga bog‘liq bo‘lgan korxonalar yuritadi: restoranlar, oshxonalar, novvoyxonalar, yarim tayyor mahsulot sexlari, keytering. Mas’ul shaxs buyruq bilan tayinlanadi — odatda bosh muhandis, kichik kafeda esa boshqaruvchi yoki bosh oshpaz. U jadval tuzadi, servisni chaqiradi va ishlar bajarilganini tekshiradi.",
          "Bajarilgan ish haqidagi yozuvni xizmat ko‘rsatgan kishi kiritadi: shtatdagi texnik yoki pudratchi ustasi. Servis tashkiloti o‘z dalolatnomasini bersa, uning raqami qatorga yoziladi, hujjatning o‘zi esa yonida saqlanadi — shunda tekshiruvchi yozuvni ham, birlamchi hujjatni ham ko‘radi.",
        ],
      },
      {
        heading: "Texnik xizmat jadvalini qanday tuzish kerak",
        bullets: [
          "Uskunalar ro‘yxatini inventar raqamlari bilan tuzing: issiqlik, sovutish, mexanik va yuvish uskunalari, ventilyatsiya.",
          "Har bir uskuna uchun davriylikni chamalab belgilamang — uni ishlab chiqaruvchi zavod pasportidan yoki servis tashkiloti bilan tuzilgan shartnomadan oling.",
          "Kritik uskunalarni belgilang: haroratni ushlab turadigan hamma narsa (kameralar, shok muzlatish shkaflari, marmitlar) hamda yuvadigan va zararsizlantiradigan barcha uskunalar.",
          "Sanalarni shunday taqsimlangki, xizmat ko‘rsatish eng band soatlarga to‘g‘ri kelmasin va barcha sovutish uskunalarini bir vaqtda ishdan chiqarmasin.",
          "Jadvalni rahbarga tasdiqlating va uskuna sotib olinganda yoki hisobdan chiqarilganda uni yangilab boring.",
        ],
      },
      {
        heading: "Texnik xizmat o‘tkazilmasa yoki nosozlik topilsa nima qilish kerak",
        paragraphs: [
          "O‘tkazib yuborilgan xizmat sanani qayta yozish uchun asos emas. Qatorda ishlar bajarilmagani va sababi qayd etiladi: usta kelmadi, ehtiyot qism yo‘q. Yangi sana darhol belgilanadi, kritik uskuna uchun esa shu davrda nazorat kuchaytiriladi — masalan, kameradagi harorat tez-tez o‘lchanadi.",
          "Xizmat paytida nosozlik topilsa, uskuna ishdan chiqariladi, unga «Foydalanilmasin» yozuvi osib qo‘yiladi va mahsulot qayerga ko‘chirilgani yoziladi. Nosozlik uskunaning nosozliklar tarixi kartasiga o‘tkaziladi, jiddiy chetlanishda esa tuzatuvchi harakat (CAPA) ochiladi: sabab, choralar, muddat va natijani tekshirish.",
        ],
      },
      {
        heading: "Tekshiruvchi nimaga e’tibor beradi",
        bullets: [
          "Jadval sexlarda haqiqatda turgan uskunalarga mos keladimi va unda barcha kritik uskunalar bormi.",
          "Sababi va yangi sanasi ko‘rsatilmagan, muddati o‘tgan sanalar yo‘qmi.",
          "Bajarilgan deb belgilangan ishlar uchun pudratchi dalolatnomalari bormi.",
          "Yozuvlar boshqa jurnallar bilan mos keladimi: kameraga xizmat ko‘rsatilgan-u, undagi harorat haftalab me’yordan chiqib tursa, ikkala hujjatga ham savol tug‘iladi.",
        ],
      },
      {
        heading: "Qog‘oz o‘rniga texnik xizmatning elektron hisobi",
        paragraphs: [
          "WeSetup’da jadval uskuna kartasi bilan birga saqlanadi, har bir uskunaga esa QR kod yopishtirish mumkin: usta uni telefon bilan skanerlaydi, bajarilgan ishlarni belgilaydi va dalolatnoma yoki almashtirilgan detal suratini biriktiradi. Yozuv vaqti avtomatik qo‘yiladi, tuzatishlar tarixda ko‘rinadi. Mas’ul shaxs texnik xizmat muddati yaqinlashganda oldindan eslatma oladi va muddati o‘tgan bandlarni ko‘radi, tekshiruv oldidan esa jadval va yozuvlarni PDF formatida yuklab oladi.",
        ],
      },
    ],
    fines: {
      intro:
        "RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) texnik xizmat jadvalining o‘zi yo‘qligi uchun jarima yo‘q. Ammo uskunalar ishini nazorat qilish TR TS 021/2011 talab qiladigan HACCP tartiblariga kiradi: yozuvlarsiz texnika sozligini tasdiqlashning imkoni yo‘q, nosoz uskuna ishlatilayotganini esa inspektor qoidabuzarlik sifatida qayd etadi:",
      items: [FINE_6_4, FINE_6_6, last(FINE_14_43)],
      note: `${NOTE} Nosoz muzlatkich yoki idish yuvish mashinasi ko‘pincha mahsulotga oid da’volarga ham sabab bo‘ladi.`,
    },
  },

  breakdown_history: {
    sample: {
      caption:
        "Bitta sovutish kamerasining bir yillik kartasi shunday ko‘rinadi: har bir nosozlik — alomatlari, sababi, ta’miri, to‘xtab qolish vaqti va narxi bilan alohida qator. Sovutish agentining ikki marta sizib chiqishidan nosozlik takrorlanayotgani allaqachon ko‘rinib turibdi.",
      columns: ["Sana", "Nima sezildi", "Sabab", "Nima qilindi", "To‘xtab qolish", "Narxi, ₽", "Ijrochi"],
      rows: [
        ["12.03.2026", "Kamerada +2…+6 °C o‘rniga +9 °C", "Ulanish joyidan sovutish agenti sizib chiqqan", "Kavsharlash, qayta to‘ldirish", "6 soat", "8 500", "«Xolod-Servis» MChJ"],
        ["28.07.2026", "Kompressor yoqilmayapti", "Qizib ketish, kondensator iflos", "Kondensatorni tozalash, releni almashtirish", "4 soat", "5 200", "«Xolod-Servis» MChJ"],
        ["15.09.2026", "Bug‘latgichda muz qatlami", "Eshik zichlagichi yirtilgan", "Zichlagichni almashtirish", "2 soat", "3 900", "Novikov D. V."],
        ["09.11.2026", "Ertalab kamerada +10 °C, mahsulot ko‘chirildi", "Sovutish agenti yana sizib chiqqan", "Quvurning bir qismini almashtirish, qayta to‘ldirish", "9 soat", "14 300", "«Xolod-Servis» MChJ"],
      ],
    },
    sections: [
      {
        heading: "Texnik xizmat jadvali bo‘lsa, nosozliklar tarixi nega kerak",
        paragraphs: [
          "Texnik xizmat jadvali rejali ishlarni ko‘rsatadi, nosozliklar kartasi esa rejadan tashqari yuz bergan voqealarni. Ular birgalikda uskunaning to‘liq tarixini beradi: necha marta ishdan chiqqani, qanday sabablarga ko‘ra, ta’mirlar qanchaga tushgani va sex usiz necha soat ishlagani. Ichki auditor ham, HACCP bo‘yicha tashqi auditor ham aynan shu uyg‘unlikka qaraydi.",
          "Karta har bir kritik uskunaga ochiladi — sovutish kameralari va shkaflari, shok muzlatgichlar, bug‘-konvektomatlar, idish yuvish mashinalari. Uni uskunaga mas’ul shaxs — bosh muhandis, boshqaruvchi yoki bosh oshpaz yuritgani qulay.",
        ],
      },
      {
        heading: "Ta’mirdan keyin kartani qanday to‘ldirish kerak",
        bullets: [
          "Sanani va nosozlik qanday sezilganini yozing: termometr bo‘yicha, ovozdan, oshpazning shikoyatidan.",
          "Diagnostikadan so‘ng sababni ustaning so‘zlaridan kiriting — «buzildi» deb emas, aniq qaysi qism ekanini.",
          "Nima qilinganini ko‘rsating: ta’mir, detalni almashtirish, vaqtincha o‘chirish.",
          "To‘xtab qolish vaqtini va shu vaqtda mahsulot yoki jarayon qayerga ko‘chirilganini belgilang.",
          "Narxni hamda pudratchi dalolatnomasi yoki hisob-fakturasi raqamini yozing.",
        ],
      },
      {
        heading: "Ta’mirlashmi yoki almashtirishmi: qaror qanday qabul qilinadi",
        paragraphs: [
          "Qaror taxmin bilan emas, faktlar asosida qabul qilinadi. Almashtirish haqida o‘ylashga asos: bitta sabab takrorlanadi, bir yillik ta’mir xarajatlari yangi uskuna narxiga yaqinlashadi, to‘xtab qolish mahsulotni hisobdan chiqarishga olib keladi. Nosozlik takrorlansa, kartaga sababi tahlil qilingan tuzatuvchi harakatga (CAPA) havola qo‘shiladi — aks holda usta har chorakda freon to‘ldirib yuraveradi.",
          "Barcha kartalar bo‘yicha jamlanma byudjet uchun ham foydali: qaysi sex va qaysi turdagi uskuna eng qimmatga tushayotgani ko‘rinadi.",
        ],
      },
      {
        heading: "Nosozlik paytida mahsulot bilan nima qilish kerak",
        paragraphs: [
          "Karta uskuna haqida, ammo uning yonida doimo mahsulot taqdiri haqidagi yozuv ham bo‘lishi kerak. Kameradagi harorat ruxsat etilgan chegaradan chiqsa, mas’ul shaxs mahsulot qancha vaqt chetlanish holatida bo‘lganini baholaydi va qaror qiladi: ishlatishga ruxsat berish, qayta ishlash yoki hisobdan chiqarish. Bu avariyalar va favqulodda vaziyatlar jurnalida yoki hisobdan chiqarish dalolatnomasida qayd etiladi, kartada esa shu yozuvga havola qo‘yiladi.",
        ],
      },
      {
        heading: "Dalolatnomalar papkasi o‘rniga uskunaning elektron kartasi",
        paragraphs: [
          "WeSetup’da nosozliklar tarixi uskuna kartasida texnik xizmat jadvali yonida saqlanadi. Nosozlikni sezgan xodim uskunadagi QR kodni skanerlaydi va telefondan surat biriktirib xabar beradi; mas’ul shaxs darhol bildirishnoma oladi, usta esa keyinroq sabab va narxni qo‘shib yozadi. Har bir tuzatish tarixda ko‘rinadi, istalgan davr uchun kartani auditorga PDF formatida yuklab berish mumkin.",
        ],
      },
    ],
    fines: {
      intro:
        "Uskuna nosozliklari tarixi kartasi HACCP tizimining ichki hujjati, u yo‘qligi uchun alohida jarima belgilanmagan. Xavf boshqa joyda: ishdan chiqishlar hisobga olinmasa, tekshiruvchi TR TS 021/2011 talab qiladigan uskunalarni nazorat qilish tartiblari joriy etilmagan deb hisoblashi mumkin, nosoz uskunaning ishlatilishi esa o‘z-o‘zidan qoidabuzarlikdir:",
      items: [FINE_6_4, last(FINE_14_43)],
      note: NOTE,
    },
  },

  equipment_calibration: {
    sample: {
      caption:
        "Kulinariya bo‘limi bor kafening o‘lchash vositalari ro‘yxati shunday ko‘rinadi: har bir asbobning zavod raqami, joyi, qiyoslash sanasi, amal qilish muddati va qiyoslash nima bilan tasdiqlangani. 1-sonli kameradagi termometrni qiyoslashga yuborish vaqti keldi.",
      columns: ["Asbob", "Zavod raqami", "Qayerda ishlatiladi", "Qiyoslash sanasi", "Amal qilish muddati", "Tasdiq"],
      rows: [
        ["Elektron zond-termometr", "TP-30412", "Issiq sex", "12.01.2026", "11.01.2027", "FGIS «Arshin»dagi yozuv"],
        ["Elektron savdo tarozisi", "0458731", "Kulinariya kassasi", "20.03.2026", "19.03.2027", "«Arshin»dagi yozuv, guvohnoma"],
        ["Muzlatkich termometri", "1123", "1-sonli sovutish kamerasi", "05.12.2025", "04.12.2026", "FGIS «Arshin»dagi yozuv"],
        ["Termogigrometr", "TG-7781", "Quruq mahsulotlar ombori", "18.06.2026", "17.06.2027", "FGIS «Arshin»dagi yozuv"],
        ["Platformali tarozi", "220917", "Xomashyoni qabul qilish", "02.11.2026", "01.11.2027", "«Arshin»dagi yozuv, qiyoslash belgisi"],
      ],
    },
    sections: [
      {
        heading: "Qaysi asboblarni qiyoslash kerak",
        paragraphs: [
          "O‘lchovlar birligini ta’minlash bo‘yicha davlat tomonidan tartibga solinadigan sohada qo‘llaniladigan o‘lchash vositalari qiyoslanadi — buni 102-FZ-son Federal qonun belgilaydi. Umumiy ovqatlanish va oziq-ovqat ishlab chiqarishida bu, avvalo, xaridor uchun mahsulot tortiladigan tarozilar, shuningdek termometrlar, zond-termometrlar va termogigrometrlardir: korxona ularning ko‘rsatkichlari orqali saqlash va tayyorlashga oid majburiy talablarga rioya qilinishini tasdiqlaydi.",
          "Asbob tasdiqlangan turga mansub, ya’ni O‘lchovlar birligini ta’minlash bo‘yicha Federal axborot fondiga kiritilgan bo‘lishi kerak. Turi tasdiqlanmagan maishiy termometrni qiyoslab bo‘lmaydi va tekshiruvda uning ko‘rsatkichlari qabul qilinmaydi. Faqat ichki sozlash uchun kerak bo‘ladigan asboblarni kalibrlash kifoya, ammo ularni ro‘yxatda alohida belgilab qo‘ygan ma’qul.",
        ],
      },
      {
        heading: "Hozir qiyoslash nima bilan tasdiqlanadi",
        paragraphs: [
          "Qiyoslash natijasi u haqidagi ma’lumotlar FGIS «Arshin»ga kiritilgan bo‘lsagina haqiqiy hisoblanadi. Qog‘oz guvohnoma egasining arizasiga ko‘ra beriladi, asbobning o‘ziga qiyoslash belgisi qo‘yilishi mumkin. Shuning uchun hisobda faqat guvohnoma raqamini emas, «Arshin»dagi yozuvga havolani ham saqlash qulay — u orqali inspektor asbobni Rosstandart saytida bir daqiqada tekshiradi.",
          "Qiyoslashlararo oraliqni o‘zingiz tanlamaysiz: u tur tavsifida va o‘sha yozuvda ko‘rsatilgan. Hisobdagi «amal qilish muddati» sanasi unga mos kelishi kerak.",
        ],
      },
      {
        heading: "Qiyoslashni bosqichma-bosqich qanday tashkil etish kerak",
        bullets: [
          "Barcha o‘lchash vositalari ro‘yxatini zavod raqamlari va o‘rnatilgan joylari bilan tuzing.",
          "Har bir asbobni FGIS «Arshin»dan toping: turi tasdiqlangan, qiyoslash amalda.",
          "Qiyoslashni o‘tkazadigan akkreditatsiyalangan tashkilot bilan kelishing — ko‘pincha bu mintaqaviy standartlashtirish va metrologiya markazi bo‘ladi.",
          "Asboblarni navbat bilan yuboring, shunda joyida doimo qiyoslangan zaxira termometr qoladi.",
          "Asbob qaytgach, yangi sana, muddat va yozuvga havolani kiriting.",
        ],
      },
      {
        heading: "Muddat o‘tgan bo‘lsa yoki asbob noto‘g‘ri ko‘rsatsa nima qilish kerak",
        paragraphs: [
          "Qiyoslash muddati o‘tgan asbob «oy oxirigacha» emas, darhol foydalanishdan chiqariladi: uning ko‘rsatkichlarini harorat jurnallarida ishlatib bo‘lmaydi. Shu davrga qiyoslangan zaxira asbob qo‘yiladi va hisobda belgi qilinadi. Termometr tushib ketgan bo‘lsa, aniq noto‘g‘ri qiymatlarni ko‘rsatsa yoki plombasi shikastlangan bo‘lsa, u ham ishdan olinadi va ta’mir hamda navbatdan tashqari qiyoslashga yuboriladi.",
          "Muddat tugaganidan keyin shu asbob bilan qilingan yozuvlarni alohida ko‘rib chiqing: ularda kritik qiymatlar bo‘lgan bo‘lsa, mahsulotni baholash kerak-kerakmasligini mas’ul shaxs hal qiladi.",
        ],
      },
      {
        heading: "Guvohnomalar papkasi o‘rniga asboblarning elektron ro‘yxati",
        paragraphs: [
          "WeSetup’da har bir o‘lchash vositasi — zavod raqami, qiyoslash muddati, guvohnoma surati yoki «Arshin»dagi yozuvga havolasi bo‘lgan alohida karta. Muddati o‘tgan va tugayotgan asboblar umumiy ro‘yxatda ajratib ko‘rsatiladi, mas’ul shaxs oldindan eslatma oladi, o‘zgarishlar tarixi esa muddatni kim va qachon yangilaganini ko‘rsatadi. Ro‘yxat tekshiruvchi uchun PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Ro‘yxatning o‘zi uchun jarima solinmaydi — qiyoslash majburiy bo‘lgan joyda amaldagi qiyoslashsiz asboblardan foydalanilgani uchun jazolanadi. Bundan tashqari, bunday asbobning ko‘rsatkichlari harorat talablariga rioya qilinganini tasdiqlamaydi va sanitariya jurnallaridagi yozuvlar dalil sifatidagi kuchini yo‘qotadi:",
      items: [
        "RF KoAP 19.19-moddasi — o‘lchovlar birligini ta’minlash sohasidagi majburiy talablarni buzish, shu jumladan qiyoslanmagan o‘lchash vositalarini qo‘llash; jarima miqdori moddaning qismiga va huquqbuzar kimligiga bog‘liq;",
        last(FINE_6_6),
      ],
      note: `${NOTE} 19.19-modda bo‘yicha jarima miqdorini kodeksning amaldagi tahririda aniqlashtiring.`,
    },
  },

  accident_journal: {
    sample: {
      caption:
        "Bir oylik avariya yozuvlari shunday ko‘rinadi: nima yuz bergani, nimaga ta’sir qilgani, qanday choralar ko‘rilgani va mahsulot bo‘yicha qanday qaror qabul qilingani. Har bir qator shunchaki tavsif bilan emas, qaror bilan yopiladi.",
      columns: ["Sana, vaqt", "Nima yuz berdi", "Nimaga ta’sir qildi", "Ko‘rilgan choralar", "Mahsulot bo‘yicha qaror", "Mas’ul"],
      rows: [
        ["02.11.2026, 06:40", "Tunda 2-sonli sovutish kamerasi o‘chib qolgan, ertalab +11 °C", "Sut mahsulotlari, 42 kg", "Mahsulot ajratildi, usta chaqirildi", "42 kg hisobdan chiqarildi, 37-son dalolatnoma", "Ivanova M. P."],
        ["09.11.2026, 13:15", "Elektr energiyasi 1,5 soatga o‘chdi", "Issiq sex, muzlatkichlar", "Ovqat tayyorlash to‘xtatildi, kamera eshiklari ochilmadi", "Ruxsat berildi: kameralarda +6 °C dan oshmagan", "Petrov S. A."],
        ["12.11.2026, 10:05", "Quruq mahsulotlar ombori ustidagi shiftdan suv oqdi", "Un, 3 qop", "Qoplar olib qo‘yildi, joy o‘rab qo‘yildi, bino boshqaruvchisi chaqirildi", "3 qop hisobdan chiqarildi, qolganiga ko‘rikdan so‘ng ruxsat berildi", "Ivanova M. P."],
        ["16.11.2026, 18:30", "Issiq suv yo‘q", "Yuvish xonasi", "Idishlar qozonlarda isitilgan suv bilan yuvilmoqda, avariya xizmati chaqirildi", "Mahsulotga ta’sir qilmadi", "Petrov S. A."],
      ],
    },
    sections: [
      {
        heading: "Nimani avariya yoki favqulodda vaziyat deb hisoblash kerak",
        paragraphs: [
          "Bu yerga ishning odatiy borishidan chetga chiqadigan va mahsulot xavfsizligiga ta’sir qilishi mumkin bo‘lgan hamma narsa yoziladi. Xodimlar har safar yozish-yozmaslikni o‘zlari hal qilmasligi uchun ro‘yxatni HACCP dasturida mustahkamlab qo‘ygan ma’qul.",
        ],
        bullets: [
          "Sovutish uskunasining ishdan chiqishi va haroratning ruxsat etilgan chegaradan chiqishi.",
          "Elektr energiyasi, sovuq yoki issiq suv, ventilyatsiyaning o‘chishi.",
          "Suv oqishi, kanalizatsiyaning tiqilishi, omborni suv bosishi.",
          "Ishlab chiqarish hududida kemiruvchilar yoki hasharotlar paydo bo‘lishi.",
          "Ochiq mahsulot yaqinida shisha sinishi, xomashyoda begona narsalar topilishi.",
        ],
      },
      {
        heading: "Dastlabki soatlardagi harakatlar tartibi",
        bullets: [
          "Xavfli jarayonni to‘xtatish: ovqat tayyorlashni to‘xtatish, muzlatkichlarni keraksiz ochmaslik, joyni o‘rab qo‘yish.",
          "Mas’ul shaxsga — bosh oshpaz, ishlab chiqarish mudiri yoki boshqaruvchiga xabar berish.",
          "Mahsulotni himoya qilish: soz uskunaga ko‘chirish, shubhali partiyani ajratib, «Foydalanilmasin» deb belgilash.",
          "Faktlarni qayd etish: aniqlangan vaqt, termometr ko‘rsatkichlari, suratlar.",
          "Servis yoki avariya xizmatini chaqirish va muammo qachon bartaraf etilganini yozib qo‘yish.",
        ],
      },
      {
        heading: "Mahsulot taqdirini qanday hal qilish kerak",
        paragraphs: [
          "Qarorni avariyani aniqlagan kishi emas, mas’ul shaxs qabul qiladi. Mahsulot turi, harorat va chetlanishda o‘tgan vaqt hisobga olinadi: bir necha soat issiqda qolgan sovutilgan go‘sht yoki sut mahsulotlari ishlatishga qo‘yilmaydi, suv oqqanidan keyin esa qadoqi butun va quruq bo‘lsa, bakaleya mahsulotlariga ruxsat berish mumkin. Xavfsizlikni baholashning imkoni bo‘lmasa, mahsulot hisobdan chiqariladi, dalolatnoma raqami esa avariya qatoriga yoziladi.",
        ],
      },
      {
        heading: "Sabablarni tahlil qilish va tuzatuvchi harakatlar",
        paragraphs: [
          "Avariyani bartaraf etish — ishning yarmi. Keyin mas’ul shaxs sababni aniqlaydi va takrorlanmasligi uchun nima qilishni hal qiladi: kamera signalizatsiyasini tekshirish, yozib boruvchi termometrlar uchun zaxira quvvat manbaini o‘rnatish, tom ta’miri bo‘yicha kelishish. Yirik holatlar uchun ijrochi va muddat ko‘rsatilgan tuzatuvchi harakat (CAPA) ochiladi, ichki auditda esa u bajarilgani tekshiriladi.",
          "Bitta uskunaning takroriy ishdan chiqishlari nosozliklar tarixi kartasiga o‘tkaziladi — bu uni almashtirish haqidagi qaror uchun dalil.",
        ],
      },
      {
        heading: "Qog‘oz o‘rniga avariyalarni elektron qayd etish",
        paragraphs: [
          "WeSetup’da favqulodda vaziyat haqida telefondan xabar berish mumkin: xodim termometr yoki suv oqayotgan joyni suratga oladi, vaqt avtomatik qo‘yiladi, rahbar esa darhol Telegramda bildirishnoma oladi. Mas’ul shaxs choralar va mahsulot bo‘yicha qarorni qo‘shib yozadi hamda yozuvni hisobdan chiqarish dalolatnomasi va CAPA bilan bog‘laydi. Tuzatishlar tarixi saqlanadi, davr bo‘yicha yozuvlar PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Bunday jurnal yo‘qligi uchun alohida modda yo‘q — bu HACCP tizimining ichki hujjati. Javobgarlik oqibatlar uchun yuzaga keladi: o‘chib qolgan muzlatkichdagi mahsulot taomga yoki peshtaxtaga tushsa, bu sanitariya talablari va texnik reglamentning buzilishi hisoblanadi:",
      items: [FINE_6_6, last(FINE_14_43)],
      note: `${NOTE} Avariyadan keyin mahsulot baholangani va hisobdan chiqarilgani haqidagi yozuv — nizoni ko‘rib chiqishda asosiy dalil.`,
    },
  },

  inventory_condition: {
    sample: {
      caption:
        "Bitta ko‘rik yozuvlari shunday ko‘rinadi: har bir sex bo‘yicha qaysi anjomlar tekshirilgani, ularning holati va shikastlanganlari bilan nima qilingani. Soz anjomlarni guruh qilib, shikastlanganlarini esa donalab yozish mumkin.",
      columns: ["Sana", "Sex", "Anjom", "Material", "Holati", "Nima qilindi", "Mas’ul"],
      rows: [
        ["16.11.2026", "Sovuq sex", "«SO», «OS» taxtalari — 4 dona", "Plastik", "Soz", "—", "Ivanova M. P."],
        ["16.11.2026", "Go‘sht sexi", "«SM» taxtasi", "Plastik", "Chetida yoriq, chuqur kesiklar", "Olib qo‘yildi, yangisiga almashtirildi", "Ivanova M. P."],
        ["16.11.2026", "Issiq sex", "Kurakchalar, cho‘michlar — 6 dona", "Zanglamaydigan po‘lat", "Soz", "—", "Ivanova M. P."],
        ["16.11.2026", "Qandolat sexi", "5 l konteyner", "Oziq-ovqat plastigi", "Qopqog‘i uchgan, bo‘lagi topildi", "Olib qo‘yildi, utilizatsiya qilindi", "Ivanova M. P."],
        ["16.11.2026", "Yuvish xonasi", "Metall gubka", "Po‘lat", "Qatlamlanib ketmoqda", "Plastik cho‘tkaga almashtirildi", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Anjomlarni kim ko‘zdan kechiradi va kim javob beradi",
        paragraphs: [
          "Ko‘rikni bosh oshpaz, su-shef yoki brigadir — uchastkadagi barcha anjomlarni biladigan kishi o‘tkazadi. Mas’ul shaxs va davriylik HACCP dasturining jismoniy xavflar bo‘yicha tartibida mustahkamlanadi. Smena o‘rtasida uchgan joyni sezgan oshpaz rejali ko‘rikni kutmaydi: u buyumni darhol chetga olib qo‘yadi va mas’ul shaxsga xabar beradi, u esa yozuv kiritadi.",
        ],
      },
      {
        heading: "Anjom qanday belgilarda olib qo‘yiladi",
        bullets: [
          "Kesish taxtalari: chuqur kesiklar, yoriqlar, qatlamlanish, uchib ketgan burchaklar.",
          "Pichoqlar: tig‘dagi uchgan joylar va tishiklar, qimirlaydigan yoki yorilgan dasta.",
          "Plastik idishlar va qopqoqlar: yoriqlar, uchgan joylar, issiq yuvishdan qiyshayish.",
          "Metall anjomlar: zang, qoplamaning ko‘chishi, o‘tkir qirralar, tushib qolgan parchin mixlar va vintlar.",
          "Elaklar, ko‘pirtirgichlar, qirg‘ichlar: yirtilgan to‘r, sinib qolgan simlar, chiqib ketayotgan simchalar.",
          "Sexlardagi shisha va keramika idishlar: uchgan joylar va yoriqlar.",
        ],
      },
      {
        heading: "Ko‘rik rasmiyatchilikka aylanmasligi uchun uni qanday o‘tkazish kerak",
        paragraphs: [
          "Sexlar bo‘yicha anjomlar ro‘yxatini tutib, xotiraga emas, shu ro‘yxatga tayanib yurish qulay. Ro‘yxat xarid va hisobdan chiqarishda yangilanadi, aks holda ko‘rik tezda «hammasi soz» degan belgiga aylanib qoladi. Taxta va pichoqlarning rangli markirovkasi bir sexning anjomi boshqasiga tushib qolganini sezishga yordam beradi.",
          "Shikast allaqachon ishlatilgan anjomda topilsa, mas’ul shaxs shu kuni u bilan tayyorlangan mahsulotni tekshiradi: siniqlar yoki qirindilar tushish xavfi bo‘lsa, mahsulot berishga ruxsat etilmaydi.",
        ],
      },
      {
        heading: "Buyumdan bo‘lak uchib, u topilmasa",
        paragraphs: [
          "Eng xavfli holat — pichoq yoki konteynerning bir bo‘lagi yetishmaydi, u qayerdaligi esa noma’lum. Uchastkada ish to‘xtatiladi, yaqinda bo‘lgan ish yuzalari, idishlar va mahsulot ko‘zdan kechiriladi. Topilgan bo‘lak qayd etiladi, topilmasa — bu uchastkadagi mahsulotga ruxsat bermaslik uchun asos. Holat favqulodda vaziyat sifatida yoziladi, takrorlansa, tuzatuvchi harakat ochiladi: material, yetkazib beruvchi yoki yuvish tartibini o‘zgartirish.",
        ],
      },
      {
        heading: "Qog‘oz o‘rniga anjomlarni elektron ko‘rikdan o‘tkazish",
        paragraphs: [
          "WeSetup’da sexlar bo‘yicha anjomlar ro‘yxati bir marta yuklanadi, ko‘rik paytida esa mas’ul shaxs telefondan faqat chetlanishlarni belgilaydi va shikast suratini biriktiradi. Ko‘rik haqidagi eslatma HACCP dasturidagi jadval bo‘yicha keladi, vaqt avtomatik qayd etiladi, tuzatishlar tarixda ko‘rinadi. Audit oldidan yozuvlar PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Bu jurnal yo‘qligi uchun alohida jarima yo‘q — bu HACCP tizimining ichki tartibi. Ammo TR TS 021/2011 mahsulot xavfsizligini barcha bosqichlarda ta’minlashni talab qiladi, yozuvlarsiz esa jismoniy xavflar nazorat qilinayotganini ko‘rsatishning imkoni yo‘q. Taomdagi begona narsa esa allaqachon to‘g‘ridan-to‘g‘ri qoidabuzarlik:",
      items: [FINE_14_43, last(FINE_6_6)],
      note: NOTE,
    },
  },

  pool_water_control: {
    sample: {
      caption:
        "Ikki basseynli fitnes markazining bir kunlik yozuvlari shunday ko‘rinadi: ochilishdan oldingi o‘lchov va kun davomidagi o‘lchovlar, har birida harorat, xlor, pH va oldingi o‘lchovdan beri kelgan tashrifchilar soni. Qatorlardan yuklama bog‘langan xlorga qanday ta’sir qilishi ko‘rinadi.",
      columns: ["Sana, vaqt", "Basseyn", "Suv, °C", "Erkin xlor, mg/l", "Bog‘langan xlor, mg/l", "pH", "Tashrifchilar", "Mas’ul"],
      rows: [
        ["16.11.2026, 07:00", "Katta", "27,0", "0,4", "0,1", "7,4", "—", "Kuznetsov D. I."],
        ["16.11.2026, 12:00", "Katta", "27,5", "0,5", "0,2", "7,3", "48", "Kuznetsov D. I."],
        ["16.11.2026, 17:00", "Katta", "27,5", "0,4", "0,2", "7,5", "63", "Kuznetsov D. I."],
        ["16.11.2026, 07:10", "Bolalar", "30,0", "0,3", "0,1", "7,4", "—", "Kuznetsov D. I."],
        ["16.11.2026, 13:00", "Bolalar", "30,5", "0,4", "0,2", "7,2", "21", "Kuznetsov D. I."],
      ],
    },
    sections: [
      {
        heading: "O‘lchovlarni kim o‘tkazadi va kim javob beradi",
        paragraphs: [
          "Fitnes markazlari, mehmonxonalar, spa majmualari va bolalar markazlarida o‘lchovlarni suv tayyorlash operatori yoki basseyn texnigi, ular bo‘lmagan joyda esa o‘qitilgan administrator o‘tkazadi. Suv sifati uchun mas’ul shaxs buyruq bilan tayinlanadi: u yozuvlarni tekshiradi va chetlanish bo‘lganda basseynni yopish haqida qaror qabul qiladi.",
          "Basseynlardan foydalanishga oid talablar SP 2.1.3678-20 bilan belgilangan, aniq obyekt uchun ko‘rsatkichlarning ruxsat etilgan qiymatlari va o‘lchovlar davriyligi esa ishlab chiqarish nazorati dasturida yoziladi. Tekshiruvchi yozuvlarni aynan shu dastur bilan solishtiradi.",
        ],
      },
      {
        heading: "O‘z o‘lchovlari va laboratoriya nazorati",
        paragraphs: [
          "Jurnaldagi yozuvlar — xodimlar test-to‘plam yoki fotometr bilan o‘zlari o‘tkazadigan tezkor nazorat. U laboratoriya tadqiqotlarining o‘rnini bosmaydi: mikrobiologik va kimyoviy ko‘rsatkichlar uchun namunalarni akkreditatsiyalangan laboratoriya ishlab chiqarish nazorati dasturidagi davriylikda oladi. Laboratoriya bayonnomalari jurnal yonida saqlanadi — tekshiruvchi ularni har kungi raqamlar bilan solishtiradi.",
          "Reaktivlar va test-chiziqlar yaroqlilik muddati ichida, asbob esa soz bo‘lishi kerak, aks holda jurnaldagi raqamlar hech narsani tasdiqlamaydi.",
        ],
      },
      {
        heading: "Raqamlar halol bo‘lishi uchun o‘lchovni qanday o‘tkazish kerak",
        bullets: [
          "Namunani har safar bir joydan, reagent beriladigan joy yonidagi yuzadan emas, chuqurlikdan olish.",
          "Erkin va bog‘langan xlorni bitta asbob bilan o‘lchash va natijani darhol yozish.",
          "Birinchi o‘lchovni tashrifchilar kiritilgunga qadar, keyingilarini eng ko‘p yuklama soatlarida o‘tkazish.",
          "O‘lchovlar orasidagi tashrifchilar sonini yozish: bog‘langan xlorning ortishi odatda yuklamaga ergashadi.",
          "«Me’yorgacha» yaxlitlamaslik: chetlanish va ko‘rilgan choralar yozilgan qayd ideal raqamlar qatoridan qimmatliroq.",
        ],
      },
      {
        heading: "Ko‘rsatkich me’yordan chiqsa nima qilish kerak",
        paragraphs: [
          "Chetlanish bo‘lganda mas’ul shaxs reagentlar dozasini to‘g‘rilaydi, filtrlash va retsirkulyatsiyani tekshiradi, zarur bo‘lsa, toza suv qo‘shadi va o‘lchovni takrorlaydi. Ko‘rsatkichlar me’yorga qaytmasa, basseynga kirish tuzatilguncha yopiladi, yopilish va ochilish vaqti qayd etiladi. Takroriy chetlanishlar — suv tayyorlash uskunasini tekshirish va ijrochi hamda muddat ko‘rsatilgan tuzatuvchi harakatni yozish uchun asos.",
        ],
      },
      {
        heading: "Qog‘oz o‘rniga basseyn suvini elektron hisobga olish",
        paragraphs: [
          "WeSetup’da texnik o‘lchovni to‘g‘ridan-to‘g‘ri basseyn yonida telefondan kiritadi, vaqt avtomatik qo‘yiladi. Ishlab chiqarish nazorati dasturidagi o‘lchovlar davriyligi hujjat sozlamalarida belgilanadi, o‘tkazib yuborilgan o‘lchov haqida esa eslatma keladi. Tuzatishlar tarixda saqlanadi, yozuvga test-to‘plam suratini biriktirish mumkin, istalgan davr uchun jurnal tekshiruvchi uchun PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Jurnal yo‘qligi uchun alohida jarima yo‘q, ammo usiz obyekt suv sifatining ishlab chiqarish nazoratini tasdiqlay olmaydi. Inspektor basseyndan foydalanishga oid sanitariya talablari buzilganini qayd etadi, sifatsiz suvdan zarar ko‘rgan tashrifchi esa zararni qoplashni talab qilishga haqli:",
      items: [FINE_6_4, FINE_6_3, last(FINE_14_4)],
      note: NOTE,
    },
  },

  instrument_sterilization: {
    sample: {
      caption:
        "Manikyur va kosmetologiya xonalari bo‘lgan salonning bir ish kunidagi yozuvlari shunday ko‘rinadi: har bir yuklama — usuli, rejimi va indikator natijasi bilan alohida qator. Indikator ishlamaganidan keyingi takroriy sterilizatsiya ham jurnalda qoladi.",
      columns: ["Sana, vaqt", "Asboblar", "Usul", "Rejim", "Indikator", "Sterilizator", "Mas’ul"],
      rows: [
        ["16.11.2026, 09:10", "Kusachkalar — 3 dona, pusher — 2 dona", "Havo", "180 °C, 60 daqiqa", "Ishladi", "GP-20 quruq issiqlik sterilizatori", "Smirnova O. N."],
        ["16.11.2026, 12:40", "Qaychilar — 2 dona, kusachkalar — 2 dona", "Havo", "180 °C, 60 daqiqa", "Ishlamadi", "GP-20 quruq issiqlik sterilizatori", "Smirnova O. N."],
        ["16.11.2026, 14:00", "O‘sha asboblar — takroran", "Havo", "180 °C, 60 daqiqa", "Ishladi", "GP-20 quruq issiqlik sterilizatori", "Smirnova O. N."],
        ["16.11.2026, 16:30", "Pinsetlar — 4 dona, qisqichlar — 2 dona", "Bug‘", "132 °C, 20 daqiqa", "Ishladi", "GK-10 avtoklavi", "Petrova A. S."],
      ],
    },
    sections: [
      {
        heading: "Kim sterilizatsiya qiladi va kim javob beradi",
        paragraphs: [
          "Sterilizatsiya yozuvlari manikyur, pedikyur va kosmetologiya xizmatlari ko‘rsatadigan go‘zallik salonlariga, tatu va pirsing studiyalariga, tibbiyot va stomatologiya kabinetlariga — asbob teri yoki shilliq qavatni shikastlashi mumkin bo‘lgan barcha joylarga kerak. Sterilizatsiyani o‘qitilgan usta yoki hamshira o‘tkazadi, mas’ul shaxsni rahbar tayinlaydi. Sterilizatsiyani shartnoma asosida boshqa tashkilot bajarsa, salonda asbobni topshirish va qaytarib olish hujjatlari saqlanadi.",
        ],
      },
      {
        heading: "Sterilizatorga solishdan oldin nima qilinishi kerak",
        paragraphs: [
          "Sterilizatsiya — ishlov berishning so‘nggi bosqichi. Undan oldin asbob dezinfeksiya va sterilizatsiyadan oldingi tozalashdan o‘tadi: qon, yog‘ va yuvish eritmasi qoldiqlari sterillovchi agentga xalaqit beradi. Tozalash sifati tanlab olingan sinamalar, masalan, azopiram sinamasi bilan tekshiriladi — tartibini ishlab chiqarish nazorati dasturi va vositalar yo‘riqnomalari belgilaydi.",
          "Sikldan keyin asbob qadoqda yoki steril zonada saqlanadi; saqlash muddati qadoq turiga bog‘liq va uning yo‘riqnomasida ko‘rsatilgan. Paket mijozning ko‘z oldida ochiladi — bu asbobga ishlov berilganining eng yaxshi isboti.",
        ],
      },
      {
        heading: "Yuklama haqidagi qatorni qanday to‘ldirish kerak",
        bullets: [
          "Yuklash vaqti — u va rejim bo‘yicha sikl to‘liq bajarilgani ko‘rinadi.",
          "Asboblar ro‘yxati soni bilan; ustaning o‘z to‘plami bo‘lsa, uni ko‘rsating.",
          "Usul va rejim — «taxminan» emas, sterilizator va qadoqlash materiali yo‘riqnomasiga aniq mos holda.",
          "Indikator natijasi: ishladimi yoki yo‘qmi; ishlatilgan indikatorlarni yopishtirib qo‘yish yoki suratga olish qulay.",
          "Sterilizator va siklni o‘tkazgan kishining familiyasi.",
        ],
      },
      {
        heading: "Indikator ishlamasa yoki sterilizator nosoz ishlasa",
        paragraphs: [
          "Indikator rangini o‘zgartirmasa, butun yuklama nosteril hisoblanadi: asbob qayta qadoqlanadi va sterilizatsiya qilinadi, jurnalda esa ikkala qator ham qoladi. Takroriy sikl ham natija bermasa, sterilizator servis tekshiruvigacha ishdan chiqariladi, qabul esa zaxira to‘plam yoki bir martalik asbob bilan davom ettiriladi.",
          "Sterilizatorning o‘zi ishlab chiqaruvchi yo‘riqnomasi va ishlab chiqarish nazorati dasturidagi davriylikda texnik xizmatdan va ish samaradorligi nazoratidan o‘tadi — bu hujjatlar ham jurnal yonida saqlanadi.",
        ],
      },
      {
        heading: "Qog‘oz o‘rniga sterilizatsiyaning elektron hisobi",
        paragraphs: [
          "WeSetup’da usul va rejimlar sterilizatorlaringizga moslab sozlangan ro‘yxatdan tanlanadi, yozuv vaqti avtomatik qo‘yiladi, qatorga esa indikator suratini biriktirish mumkin. Rahbar barcha kabinetlar bo‘yicha kunlik sikllarni ko‘radi, tuzatishlar tarixda saqlanadi, jurnal esa qog‘oz blanka bilan bir xil shaklda PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Jurnal yo‘qligi uchun alohida modda yo‘q. Ammo yozuvlarsiz salon asbob SanPiN 2.1.3678-20 bo‘yicha sterilizatsiya qilinayotganini tasdiqlay olmaydi va inspektor sanitariya talablari buzilganini qayd etadi. Mijoz infeksiya yoki asorat orttirsa, bunga sifatsiz xizmat uchun javobgarlik ham qo‘shiladi:",
      items: [FINE_6_3, FINE_6_4, last(FINE_14_4)],
      note: NOTE,
    },
  },

  medical_waste_b: {
    sample: {
      caption:
        "Kosmetologiya kabinetining bir haftalik yozuvlari shunday ko‘rinadi: chiqindi turi, massasi, zararsizlantirish, qadoq va chiqindilar kimga topshirilgani. Olib ketuvchi tashkilotga topshirish dalolatnoma raqami bilan tasdiqlanadi.",
      columns: ["Sana", "Chiqindi turi", "Massa, kg", "Zararsizlantirish", "Qadoq", "Topshirildi", "Mas’ul"],
      rows: [
        ["10.11.2026", "Paxta disklari, salfetkalar, qo‘lqoplar", "0,8", "Dezinfeksiya eritmasi, 60 daqiqa", "Sariq paket", "«EkoVyvoz» MChJ, 41-son dalolatnoma", "Smirnova O. N."],
        ["10.11.2026", "Ignalar, tig‘lar", "0,2", "Dezinfeksiya eritmasi, 60 daqiqa", "O‘tkir buyumlar uchun sariq konteyner", "«EkoVyvoz» MChJ, 41-son dalolatnoma", "Smirnova O. N."],
        ["13.11.2026", "Ignasiz shpritslar, qo‘lqoplar", "0,6", "Dezinfeksiya eritmasi, 60 daqiqa", "Sariq paket", "Olib ketilguncha saqlanmoqda", "Smirnova O. N."],
        ["16.11.2026", "Mezoterapiya ignalari", "0,1", "Dezinfeksiya eritmasi, 60 daqiqa", "O‘tkir buyumlar uchun sariq konteyner", "Olib ketilguncha saqlanmoqda", "Petrova A. S."],
      ],
    },
    sections: [
      {
        heading: "Hisobni kim yuritadi va kim javob beradi",
        paragraphs: [
          "B sinfidagi chiqindilar hisobini tibbiyot markazlari, stomatologiyalar, muolaja va kosmetologiya kabinetlari, in’yeksion muolajalar qilinadigan salonlar — qon va biologik suyuqliklar bilan ifloslangan materiallar paydo bo‘ladigan barcha joylar yuritadi. Rahbar chiqindilar bilan ishlash uchun mas’ul shaxsni tayinlaydi va sxemani tasdiqlaydi: qayerda qanday chiqindilar paydo bo‘ladi, ular qanday yig‘iladi, zararsizlantiriladi va olib ketilgunga qadar qayerda saqlanadi. Yozuvlarni chiqindini qadoqlagan kishi kiritadi, mas’ul shaxs esa topshirishdan oldin ularni tekshiradi.",
        ],
      },
      {
        heading: "B sinfidagi chiqindilarni qanday yig‘ish va qadoqlash kerak",
        bullets: [
          "Chiqindilar paydo bo‘lgan joyida sariq rangli bir martalik paketlar yoki idishlarga, o‘tkir buyumlar esa teshilmaydigan konteynerlarga yig‘iladi.",
          "Paketlar va konteynerlar to‘rtdan uch qismidan ortiq to‘ldirilmaydi va ichidagisi to‘kilmaydigan qilib yopiladi.",
          "Qadoqqa «Chiqindilar. B sinfi» yozuvi, tashkilot nomi, bo‘linma, sana va mas’ul shaxsning familiyasi yoziladi.",
          "Chiqindilarni bir idishdan boshqasiga ag‘darish mumkin emas.",
          "Yopilgan qadoq olib ketilgunga qadar tashrifchilar kira olmaydigan maxsus joyda, SanPiN 2.1.3684-21 da belgilangan muddatlar doirasida saqlanadi.",
        ],
      },
      {
        heading: "Zararsizlantirish: joyida yoki olib ketuvchi tashkilotda",
        paragraphs: [
          "Bunday chiqindilar kimyoviy yoki fizik usulda — paydo bo‘lgan joyida yoki markazlashgan holda, ixtisoslashgan tashkilotda zararsizlantiriladi. Tanlangan usul chiqindilar bilan ishlash sxemasida mustahkamlanadi. Kabinet o‘zi zararsizlantirsa, jurnalda usul va vosita ko‘rsatiladi, ta’sir vaqti va konsentratsiya esa dezinfeksiya vositasi yo‘riqnomasidan olinadi. Olib ketuvchi tashkilot zararsizlantirsa, bu shartnomada yoziladi va topshirishda belgilanadi.",
        ],
      },
      {
        heading: "Olib ketishga topshirish va hujjatlar",
        paragraphs: [
          "Chiqindilarni shartnoma tuzilgan tashkilot olib ketadi. Har bir topshirish sana va massa ko‘rsatilgan dalolatnoma yoki yuk xati bilan tasdiqlanadi; hujjat raqami jurnalga yoziladi, hujjatlarning o‘zi esa u bilan birga saqlanadi. Tekshiruvchi jurnaldagi massani dalolatnomalar bilan solishtiradi: katta tafovutlar yoki uzoq vaqt chiqindi olib ketilmagan davrlar savol tug‘diradi.",
          "Paket yirtilsa yoki xodimga igna sanchilsa, tashkilotda tasdiqlangan avariya holatlari yo‘riqnomasiga ko‘ra harakat qilinadi va alohida yozuv kiritiladi.",
        ],
      },
      {
        heading: "Qog‘oz o‘rniga tibbiy chiqindilarni elektron hisobga olish",
        paragraphs: [
          "WeSetup’da mas’ul shaxs qadoqlangan chiqindilarni telefondan kiritadi: turi, zararsizlantirish usuli va qadoq ro‘yxatdan tanlanadi, sana va vaqt avtomatik qo‘yiladi. Topshirishda yozuvlarga olib ketish dalolatnomasining surati biriktiriladi, tuzatishlar tarixi saqlanadi, istalgan davr uchun jurnal dalolatnomalar bilan birga tekshiruv uchun PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Jurnal yo‘qligi uchun alohida modda yo‘q. Ammo hisobsiz tashkilot B sinfidagi chiqindilar SanPiN 2.1.3684-21 qoidalariga ko‘ra yig‘ilgani, zararsizlantirilgani va topshirilganini ko‘rsata olmaydi — inspektor sanitariya talablari buzilganini qayd etadi:",
      items: [FINE_6_3, last(FINE_6_4)],
      note: `${NOTE} Olib ketish dalolatnomalari jurnal o‘rnini bosmaydi: ularda yig‘ish va zararsizlantirish haqida ma’lumot yo‘q.`,
    },
  },

  audit_plan: {
    sample: {
      caption:
        "Kichik ishlab chiqarishning yillik ichki auditlar rejasi shunday ko‘rinadi: har bir tekshiruvning sohasi, muddati, auditorlari va mezonlari. Holat belgisi nima o‘tkazilganini va nima oldinda ekanini ko‘rsatadi.",
      columns: ["№", "Audit sohasi", "Muddat", "Auditorlar", "Mezonlar", "Holat"],
      rows: [
        ["1", "Xomashyoni qabul qilish va saqlash", "2026-yil fevral", "Sokolova N. V.", "Kirish nazorati tartibi, PRP", "O‘tkazildi: 18.02.2026"],
        ["2", "Issiq sex, termik ishlov KNN", "2026-yil aprel", "Sokolova N. V., Petrov S. A.", "HACCP rejasi, KNN ish varaqlari", "O‘tkazildi: 21.04.2026"],
        ["3", "Yuvish, tozalash, dezinfeksiya", "2026-yil iyun", "Petrov S. A.", "Sanitariya tartiblari, tozalash jadvallari", "O‘tkazildi: 16.06.2026"],
        ["4", "Kuzatuvchanlik va mahsulotni qaytarib olish", "2026-yil sentabr", "Sokolova N. V.", "Kuzatuvchanlik tartibi", "O‘tkazildi: 22.09.2026"],
        ["5", "Xodimlarni o‘qitish va gigiyena", "2026-yil noyabr", "Petrov S. A.", "O‘qitish dasturi, PRP", "Belgilangan sana: 24.11.2026"],
        ["6", "HACCP tizimi umuman", "2026-yil dekabr", "Sokolova N. V., tashqi maslahatchi", "GOST R ISO 22000-2019", "Rejalashtirilgan"],
      ],
    },
    sections: [
      {
        heading: "Rejani kim tuzadi va tasdiqlaydi",
        paragraphs: [
          "Rejani HACCP guruhi rahbari yoki texnolog tuzadi, korxona rahbari tasdiqlaydi. GOST R ISO 22000-2019 ichki auditlarni rejalashtirilgan oraliqlarda o‘tkazishni talab qiladi — oziq-ovqat mahsulotlari xavfsizligi menejmenti tizimi tashkilot va standart talablariga mos kelishi hamda natijali ishlashiga ishonch hosil qilish uchun. Har bir sohani qanchalik tez-tez tekshirishni tashkilot jarayonlarning muhimligi, o‘zgarishlar va oldingi auditlar natijalarini hisobga olib o‘zi hal qiladi.",
        ],
      },
      {
        heading: "Rejani bosqichma-bosqich qanday tuzish kerak",
        bullets: [
          "Tizimning barcha sohalarini sanab chiqing: qabul qilish, saqlash, har bir sex, yuvish va tozalash, o‘qitish, kuzatuvchanlik, shikoyatlar bilan ishlash.",
          "Yil davomida o‘zgarishlar, shikoyatlar yoki nomuvofiqliklar bo‘lgan joylarni belgilang — bu sohalar ertaroq va tez-tez tekshiriladi.",
          "Har bir soha uchun mezonlarni aniqlang: dastlabki shartlar dasturlari (PRP), HACCP rejasi, tartiblar, TR TS 021/2011 talablari.",
          "Auditorlarni hech kim o‘z ishini tekshirmaydigan qilib tayinlang.",
          "Tekshiruvlarni mavsumiy cho‘qqilarga to‘g‘ri keltirmay, yil bo‘yicha taqsimlang va yakuniy tahlil uchun vaqt qoldiring.",
        ],
      },
      {
        heading: "Kimni auditor qilib tayinlash kerak",
        paragraphs: [
          "Auditor jarayonni tushunishi va hikoyalarga emas, faktlarga tayanib tekshirishi kerak. Kichik korxonada bu texnolog, qo‘shni sex oshpazi yoki ichki audit bo‘yicha o‘qitilgan boshqaruvchi bo‘ladi. Asosiy qoida — mustaqillik: issiq sex oshpazi issiq sexni tekshirmaydi. O‘z odamlaringiz yetishmasa, auditlarning bir qismini tashqi maslahatchiga topshirish mumkin.",
        ],
      },
      {
        heading: "Audit ko‘chirilsa yoki rejadan tashqari audit kerak bo‘lsa",
        paragraphs: [
          "Reja — ishchi hujjat. Ko‘chirish qatorni o‘chirish bilan emas, sabab va yangi sanani ko‘rsatish bilan belgilanadi. Rejadan tashqari audit jiddiy nomuvofiqlik, iste’molchi shikoyati, yetkazib beruvchi yoki texnologiya o‘zgarganidan keyin sababi qayd etilib qo‘shiladi. Biror soha yil bo‘yi kechiktirilaversa, buning o‘zi rahbariyat tomonidan tahlil uchun topilma hisoblanadi.",
        ],
      },
      {
        heading: "Tashqi auditor nimaga qaraydi",
        paragraphs: [
          "Sertifikatlashda yoki yirik buyurtmachi tekshiruvida auditor rejani amaldagi holat bilan solishtiradi: barcha jarayonlar qamrab olinganmi, tekshiruvlar o‘z vaqtida o‘tkazilganmi, har biri bo‘yicha bayonnoma, hisobot va yopilgan tuzatuvchi harakatlar bormi. Bayonnomasiz reja ham, rejasiz bayonnomalar ham birdek zaif ko‘rinadi.",
        ],
      },
      {
        heading: "Jadval o‘rniga elektron audit rejasi",
        paragraphs: [
          "WeSetup’da reja bayonnomalar va hisobotlar bilan bog‘langan: muddat yaqinlashganda auditorga eslatma keladi, bayonnoma to‘g‘ridan-to‘g‘ri sexda telefondan to‘ldiriladi, nomuvofiqliklar esa mas’ul va muddat ko‘rsatilgan CAPA tiketlariga aylanadi. Rejaning o‘zgarishlar tarixi saqlanadi, reja, bayonnomalar va hisobotlar tashqi auditor uchun PDF formatida yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Ichki audit rejasi GOST R ISO 22000-2019 bo‘yicha menejment tizimining hujjati, bu standart esa ixtiyoriy qo‘llaniladi: RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) reja yo‘qligi uchun jarima yo‘q. U sertifikatlash va savdo tarmoqlari talablari uchun muhim. Shu bilan birga, TR TS 021/2011 HACCP tamoyillariga asoslangan tartiblarni joriy etishni majburiy qiladi, muntazam tekshiruvsiz esa tekshiruvchi ularni joriy etilmagan deb hisoblashi mumkin:",
      items: [last(FINE_14_43)],
      note: `${NOTE} Sertifikatlash organi uchun rejaning yo‘qligi — sertifikat olish yoki uni uzaytirishga to‘sqinlik qiladigan nomuvofiqlik.`,
    },
  },

  audit_protocol: {
    sample: {
      caption:
        "Issiq va sovuq sexlar bitta auditining bayonnomasi shunday ko‘rinadi: har bir kuzatuv — mezon, fakt va baho bilan. Nomuvofiqliklarga darhol tuzatuvchi harakat raqami beriladi.",
      columns: ["№", "Nima tekshirildi", "Kuzatuv va dalil", "Baho", "CAPA"],
      rows: [
        ["1", "HACCP rejasi bo‘yicha tarqatishda issiq saqlash", "O‘lchov 12:20 da — +72 °C, bir haftalik KNN yozuvlari to‘liq", "Mos keladi", "—"],
        ["2", "Muzlatkichdagi yarim tayyor mahsulotlar markirovkasi", "3 ta konteynerda tayyorlangan sana yo‘q, 2–4-suratlar", "Kichik nomuvofiqlik", "CAPA-58"],
        ["3", "Zond-termometrning qiyoslanishi", "Qiyoslash muddati 04.11.2026 da tugagan, zond ishlatilmoqda", "Jiddiy nomuvofiqlik", "CAPA-59"],
        ["4", "Kesish taxtalarining rangli markirovkasi", "Barcha taxtalar o‘z uchastkalarida, shikast yo‘q", "Mos keladi", "—"],
        ["5", "KNNda chetlanish bo‘lganda xodimlarning harakatlari", "Oshpaz Kozlov A. A. tartibni to‘g‘ri tushuntirdi", "Ijobiy kuzatuv", "—"],
      ],
    },
    sections: [
      {
        heading: "Bayonnomani kim tuzadi va kim imzolaydi",
        paragraphs: [
          "Bayonnomani auditor tekshiruv paytida yoki undan so‘ng darhol yozadi — bir haftadan keyin xotiradan emas, o‘z qaydlari asosida. Auditor va tekshirilgan uchastka rahbari imzolaydi: rahbarning imzosi har bir baho bilan rozilikni emas, natijalar bilan tanishganini bildiradi. Kelishmovchiliklar og‘zaki hal qilinmaydi, yozib qo‘yiladi.",
        ],
      },
      {
        heading: "Nomuvofiqlikni qanday ifodalash kerak",
        paragraphs: [
          "Yaxshi ifoda uch qismdan iborat: talab, fakt va dalil. «Muzlatkichda tartibsizlik» emas, balki «sovuq sex muzlatkichida yarim tayyor mahsulotli uchta konteynerda tayyorlangan sana yo‘q — markirovka tartibi buzilgan, 2–4-suratlar». Bunday yozuvga e’tiroz bildirish qiyin va undan nimani tuzatish kerakligi tushunarli.",
        ],
        bullets: [
          "Qaysi hujjat yoki tartib bilan solishtirganingizni ko‘rsating.",
          "Aniq faktlarni yozing: joy, vaqt, miqdor, familiya, yozuv raqami.",
          "Jiddiy nomuvofiqliklarni (tartib ishlamaydi, mahsulot xavfsizligiga tahdid bor) kichiklaridan (yakka uzilish) ajrating.",
          "Ijobiy kuzatuvlarni ham belgilang — ular faqat xatolar izlanmaganini ko‘rsatadi.",
        ],
      },
      {
        heading: "Joyida dalillarni qanday to‘plash kerak",
        paragraphs: [
          "Auditor uch manbaga tayanadi: hujjatlar va yozuvlar, ishni kuzatish va xodimlar bilan suhbat. Ularni o‘zaro solishtirish eng qimmatli topilmalarni beradi: jurnalda harorat ideal, kameradagi termometr esa boshqa narsani ko‘rsatadi; yuvish tartibi yozilgan, xodim esa uni boshqacha tasvirlaydi. Suratlar, yozuv raqamlari va o‘lchov vaqtlari bayonnomaga darhol kiritiladi.",
        ],
      },
      {
        heading: "Bayonnomadan keyin nima bo‘ladi",
        paragraphs: [
          "Har bir nomuvofiqlik bo‘yicha uchastka rahbari kelishilgan muddatda tuzatish (darhol bartaraf etish) va tuzatuvchi harakatni (sababni yo‘qotish) taklif qiladi, auditor yoki HACCP guruhi rahbari esa natijani tekshiradi. Harakat tekshirilmaguncha nomuvofiqlik ochiq hisoblanadi. Davr bo‘yicha barcha bayonnomalar yakunlari rahbariyat uchun hisobotga jamlanadi, takrorlanuvchi topilmalar esa keyingi audit rejasida hisobga olinadi.",
        ],
      },
      {
        heading: "Qog‘oz chek-list o‘rniga elektron bayonnoma",
        paragraphs: [
          "WeSetup’da auditor chek-listni to‘g‘ridan-to‘g‘ri sexda telefondan o‘tadi va har bir bandga surat biriktiradi; vaqt va muallif avtomatik qayd etiladi. Tuzatuvchi harakat ijrochisi muddat haqida eslatmalar oladi, har bir nomuvofiqlikning holati u yopilgunga qadar ko‘rinib turadi. Bayonnoma PDF formatida yuklab olinadi, uning ma’lumotlari esa yakuniy hisobotga tushadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Ichki audit bayonnomasi GOST R ISO 22000-2019 bo‘yicha tizim hujjati, RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) u yo‘qligi uchun jarima yo‘q. U sertifikatlash uchun va TR TS 021/2011 bo‘yicha HACCP tartiblari faqat yozilgan emas, balki tekshirilayotganining isboti sifatida kerak. Agar audit qoidabuzarliklarni aniqlagan-u, ular tuzatilmay qolgan bo‘lsa, aynan shu qoidabuzarliklar uchun javob berishga to‘g‘ri keladi:",
      items: [FINE_14_43, last(FINE_6_6)],
      note: `${NOTE} O‘z auditingiz topib, yopgan nomuvofiqlik tekshiruv dalolatnomasidagi xuddi shunday nomuvofiqlikdan yaxshiroq.`,
    },
  },

  audit_report: {
    sample: {
      caption:
        "2026-yil hisobotining jamlanma jadvali shunday ko‘rinadi: har bir audit bo‘yicha jiddiy va kichik nomuvofiqliklar soni, ulardan qanchasi yopilgani va uchastkaning yakuniy bahosi. Jadval ostida xulosalar va tavsiyalar keltiriladi.",
      columns: ["Audit", "Uchastka", "Jiddiy", "Kichik", "Yopilgan", "Baho"],
      rows: [
        ["1-son, 18.02.2026", "Ombor va qabul qilish", "0", "2", "2 tadan 2 tasi", "Mos keladi"],
        ["2-son, 21.04.2026", "Issiq sex", "1", "3", "4 tadan 4 tasi", "Tuzatishdan keyin mos keladi"],
        ["3-son, 16.06.2026", "Yuvish va tozalash", "0", "1", "1 tadan 1 tasi", "Mos keladi"],
        ["4-son, 22.09.2026", "Kuzatuvchanlik", "1", "0", "1 tadan 1 tasi", "Tuzatishdan keyin mos keladi"],
        ["5-son, 12.11.2026", "Sovuq va issiq sex", "1", "2", "3 tadan 1 tasi", "Nazorat talab etiladi"],
      ],
    },
    sections: [
      {
        heading: "Hisobot kimga mo‘ljallangan va uni kim tayyorlaydi",
        paragraphs: [
          "Hisobotni HACCP guruhi rahbari yoki yetakchi auditor tayyorlaydi, u korxona rahbariyatiga mo‘ljallangan. Bayonnomalar har bir tekshiruv tafsilotlarini ko‘rsatadi, hisobot esa direktorning savollariga javob beradi: tizim ishlayaptimi, zaif joylar qayerda, resurslar yetarlimi, kelgusi yilda nimani o‘zgartirish kerak. GOST R ISO 22000-2019 bo‘yicha ichki auditlar natijalari tizimni rahbariyat tomonidan tahlil qilishga kiradi.",
        ],
      },
      {
        heading: "Hisobotga nimalarni kiritish kerak",
        bullets: [
          "Davr va o‘tkazilgan auditlar ro‘yxati — reja bilan solishtirilgan holda, ko‘chirish sabablari bilan.",
          "Uchastkalar va toifalar bo‘yicha nomuvofiqliklar jamlanmasi, takrorlanuvchi topilmalar.",
          "Tuzatuvchi harakatlar holati: yopilgan, bajarilmoqda, muddati o‘tgan.",
          "Tizim natijadorligining umumiy bahosi va o‘tgan davrga nisbatan o‘zgarishlar.",
          "Tavsiyalar: o‘qitish, uskunani ta’mirlash yoki almashtirish, tartiblar va HACCP rejasidagi o‘zgarishlar.",
        ],
      },
      {
        heading: "Raqamlarni sanash bilan cheklanmay, xulosa qanday chiqariladi",
        paragraphs: [
          "Nomuvofiqliklar sonining o‘zi kam narsani anglatadi: uning o‘sishi auditorlar e’tiborliroq bo‘lib qolganini bildirishi mumkin. Topilmalar qayerda takrorlanayotgani, yopishga qancha vaqt ketayotgani va yopilgan muammolar qaytmayotganiga qarash foydaliroq. Masalan, ketma-ket uchta auditda termometrlarning qiyoslash muddati o‘tgani navbatdagi hayfsan emas, eslatmali qiyoslash jadvali kerakligidan darak beradi. Aynan shunday xulosalar tavsiyalarga aylanadi.",
        ],
      },
      {
        heading: "Yakunlar bo‘yicha rahbariyat qarorlari",
        paragraphs: [
          "Hisobot uning asosida qarorlar qabul qilingandagina ma’noga ega. Rahbar ularni yozma ravishda qayd etadi: qanday resurs ajratish, kimni o‘qitish, qaysi tartiblarni qayta ko‘rib chiqish, kelgusi yilda qaysi sohalarni tez-tez tekshirish. Bu qarorlar yangi audit rejasi va HACCP rejasini yangilash uchun asos bo‘ladi, ularning bajarilishi esa navbatdagi tahlilda tekshiriladi.",
        ],
      },
      {
        heading: "Qo‘lda jamlash o‘rniga elektron hisobot",
        paragraphs: [
          "WeSetup’da nomuvofiqliklar jamlanmasi va tuzatuvchi harakatlar holati bayonnomalar va CAPA tiketlaridan avtomatik olinadi, shuning uchun mas’ul shaxsga faqat xulosa va tavsiyalarni yozish qoladi. Istalgan davr uchun hisobot rahbariyat, tashqi auditor yoki buyurtmachi uchun PDF formatida yuklab olinadi, o‘zgarishlar tarixi esa ma’lumotlarni kim va qachon tahrirlaganini ko‘rsatadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Ichki audit hisoboti GOST R ISO 22000-2019 bo‘yicha menejment tizimining hujjati. U yo‘qligi uchun jarima yo‘q: standart ixtiyoriy, hisobot esa avvalo sertifikatlash, savdo tarmoqlari talablari va boshqaruv uchun kerak. Xavf natijalar tahlil qilinmay, TR TS 021/2011 talab qiladigan HACCP tartiblari amalda ishlashdan to‘xtaganda paydo bo‘ladi:",
      items: [last(FINE_14_43)],
      note: NOTE,
    },
  },
};
