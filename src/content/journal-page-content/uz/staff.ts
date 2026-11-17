import type { JournalPageContent } from "../types";

const FINES_NOTE_UZ = "Summalar — RF KoAPning 2026-yil noyabr holatidagi tahririga ko‘ra.";

export const STAFF_PAGE_CONTENT_UZ: Record<string, JournalPageContent> = {
  hygiene: {
    sample: {
      caption:
        "Ertalabki smena yozuvlari: har bir xodim uchun harorat, ko‘rik natijasi va ishga ruxsat haqidagi qaror. Harorati baland oshpaz ishdan chetlatilgan, sababi o‘sha qatorning o‘zida yozilgan.",
      columns: ["Sana", "Xodim", "Lavozim", "Harorat, °C", "Ko‘rik va so‘rov", "Ruxsat", "Mas’ul"],
      rows: [
        ["05.11.2026", "Smirnova Ye. V.", "Oshpaz", "36,6", "Sog‘lom", "Ruxsat berildi", "Ivanova M. P."],
        ["05.11.2026", "Kozlov A. A.", "Oshpaz", "37,4", "Tumov, holsizlik", "Chetlatildi", "Ivanova M. P."],
        ["05.11.2026", "Petrova O. S.", "Qandolatchi", "36,5", "Barmoqda yiringlamagan kesik, yopilgan", "Ruxsat berildi, qo‘lqopda", "Ivanova M. P."],
        ["05.11.2026", "Ahmedov R. T.", "Idish yuvuvchi", "36,7", "Sog‘lom", "Ruxsat berildi", "Ivanova M. P."],
        ["05.11.2026", "Lebedeva N. I.", "Ofitsiant", "36,4", "Sog‘lom", "Ruxsat berildi", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Ko‘rikni kim o‘tkazadi va ishga ruxsat uchun kim javob beradi",
        paragraphs: [
          "Ko‘rikni bitta tayinlangan shaxs o‘tkazadi: kafeda — bosh oshpaz yoki smena administratori, ishlab chiqarishda — usta yoki texnolog, maktab va shifoxona oshxonasida — tibbiyot xodimi. Tayinlov buyruq bilan rasmiylashtiriladi va dam olish kunlari hamda ta’til uchun o‘rinbosar ko‘rsatiladi, aks holda shu kunlarda yozuvlar tushib qoladi.",
          "Mas’ul shaxs xodimni ishga qo‘yish-qo‘ymaslikni shaxsan hal qiladi va bu qaror uchun imzo chekadi. Xodim esa o‘z navbatida kasalligi, oila a’zolaridagi ichak infeksiyasi va qo‘lidagi yaralar haqida xabar berishi shart — busiz so‘rov shunchaki rasmiyatchilikka aylanadi.",
        ],
      },
      {
        heading: "Smena oldidan ko‘rik tartibi",
        bullets: [
          "Ko‘rik sanitariya kiyimini kiyishdan va ishlab chiqarish xonalariga kirishdan oldin o‘tkaziladi, ish boshlangandan keyin emas.",
          "Haroratni kontaktsiz termometr bilan o‘lchang va «me’yorda» deb emas, aniq qiymatni yozing.",
          "Qo‘l panjalari va terining ochiq joylarini ko‘zdan kechiring: yiringli toshmalar, kuyishlar, kesiklar.",
          "Ahvolini so‘rang: tumov, yo‘tal, tomoq og‘rig‘i, ko‘ngil aynishi, ich buzilishi.",
          "Qarorni yozing va imzo cheking. Kechroq kelgan xodimlar kelishi bilan ko‘rikdan o‘tkaziladi.",
        ],
      },
      {
        heading: "Xodim qachon ishdan chetlatiladi",
        paragraphs: [
          "Chetlatish uchun asoslar: 37 °C dan yuqori harorat, O‘RVI belgilari, qo‘l terisidagi yiringli toshmalar, ichak buzilishlari. Chetlatilgan xodim qadoqlangan mahsulot bilan ham ishlamaydi: qo‘zg‘atuvchi qo‘l va idish orqali o‘tadi. U shifokorga yuboriladi, sog‘aygach esa, zarur bo‘lsa — ma’lumotnoma asosida, yana ishga qo‘yiladi.",
          "Yallig‘lanish belgilari bo‘lmagan kichik yangi kesik plastir yoki barmoq qalpoqchasi bilan yopiladi, ustidan qo‘lqop kiyiladi. Agar chetlatish tufayli smena oshpazsiz qolsa, rahbar buni kasal xodimni ishga qo‘yish bilan emas, odamlarni qayta taqsimlash bilan hal qiladi.",
        ],
      },
      {
        heading: "Tekshiruvchi topadigan odatiy xatolar",
        bullets: [
          "Yozuvlar bir necha kun oldinga yoki orqa sana bilan bitta ruchkada yozilgan.",
          "Hammada va doim «36,6» — termometrsiz to‘ldiriladigan jurnal aynan shunday ko‘rinadi.",
          "Jadval bo‘yicha smenada bo‘lgan xodimlar uchun qatorlar yo‘q.",
          "Chetlatish yozilgan, lekin xodim o‘sha kuni brakeraj yoki tozalash jurnallarida qayd etilgan.",
          "Mas’ul shaxsning imzosi yo‘q yoki ko‘rikdan o‘tayotgan xodimning o‘zi imzolagan.",
        ],
      },
      {
        heading: "Qog‘oz o‘rniga ko‘riklarni elektron hisobga olish",
        paragraphs: [
          "WeSetup’da smenadagi xodimlar ro‘yxati ish jadvalidan olinadi, mas’ul shaxs telefonda shu ro‘yxat bo‘yicha yurib, harorat va qarorni kiritadi. Yozuv vaqti avtomatik qo‘yiladi, tuzatishlar tarixda saqlanadi, 37 °C dan yuqori harorat qatorni darhol chetlatish sifatida belgilaydi. Smena boshlanguncha ko‘rik o‘tkazilmagan bo‘lsa, rahbar eslatma oladi, tekshiruv oldidan esa xodimlar gigiyenasi jurnalini qog‘oz blanka shaklidagi PDF ko‘rinishida yuklab oladi.",
        ],
      },
    ],
    fines: {
      intro:
        "RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) ko‘rik yozuvlari yo‘qligi uchun alohida modda yo‘q. Ammo infeksiya belgilari bor odamni oziq-ovqat bilan ishlashga qo‘yish SanPiN 2.3/2.4.4282-26 ni bevosita buzish hisoblanadi, jurnalsiz esa korxona ko‘rik o‘tkazilayotganini isbotlay olmaydi:",
      items: [
        "KoAP 6.6-moddasi — aholi ovqatlanishini tashkil etishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish;",
        "KoAP 6.3-moddasi — sanitariya-epidemiologik farovonlikni ta’minlash sohasidagi qonunchilikni buzish: yuridik shaxslar uchun 10 000 dan 20 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish.",
      ],
      note: `${FINES_NOTE_UZ} Ommaviy zaharlanish bo‘lganda birinchi bo‘lib ko‘riklar jurnali so‘raladi.`,
    },
  },

  health_check: {
    sample: {
      caption:
        "Bir kunlik yozuvlar batafsil shaklda: har bir xodim bo‘yicha alohida belgilar qayd etilgan, oxirgi ustunda esa qaror va uning asosi. Shunda faqat yakun emas, aynan nima tekshirilgani ham ko‘rinadi.",
      columns: ["Sana", "Xodim, lavozim", "Harorat, °C", "O‘RVI (yo‘tal, tumov)", "Ichak buzilishlari", "Qo‘l terisi", "Qaror"],
      rows: [
        ["12.11.2026", "Smirnova Ye. V., oshpaz", "36,5", "Yo‘q", "Yo‘q", "Toza", "Ruxsat berildi"],
        ["12.11.2026", "Kozlov A. A., oshpaz", "36,8", "Yo‘q", "Ich buzilishidan shikoyat", "Toza", "Chetlatildi, shifokorga yuborildi"],
        ["12.11.2026", "Petrova O. S., qandolatchi", "36,6", "Yo‘q", "Yo‘q", "1-darajali kuyish, yopilgan", "Ruxsat berildi, kremlar bilan ishlamaydi"],
        ["12.11.2026", "Ahmedov R. T., idish yuvuvchi", "37,2", "Tumov", "Yo‘q", "Toza", "Chetlatildi"],
      ],
    },
    sections: [
      {
        heading: "Batafsil shakl qisqa shakldan nimasi bilan farq qiladi",
        paragraphs: [
          "Qisqa shaklda mas’ul shaxs faqat yakunni yozadi: ruxsat berildi yoki yo‘q. Batafsil shakl ko‘rikni belgilarga ajratadi — harorat, O‘RVI, ichak buzilishlari, qo‘l terisining holati — va har biri bo‘yicha belgi qo‘yiladi. Yozuvlar ko‘payadi, lekin bir oydan keyin ham ular orqali smenada kim qanday shikoyat bilan bo‘lganini tiklash mumkin.",
          "Batafsil shaklni maktab, bog‘cha va shifoxona oshxonalari, keytering va savdoga mahsulot jo‘natadigan ishlab chiqarishlar tanlaydi — u yerda xato qimmatga tushadi. Kichik shtatli kafega odatda qisqa shakl yetarli. Ikkalasini bir vaqtda yuritish shart emas: ishlab chiqarish nazorati dasturida belgilangan bitta shakl kifoya.",
        ],
      },
      {
        heading: "Qaror va uning asosini qanday yozish kerak",
        bullets: [
          "«Ruxsat berildi» — barcha belgilar bo‘yicha natija salbiy va harorat 37 °C dan oshmagan bo‘lsa.",
          "«Chetlatildi» — belgisini ko‘rsatgan holda: harorat, O‘RVI, ichak buzilishi, qo‘l terisidagi yiringli toshma.",
          "«Shifokorga yuborildi» — alomatlar tekshiruvni talab qilsa; ishga chiqish sanasi keyinroq alohida qatorda yoziladi.",
          "«Cheklov bilan ruxsat berildi» — masalan, kremlar va tayyor taomlar bilan ishlamaslik; cheklov yozuvdan tushunarli bo‘lishi kerak.",
        ],
      },
      {
        heading: "Kasallikdan keyin ishga qaytish",
        paragraphs: [
          "Chetlatilgan xodim ishga chiqqan kuni qayta ko‘rikdan o‘tgandan keyingina yana ishga qo‘yiladi. Agar sabab ichak infeksiyasi bo‘lgan yoki xodim kasallik varaqasida bo‘lgan bo‘lsa, mas’ul shaxs shifokordan hujjat so‘raydi va bu haqda jurnalda belgi qo‘yadi. Agar ichak infeksiyasi oila a’zosida bo‘lgan bo‘lsa, xodim bu haqda o‘zi xabar beradi, rahbar esa shifokor tavsiyalarini hisobga olib ishga ruxsat masalasini hal qiladi.",
        ],
      },
      {
        heading: "Oziq-ovqatdan zaharlanishni tekshirishda bu yozuvlar nima uchun kerak",
        paragraphs: [
          "Rospotrebnadzor zaharlanish holatini tekshirganda sana, menyu va smena tarkibini solishtiradi. Batafsil belgilar taom tayyorlangan kuni shu taomlar bilan ishlagan xodimlarda alomatlar bo‘lmaganini, kasallar esa chetlatilganini ko‘rsatadi. Ularsiz korxona xodimlar sog‘lom bo‘lganini faqat og‘zaki tasdiqlashi mumkin, xolos.",
        ],
      },
      {
        heading: "Salomatlik jurnali elektron shaklda",
        paragraphs: [
          "WeSetup’da ko‘rik shakli sexga kirishdagi QR kod orqali telefonda ochiladi: mas’ul shaxs belgilarni belgilash katakchalari bilan qayd etadi, yozuv vaqti avtomatik qo‘yiladi, har qanday ijobiy belgi esa darhol «chetlatildi» qarorini taklif qiladi. Smena xodimlari bo‘yicha tushib qolgan yozuvlar rahbarga ko‘rinadi, tuzatishlar tarixi saqlanadi, PDF eksporti qog‘oz blankani takrorlaydi.",
        ],
      },
    ],
    fines: {
      intro:
        "Jurnal shakli uchun alohida jarima yo‘q. Javobgarlik mohiyat uchun keladi: kasallik belgilari bor odam ishga qo‘yilgan yoki ko‘rik yozuvlar bilan tasdiqlanmagan — bu SanPiN 2.3/2.4.4282-26 ni buzish bo‘lib, RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksi (KoAP) bo‘yicha jazolanadi:",
      items: [
        "KoAP 6.6-moddasi — aholi ovqatlanishini tashkil etishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish;",
        "KoAP 6.3-moddasi — sanitariya-epidemiologik farovonlikni ta’minlash sohasidagi qonunchilikni buzish: yuridik shaxslar uchun 10 000 dan 20 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish.",
      ],
      note: FINES_NOTE_UZ,
    },
  },

  med_books: {
    sample: {
      caption:
        "Kafe xodimlari bo‘yicha hisob qatorlari: shaxsiy tibbiy daftarcha raqami, oxirgi va keyingi ko‘rik sanalari hamda attestatsiya belgisi. Oxirgi ustundan kimni klinikaga yozish vaqti kelgani ko‘rinadi.",
      columns: ["Xodim", "Lavozim", "Tibbiy daftarcha №", "Oxirgi tibbiy ko‘rik", "Keyingi tibbiy ko‘rik", "Gigiyenik attestatsiya", "Holat"],
      rows: [
        ["Smirnova Ye. V.", "Oshpaz", "77-0012345", "14.03.2026", "14.03.2027 gacha", "Amalda", "Tartibda"],
        ["Kozlov A. A.", "Oshpaz", "77-0023456", "02.12.2025", "02.12.2026 gacha", "Amalda", "Ko‘rikka yozish kerak"],
        ["Petrova O. S.", "Qandolatchi", "77-0034567", "20.06.2026", "20.06.2027 gacha", "Amalda", "Tartibda"],
        ["Lebedeva N. I.", "Ofitsiant", "77-0045678", "05.11.2026", "05.11.2027 gacha", "05.11.2026 da o‘tgan", "Yangi xodim"],
      ],
    },
    sections: [
      {
        heading: "Tibbiy daftarchalar hisobiga kimlarni kiritish kerak",
        paragraphs: [
          "Sog‘liqni saqlash vazirligining 29n-son buyrug‘iga ko‘ra dastlabki va davriy tibbiy ko‘riklar ovqatni tayyorlash, saqlash, tashish va tarqatishda hamda idish yuvishda ishtirok etadigan barcha uchun majburiy: oshpazlar, qandolatchilar, oshxona ishchilari, idish yuvuvchilar, ofitsiantlar, barmenlar, omborchilar, ekspeditorlar. Natijalar shaxsiy tibbiy daftarchaga kiritiladi.",
          "Hisobga o‘rindoshlar, stajyorlar, mavsumiy ishchilar va sinov muddatidagi xodimlar ham kiritiladi. Tekshiruvchi qoidabuzarlikni ko‘pincha aynan «bir-ikki kunga o‘rniga turish» uchun chiqqanlarda topadi.",
        ],
      },
      {
        heading: "Ishga qabul qilishdagi tartib",
        bullets: [
          "Birinchi ish kunigacha — dastlabki tibbiy ko‘rikka yo‘llanma berish va daftarchani tekshirish.",
          "Daftarchada ko‘rik natijalari, tekshiruvlar va gigiyenik attestatsiya haqidagi belgilar borligiga ishonch hosil qiling.",
          "F.I.Sh. va suratni pasport bilan solishtiring: soxta daftarchalar ko‘pincha nomuvofiqliklar orqali fosh bo‘ladi.",
          "Ma’lumotlarni hisobga kiriting va darhol keyingi ko‘rik sanasini belgilang.",
          "Daftarchaning asl nusxasini korxonada saqlang yoki har bir tekshiruvga talab qiling — tashkilotda qabul qilingan qoidaga ko‘ra.",
        ],
      },
      {
        heading: "Tibbiy ko‘rik muddati o‘tgan bo‘lsa nima qilish kerak",
        paragraphs: [
          "RF Mehnat kodeksi ish beruvchini majburiy tibbiy ko‘rikdan o‘tmagan xodimni ishdan chetlatishga majbur qiladi, agar bunda xodim aybdor bo‘lsa, chetlatish davri uchun unga haq to‘lanmaydi. «Poliklinikada navbat bor ekan» deb ishlab turish mumkin emas: muddati o‘tgan daftarcha bilan ishga qo‘yishning o‘zi jarima solinadigan qoidabuzarlikdir.",
          "Bunga yo‘l qo‘ymaslik uchun muddatlar oldindan tekshiriladi: xodim muddat tugashidan bir oy oldin ko‘rikka yoziladi, smena jadvalida esa u klinikaga boradigan kunga oldindan almashtiruvchi qo‘yiladi.",
        ],
      },
      {
        heading: "Tekshiruvchi nimalarga qaraydi",
        bullets: [
          "Shu kuni smenada bo‘lgan har bir kishida, jumladan stajyorlarda ham daftarcha bormi.",
          "Tekshiruv sanasida ko‘rik va attestatsiya muddati o‘tmaganmi.",
          "Hisobdagi ro‘yxat shtat va smena jadvaliga mos keladimi.",
          "Daftarchaning o‘zida tibbiyot tashkilotining imzo va muhrlari bormi.",
        ],
      },
      {
        heading: "Tibbiy daftarcha muddatlari elektron hisobda",
        paragraphs: [
          "WeSetup’da ko‘rik sanalari xodim kartochkasida saqlanadi. Servis muddat tugashidan 30 kun oldin rahbarga eslatadi, muddati o‘tganlarni qizil rangda belgilaydi va bunday xodimni ogohlantirishsiz smenaga qo‘yishga yo‘l qo‘ymaydi. Tekshiruv oldidan ro‘yxat bitta jadval ko‘rinishida PDF ga yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Hisob jurnalining o‘zi qonun bo‘yicha majburiy emas, bu ish beruvchining vositasi. Amalda RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksi (KoAP) bo‘yicha jarima boshqa narsa uchun solinadi — amaldagi tibbiy ko‘riksiz odamni ishga qo‘yganlik uchun:",
      items: [
        "KoAP 5.27.1-moddasi 3-qismi — xodimni o‘qitish, yo‘riqnoma, bilimini tekshirish yoki majburiy tibbiy ko‘rikdan o‘tkazmasdan ishga qo‘yish: mansabdor shaxslar va yakka tartibdagi tadbirkorlar (YaTT) uchun 15 000 dan 25 000 ₽ gacha, yuridik shaxslar uchun 110 000 dan 130 000 ₽ gacha (har bir xodim uchun);",
        "KoAP 6.3-moddasi — sanitariya-epidemiologik farovonlikni ta’minlash sohasidagi qonunchilikni buzish: yuridik shaxslar uchun 10 000 dan 20 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish.",
      ],
      note: `${FINES_NOTE_UZ} KoAP 5.27.1-moddasining 3-qismi bo‘yicha jarima har bir xodim uchun hisoblanadi, shuning uchun muddati o‘tgan uchta daftarcha — bu uchta jarima.`,
    },
  },

  training_plan: {
    sample: {
      caption:
        "Yillik rejadan parcha: har bir mavzu uchun kimga mo‘ljallangani, qanchalik tez-tez o‘tkazilishi, kim olib borishi va qaysi oyda ekani ko‘rsatilgan. Amalda o‘tkazilgani keyin yo‘riqnomalarni qayd etish jurnalida belgilanadi.",
      columns: ["Mavzu", "Kimlar uchun", "Davriylik", "Mas’ul", "Muddatlar"],
      rows: [
        ["Kirish o‘qitish: shaxsiy gigiyena, sanitariya kiyimi, qo‘l yuvish", "Barcha yangi xodimlar", "Ishga qabul qilinganda", "Ivanova M. P., bosh oshpaz", "Birinchi kuni"],
        ["Kritik nazorat nuqtalari va og‘ishlarda harakatlar", "Oshpazlar, qandolatchilar", "Yarim yilda bir marta", "Kuznetsov D. V., texnolog", "Yanvar, iyul"],
        ["Yuvish va dezinfeksiya: vositalar, konsentratsiyalar, inventar", "Idish yuvuvchilar, oshxona ishchilari", "Yilda bir marta va vosita almashtirilganda", "Ivanova M. P., bosh oshpaz", "Mart"],
        ["Allergenlar va o‘zaro ifloslanishning oldini olish", "Oshpazlar, ofitsiantlar", "Yilda bir marta", "Kuznetsov D. V., texnolog", "Oktyabr"],
      ],
    },
    sections: [
      {
        heading: "Yo‘riqnomalar baribir o‘tkazilsa, reja nima uchun kerak",
        paragraphs: [
          "TR TS 021/2011 ning 10-moddasi ishlab chiqaruvchidan HACCP tamoyillariga asoslangan tartiblarni ishlab chiqish va qo‘llab-quvvatlashni talab qiladi. Tartiblar faqat xodimlar ularni bilganda ishlaydi, shuning uchun o‘qitish tizimning majburiy qismi, reja esa u tekshiruvdan tekshiruvga emas, muntazam o‘tayotganini ko‘rsatadi.",
          "Rejasiz yo‘riqnomalar xotiraga tayanib o‘tkaziladi: ba’zi mavzular har oy takrorlanadi, boshqalariga yillab navbat kelmaydi. Reja buni bartaraf etadi — yil davomida har bir lavozim o‘z mavzular to‘plamini oladi.",
        ],
      },
      {
        heading: "Qaysi mavzularni kiritish kerak",
        bullets: [
          "Yangi xodimlar uchun kirish o‘qitish: shaxsiy gigiyena, sanitariya kiyimi, qo‘l yuvish qoidalari, smenaga qo‘yish tartibi.",
          "O‘z ishlab chiqarishingizning kritik nazorat nuqtalari: nimani o‘lchash, chegara qayerda va undan chiqilganda nima qilish.",
          "Yuvish va dezinfeksiya: vositalar, ishchi konsentratsiyalar, inventar markirovkasi.",
          "Saqlash va tovar qo‘shnichiligi, yaroqlilik muddatlari, yarim tayyor mahsulotlar markirovkasi.",
          "Allergenlar va o‘zaro ifloslanish — ayniqsa bolalar menyusi bor oshxona uchun.",
          "Mehmon shikoyat qilganda va zaharlanishga shubha tug‘ilganda qilinadigan harakatlar.",
        ],
      },
      {
        heading: "Rejani qanday tuzish va tasdiqlash kerak",
        paragraphs: [
          "Rejani texnolog yoki HACCP guruhi rahbari tuzadi, direktor tasdiqlaydi. Har bir mavzu uchun kim o‘tishi, qanchalik tez-tez, kim olib borishi va qaysi oyda ekani ko‘rsatiladi. Rejadan tashqari o‘qitish voqealarga qarab qo‘shiladi: yangi uskuna, yuvish vositasining almashtirilishi, retseptura o‘zgarishi, jurnallardagi takroriy og‘ishlar, mehmonlar shikoyatlari.",
          "Reja yiliga bir marta ichki audit natijalariga ko‘ra qayta ko‘rib chiqiladi: xodimlar xato qilgan mavzular tez-tez qo‘yiladi.",
        ],
      },
      {
        heading: "Auditor va inspektor nimani tekshiradi",
        bullets: [
          "Reja tasdiqlanganmi va u yuklab olingan shablonga emas, aynan shu ishlab chiqarish xavflariga mos keladimi.",
          "Rejadagi sanalar va mavzular yo‘riqnomalarni qayd etish jurnalidagi yozuvlarga mos keladimi.",
          "So‘nggi oylarda qabul qilingan xodimlar kirish o‘qitishdan o‘tganmi.",
          "Oshpazlar ish joyida o‘z kritik nuqtalari qayerda ekanini va og‘ishda nima qilishni biladimi.",
        ],
      },
      {
        heading: "O‘qitish rejasi WeSetup’da",
        paragraphs: [
          "WeSetup’da reja lavozimlarga bog‘langan: yangi xodim kirish mavzularini avtomatik oladi, rahbar esa oy uchun qaysi yo‘riqnomalar rejalashtirilgani va qaysilarining muddati o‘tganini ko‘radi. O‘tkazilgan mashg‘ulot qayd etish jurnalida belgilanadi, reja esa har bir mavzu bo‘yicha bajarilishni ko‘rsatadi.",
        ],
      },
    ],
    fines: {
      intro:
        "RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) aynan o‘qitish rejasi yo‘qligi uchun jarima yo‘q: bu HACCP tizimining ichki hujjati. Ammo tekshiruvda reja va o‘qitish yozuvlarining yo‘qligi HACCP tartiblari amalda ishlamayotganini bildiradi va bu texnik reglament yoki sanitariya talablarini buzish deb baholanadi:",
      items: [
        "KoAP 14.43-moddasi — texnik reglamentlar (TR TS 021/2011) talablarini buzish: yakka tartibdagi tadbirkorlar (YaTT) uchun 20 000 dan 30 000 ₽ gacha, yuridik shaxslar uchun 100 000 dan 300 000 ₽ gacha;",
        "KoAP 6.6-moddasi — aholi ovqatlanishini tashkil etishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish.",
      ],
      note: FINES_NOTE_UZ,
    },
  },

  staff_training: {
    sample: {
      caption:
        "Bir haftalik yozuvlar: yangi oshpazning kirish yo‘riqnomasi, kritik nuqtalar bo‘yicha rejali mashg‘ulot va dezinfeksiya vositasi almashtirilgandan keyingi rejadan tashqari yo‘riqnoma. O‘qituvchi ham, o‘qitilgan xodim ham imzo qo‘yadi.",
      columns: ["Sana", "Turi", "Mavzu", "Xodim, lavozim", "O‘tkazgan", "O‘qitilgan xodim imzosi"],
      rows: [
        ["09.11.2026", "Kirish", "Shaxsiy gigiyena, sanitariya kiyimi, smenaga qo‘yish", "Lebedeva N. I., oshpaz", "Ivanova M. P., bosh oshpaz", "Imzolangan"],
        ["10.11.2026", "Rejali", "Issiqlik ishlovida haroratni nazorat qilish", "Smirnova Ye. V., oshpaz", "Kuznetsov D. V., texnolog", "Imzolangan"],
        ["10.11.2026", "Rejali", "Issiqlik ishlovida haroratni nazorat qilish", "Kozlov A. A., oshpaz", "Kuznetsov D. V., texnolog", "Imzolangan"],
        ["13.11.2026", "Rejadan tashqari", "Yangi dezinfeksiya vositasi: konsentratsiya, ekspozitsiya", "Ahmedov R. T., idish yuvuvchi", "Ivanova M. P., bosh oshpaz", "Imzolangan"],
      ],
    },
    sections: [
      {
        heading: "Bu jurnal mehnat muhofazasi jurnallaridan nimasi bilan farq qiladi",
        paragraphs: [
          "Bu yerda oziq-ovqat mahsulotlari xavfsizligi bo‘yicha o‘qitish qayd etiladi — gigiyena, kritik nuqtalar, yuvish va dezinfeksiya, allergenlar. Bu TR TS 021/2011 ning 10-moddasiga ko‘ra HACCP tartiblarining bir qismi.",
          "Mehnat muhofazasi bo‘yicha yo‘riqnomalar — kirish, ish joyidagi, takroriy — mehnat qonunchiligi qoidalariga ko‘ra alohida qayd etiladi. Ularni bitta jurnalda aralashtirmagan ma’qul: ularni turli idoralar turli talablar asosida tekshiradi.",
        ],
      },
      {
        heading: "Yo‘riqnoma turlari va ularni qachon o‘tkazish kerak",
        bullets: [
          "Kirish — yangi xodimga mustaqil ishni boshlashidan oldin.",
          "Rejali — yillik o‘qitish rejasi bo‘yicha, o‘z lavozimi mavzulari bo‘yicha.",
          "Rejadan tashqari — yangi uskuna kelganda, yuvish vositasi almashtirilganda, retseptura yoki texnologiya o‘zgarganda.",
          "Maqsadli — jiddiy og‘ish yoki shikoyatdan keyin: holatni smenada bo‘lganlar bilan tahlil qilish.",
        ],
      },
      {
        heading: "Yozuvni qanday to‘g‘ri rasmiylashtirish kerak",
        paragraphs: [
          "Bir qator — bir xodim: mashg‘ulot butun smena uchun bo‘lgan bo‘lsa ham, har kim o‘zi uchun imzo qo‘yadi. Mavzu aniq yoziladi — mazmunsiz «HACCP bo‘yicha» degan yozuv tekshiruvchini qoniqtirmaydi. Agar yo‘riqnomadan keyin bilim og‘zaki so‘rov yoki test bilan tekshirilgan bo‘lsa, natija izohda yoziladi.",
          "Mashg‘ulot kuni kasallik varaqasida yoki ta’tilda bo‘lgan xodimga ishga chiqqanidan keyin alohida yo‘riqnoma beriladi va u orqa sana bilan emas, haqiqiy sana bilan yoziladi.",
          "Mashg‘ulot materiallari — eslatma, yo‘riqnoma, test savollari — jurnal bilan birga saqlanadi. Ulardan xodim aynan nimani o‘rganganini ko‘rish mumkin, mavzu keyingi safar takrorlanganda ham ulardan foydalaniladi.",
        ],
      },
      {
        heading: "Darhol ko‘zga tashlanadigan xatolar",
        bullets: [
          "Xodimlarning barcha imzolari bir xil yoki bitta qo‘l bilan qo‘yilgan.",
          "Yangi xodim bir haftadan beri smena jadvalida, lekin kirish yo‘riqnomasi yo‘q.",
          "Jurnaldagi mavzular tasdiqlangan o‘qitish rejasiga mos kelmaydi.",
          "Jiddiy og‘ish yoki shikoyatdan keyin smena bilan maqsadli yo‘riqnoma o‘tkazilmagan.",
          "Hodisa tekshirilganda oshpaz yo‘riqnoma uchun imzo qo‘ygan bo‘lsa-da, o‘z kritik nuqtasini bilmasligi ma’lum bo‘ladi.",
        ],
      },
      {
        heading: "Yo‘riqnomalarni elektron shaklda qayd etish",
        paragraphs: [
          "WeSetup’da xodim yo‘riqnomani telefon orqali o‘z akkauntida tasdiqlaydi, servis sana, vaqt va foydalanuvchini saqlaydi — bu qog‘oz qatordagi imzo o‘rnini bosadi. Rahbar smenadan kim hali mavzudan o‘tmaganini ko‘radi, PDF ga yuklab olganda esa odatiy jurnal jadvalini oladi.",
        ],
      },
    ],
    fines: {
      intro:
        "HACCP bo‘yicha o‘qitish yozuvlari yo‘qligi uchun alohida jarima yo‘q — bu mahsulot xavfsizligi tartiblari ishlamayotgani sifatida ko‘riladi. Agar mehnat muhofazasi bo‘yicha yo‘riqnomalar rasmiylashtirilmagan bo‘lsa, mehnat qonunchiligi bo‘yicha javobgarlik keladi. Ikkala holat ham RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) nazarda tutilgan:",
      items: [
        "KoAP 14.43-moddasi — texnik reglamentlar (TR TS 021/2011) talablarini buzish: yakka tartibdagi tadbirkorlar (YaTT) uchun 20 000 dan 30 000 ₽ gacha, yuridik shaxslar uchun 100 000 dan 300 000 ₽ gacha;",
        "KoAP 5.27.1-moddasi 3-qismi — xodimni o‘qitish, yo‘riqnoma, bilimini tekshirish yoki majburiy tibbiy ko‘rikdan o‘tkazmasdan ishga qo‘yish: mansabdor shaxslar va YaTT uchun 15 000 dan 25 000 ₽ gacha, yuridik shaxslar uchun 110 000 dan 130 000 ₽ gacha (har bir xodim uchun).",
      ],
      note: FINES_NOTE_UZ,
    },
  },

  ppe_issuance: {
    sample: {
      caption:
        "Bir oylik berish yozuvlari: har bir pozitsiya uchun miqdor, me’yor bo‘yicha taqish muddati va xodim imzosi. Bir martalik qo‘lqoplar sarflanishiga qarab partiyalab beriladi.",
      columns: ["Sana", "Xodim, lavozim", "Himoya vositasi nomi", "Miqdori", "Taqish muddati", "Imzo"],
      rows: [
        ["02.11.2026", "Ahmedov R. T., idish yuvuvchi", "Rezinalangan fartuk", "1 dona", "Eskirguncha", "Oldi"],
        ["02.11.2026", "Ahmedov R. T., idish yuvuvchi", "Rezina qo‘lqoplar", "6 juft", "1 oy", "Oldi"],
        ["02.11.2026", "Smirnova Ye. V., oshpaz", "Yuqori haroratdan himoyalovchi qo‘lqoplar", "1 juft", "6 oy", "Oldi"],
        ["09.11.2026", "Kozlov A. A., oshxona ishchisi", "Sirpanmaydigan tagcharmli poyabzal", "1 juft", "12 oy", "Oldi"],
        ["16.11.2026", "Petrova O. S., qandolatchi", "Bir martalik nitril qo‘lqoplar", "100 dona", "Sarflanishiga qarab", "Oldi"],
      ],
    },
    sections: [
      {
        heading: "Shaxsiy himoya vositalarini (SHHV) kim berishi va hisobini yuritishi shart",
        paragraphs: [
          "RF Mehnat kodeksi ish beruvchini o‘z hisobidan xodimlarni shaxsiy himoya vositalari bilan ta’minlashga majbur qiladi, berish me’yorlari esa Mehnat vazirligining 767n-son buyrug‘iga ko‘ra kasbiy xavflarni baholash va mehnat sharoitlarini maxsus baholash natijalarini hisobga olib belgilanadi. Majburiyat kafe, oshxona va ishlab chiqarish uchun xodimlar sonidan qat’i nazar bir xil.",
          "Berish har bir xodimning SHHV shaxsiy hisob kartochkasida yoki umumiy jurnalda qayd etiladi. Odatda omborchi yoki administrator javob beradi, lavozimlar bo‘yicha ro‘yxatni esa rahbar tasdiqlaydi.",
        ],
      },
      {
        heading: "Sanitariya kiyimi va SHHV: adashtirmang",
        paragraphs: [
          "Oshpazning kurtkasi, qalpog‘i, fartugi — bu sanitariya kiyimi: u mahsulotni odamdan himoya qiladi va uning borligini Rospotrebnadzor SanPiN bo‘yicha tekshiradi. SHHV esa odamni ishlab chiqarishdan himoya qiladi: issiqqa chidamli qo‘lqoplar, idish yuvuvchining rezinalangan fartugi, sirpanmaydigan poyabzal, yuvish vositalari bilan ishlash uchun qo‘lqoplar. Ularning berilishini bitta jurnalda hisobga olish mumkin, lekin alohida qatorlarda — shunda nima qaysi me’yor bo‘yicha berilgani tushunarli bo‘ladi.",
        ],
      },
      {
        heading: "Berish va almashtirish tartibi",
        bullets: [
          "Me’yorlar va xavflarni baholash natijalari asosida har bir lavozim uchun SHHV ro‘yxatini tuzing.",
          "Ishga qo‘yishdan oldin bering, qabul qilingandan bir hafta keyin emas.",
          "Miqdor va taqish muddatini yozing, xodim olgani uchun imzo qo‘yadi.",
          "Eskirgan va shikastlangan SHHVni muddatidan oldin, sababini belgilab almashtiring.",
          "Ishdan bo‘shaganda taqish muddati tugamagan SHHV qaytarilganini belgilang.",
        ],
      },
      {
        heading: "Mehnat inspeksiyasi nimani tekshiradi",
        bullets: [
          "Berilganlar ro‘yxati lavozim me’yorlariga mos keladimi.",
          "Har bir berish uchun xodimning imzosi bormi.",
          "Xodim hozir foydalanayotgan vositalarning taqish muddati o‘tmaganmi.",
          "Berilgan SHHV uchun muvofiqlik sertifikati yoki deklaratsiyasi bormi.",
          "SHHV ish joyida ishlatiladimi — issiqqa chidamli qo‘lqoplar shkafchada emas, parokonvektomat yonida bo‘lishi kerak.",
        ],
      },
      {
        heading: "SHHV berilishini elektron hisobga olish",
        paragraphs: [
          "WeSetup’da berish me’yori har bir lavozim uchun bir marta belgilanadi. Servis kimga nima tegishli ekanini ko‘rsatadi, almashtirish muddatlarini hisoblaydi va ular haqida oldindan eslatadi. Xodim olganini telefon orqali tasdiqlaydi, sana va vaqt saqlanadi, jurnal esa inspeksiya uchun PDF ga yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "Bu yerda javobgarlik RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) bevosita nazarda tutilgan: SHHV bermaganlik va ular bilan ta’minlash tartibini buzganlik uchun. Berish jurnali ish beruvchi o‘z majburiyatini bajarganining asosiy dalilidir:",
      items: [
        "KoAP 5.27.1-moddasi 4-qismi — xodimlarni shaxsiy himoya vositalari bilan ta’minlamaslik: mansabdor shaxslar va yakka tartibdagi tadbirkorlar (YaTT) uchun 20 000 dan 30 000 ₽ gacha, yuridik shaxslar uchun 130 000 dan 150 000 ₽ gacha;",
        "KoAP 5.27.1-moddasi 1-qismi — mehnat muhofazasi talablarini buzish: mansabdor shaxslar va YaTT uchun 2 000 dan 5 000 ₽ gacha, yuridik shaxslar uchun 50 000 dan 80 000 ₽ gacha.",
      ],
      note: `${FINES_NOTE_UZ} Xodim imzosisiz SHHV berilganini, xarid yuk xatlari bo‘lsa ham, isbotlash qiyin.`,
    },
  },

  vitaminization: {
    sample: {
      caption:
        "Maktab oshxonasining uch kunlik yozuvlari: askorbin kislota tushlikning uchinchi taomiga qo‘shiladi, preparat miqdori porsiyalar soniga qarab hisoblangan. Qo‘shish va tarqatish orasida yarim soatdan ko‘p vaqt o‘tmasligi ko‘rinib turibdi.",
      columns: ["Sana", "Taom", "Preparat", "Qo‘shildi, g", "Porsiyalar", "Qo‘shilgan vaqt", "Tarqatilgan vaqt", "Mas’ul"],
      rows: [
        ["10.11.2026", "Quritilgan mevalar kompoti", "Askorbin kislota", "6,0", "120", "11:40", "12:10", "Sidorova T. N., hamshira"],
        ["11.11.2026", "Rezavor mevali kisel", "Askorbin kislota", "5,9", "118", "11:45", "12:15", "Sidorova T. N., hamshira"],
        ["12.11.2026", "Olma kompoti", "Askorbin kislota", "6,1", "122", "11:40", "12:05", "Sidorova T. N., hamshira"],
      ],
    },
    sections: [
      {
        heading: "C-vitaminlashtirish qayerda majburiy",
        paragraphs: [
          "Taomlarni vitaminlashtirish — SanPiN 2.3/2.4.4282-26 ning uyushgan jamoalar uchun talabi: bolalar bog‘chalari, maktablar, yozgi oromgohlar, shifoxonalar va sanatoriylar, qariyalar uylari. Kattalar uchun oddiy kafe va oshxonalar uni o‘tkazmaydi va bu jurnalni yuritmaydi.",
          "Agar maktab yoki bog‘cha uchun ovqatni keytering kompaniyasi tayyorlasa, majburiyat va jurnal vitaminni taomga qo‘shadigan tomonda qoladi — odatda bu tarqatish joyidagi oshxona.",
        ],
      },
      {
        heading: "Preparatni kim qo‘shadi va dozani qanday hisoblash kerak",
        paragraphs: [
          "Preparatni tibbiyot xodimi, u bo‘lmaganda esa buyruq bilan tayinlangan mas’ul shaxs, odatda bosh oshpaz qo‘shadi. Preparat miqdori bir porsiya uchun yosh me’yoriga qarab aniqlanadi va shu kungi porsiyalar soniga ko‘paytiriladi. Agar porsiyalar menyu-talabnomadagidan kam bo‘lsa, «kechagidek» emas, haqiqiy son bo‘yicha qayta hisoblanadi.",
          "Faqat ruxsat etilgan preparatlar yoki sanoatda ishlab chiqarilgan vitaminlashtirilgan ichimliklar ishlab chiqaruvchi yo‘riqnomasiga ko‘ra ishlatiladi. Preparat alohida, quruq va yorug‘likdan himoyalangan joyda saqlanadi.",
          "Agar vitamin taomga qo‘shilish o‘rniga vitaminlashtirilgan ichimlik berilsa, jurnalda aynan u ko‘rsatiladi: nomi, porsiyalar soni va berilgan vaqti. Preparat zaxiralari yozuvlar bilan solishtiriladi — sarf vitaminlashtirilgan porsiyalar soniga mos kelishi kerak.",
        ],
      },
      {
        heading: "Vitaminlashtirish tartibi bosqichma-bosqich",
        bullets: [
          "Uchinchi taomni sovuting — issiq taomda vitamin parchalanadi.",
          "O‘lchangan miqdorni taomning oz qismida eriting va qolgani bilan aralashtiring.",
          "Qo‘shilgan vaqtni, preparat miqdorini va porsiyalar sonini yozing.",
          "Taomni qayta isitmasdan, imkon qadar tez tarqating.",
          "Jurnalda imzo cheking; menyuda taom almashtirilsa — haqiqatda berilganini yozing.",
        ],
      },
      {
        heading: "Tekshiruvda eng ko‘p topiladigan xatolar",
        bullets: [
          "Yozuvlar faqat ish kunlari uchun, holbuki oromgoh yoki shifoxona dam olish kunlari ham ovqat beradi.",
          "Porsiyalar soni turlicha bo‘lsa ham preparat miqdori bir xil.",
          "Qo‘shilgan vaqt tarqatish vaqtidan keyin yozilgan yoki tushib qolgan.",
          "Jurnalda ko‘rsatilgan taom shu kun uchun tasdiqlangan menyuga mos kelmaydi.",
          "Yaroqlilik muddati o‘tgan yoki kelib chiqishini tasdiqlovchi hujjatlarsiz preparat.",
        ],
      },
      {
        heading: "WeSetup’da vitaminlashtirish jurnali",
        paragraphs: [
          "WeSetup’da porsiyalar soni kunlik menyudan olinadi, servis esa qancha preparat qo‘shish kerakligini darhol hisoblaydi. Hamshira qo‘shilganini telefon orqali belgilaydi, vaqt avtomatik qo‘yiladi, tushlikkacha yozuv bo‘lmasa rahbar eslatma oladi. Tekshiruv uchun jurnal odatiy shaklda PDF ga yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) vitaminlashtirish jurnali uchun alohida modda yo‘q. Bolalar yoki davolash muassasasida vitaminlashtirishni o‘tkazib yuborish ovqatlanishni tashkil etish talablarini buzish hisoblanadi, yozuvlarsiz esa korxona u o‘tkazilayotganini tasdiqlay olmaydi:",
      items: [
        "KoAP 6.6-moddasi — aholi ovqatlanishini tashkil etishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish;",
        "KoAP 6.3-moddasi — sanitariya-epidemiologik farovonlikni ta’minlash sohasidagi qonunchilikni buzish: yuridik shaxslar uchun 10 000 dan 20 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish.",
      ],
      note: `${FINES_NOTE_UZ} Byudjet muassasalari uchun jarimaga odatda ko‘rsatma va uning bajarilishini tekshirish qo‘shiladi.`,
    },
  },

  ration_control: {
    sample: {
      caption:
        "Bolalar bog‘chasining noyabr birinchi o‘n kunligi uchun qaydnomasi: har bir mahsulot guruhi bo‘yicha bir bolaga kuniga me’yor va haqiqatda berilgan miqdor, foizdagi og‘ish. Go‘sht kam berilgani izohda tushuntirilgan.",
      columns: ["Davr", "Mahsulot guruhi", "Me’yor, g", "Haqiqiy, g", "Og‘ish, %", "Izoh"],
      rows: [
        ["01.11–10.11.2026", "Sut va nordon sut mahsulotlari", "350", "342", "−2,3", "—"],
        ["01.11–10.11.2026", "Go‘sht", "55", "48", "−12,7", "05.11 da baliqqa almashtirildi, menyuni tuzatish kerak"],
        ["01.11–10.11.2026", "Baliq", "37", "44", "+18,9", "05.11 da go‘sht o‘rniga"],
        ["01.11–10.11.2026", "Yangi sabzavotlar", "280", "286", "+2,1", "—"],
        ["01.11–10.11.2026", "Yangi mevalar", "185", "170", "−8,1", "Olma yetkazib berishda uzilishlar"],
      ],
    },
    sections: [
      {
        heading: "Ratsion nazorati kimlar uchun majburiy",
        paragraphs: [
          "Haqiqiy ratsionni me’yorlar bilan solishtirishni uyushgan ovqatlanish yo‘lga qo‘yilgan muassasalar olib boradi: bolalar bog‘chalari, maktablar, oromgohlar, shifoxonalar, sanatoriylar, qariyalar uylari. Turli yoshlar va muassasa turlari uchun o‘rtacha kunlik mahsulotlar to‘plami me’yorlari SanPiN 2.3/2.4.4282-26 da belgilangan. Kafe va ishchilar oshxonalarida bunday me’yorlar yo‘q va ular qaydnoma yuritmaydi.",
        ],
      },
      {
        heading: "Haqiqiy ratsionni kim va qanday hisoblaydi",
        paragraphs: [
          "Tibbiyot xodimi, parhez hamshirasi yoki texnolog, maktabda esa ovqatlanish uchun mas’ul shaxs hisoblaydi. Manba — davr uchun menyu-talabnomalar va mahsulot berish yuk xatlari. Mahsulot miqdori kunlar soniga va ovqatlanuvchilar soniga bo‘linadi, natijada bir kishiga kuniga berilgan miqdor olinadi va me’yor bilan solishtiriladi.",
          "Faqat qozonga haqiqatda berilgani hisobga olinadi. Omborga kelgan, lekin menyuga ketmagan mahsulotlar hisobga kiritilmaydi — aks holda qaydnoma bo‘lmagan me’yor bajarilishini ko‘rsatadi.",
          "Hisoblash davri — ishlab chiqarish nazorati dasturida belgilanganidek, 10 kun yoki bir oy. Davr oxirida qaydnomani hisoblagan shaxs imzolaydi va rahbar tasdiqlaydi. Hisobni qayta tekshirish mumkin bo‘lishi uchun u menyu-talabnomalar va yuk xatlari bilan birga saqlanadi.",
        ],
      },
      {
        heading: "Me’yordan og‘ish bo‘lsa nima qilish kerak",
        bullets: [
          "Sababini izohda yozing: mahsulot almashtirilgani, yetkazib berishdagi uzilishlar, guruhdagi karantin.",
          "Kamomad teng qiymatli almashtirishlar jadvali bo‘yicha boshqa mahsulot bilan qoplanmaganini tekshiring.",
          "Mahsulot guruhi me’yorga chiqishi uchun keyingi davr menyusini tuzating.",
          "Muntazam kamomad bo‘lsa — faqat menyu bilan emas, xarid va porsiya chiqishi bilan ham shug‘ullaning.",
        ],
      },
      {
        heading: "Rospotrebnadzor va ota-onalar nimaga qaraydi",
        paragraphs: [
          "Tekshiruvchi qaydnomani menyu, yuk xatlari va tayyor mahsulot brakeraji bilan solishtiradi: agar qaydnoma bo‘yicha go‘sht me’yori bajarilgan, menyuda esa go‘shtli taomlar kam uchrasa, hisob shubha ostiga olinadi. Maktablarda ota-onalar nazorati ham bunday qaydnomalarni tobora ko‘proq so‘ramoqda. Izoh va menyu tuzatishi bilan bir-ikkita og‘ish savol tug‘dirmaydi, izohsiz surunkali kamomad esa ko‘rsatma berishga sabab bo‘ladi.",
        ],
      },
      {
        heading: "Ratsionni elektron hisoblash",
        paragraphs: [
          "WeSetup’da qaydnoma davr uchun menyu va hisobdan chiqarishlardan yig‘iladi, og‘ishlar avtomatik hisoblanadi va ruxsat etilgan chegaradan chiqsa, ajratib ko‘rsatiladi. Mas’ul shaxsga hisobni tekshirish va sababini izohga yozish, tekshiruv uchun esa jadvalni PDF ga yuklab olish qoladi.",
        ],
      },
    ],
    fines: {
      intro:
        "Qaydnomaning o‘zi uchun alohida jarima yo‘q. Ammo bolalar yoki davolash muassasasida ovqatlanish me’yorlarini bajarmaslik ovqatlanishni tashkil etish talablarini buzish bo‘lib, RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksi (KoAP) bo‘yicha jazolanadi, yozuvlar esa buni tekshirishdagi asosiy hujjatdir:",
      items: [
        "KoAP 6.6-moddasi — aholi ovqatlanishini tashkil etishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish.",
      ],
      note: `${FINES_NOTE_UZ} Shartnoma asosida ovqat yetkazib beruvchi uchun me’yorlarning kam berilishi buyurtmachining da’volariga ham asos bo‘lishi mumkin.`,
    },
  },

  daily_samples: {
    sample: {
      caption:
        "Maktab oshxonasida tushlikdan namuna olish: har bir taomdan, jumladan garnir va nondan kamida 100 g olingan, non — butun bo‘lak holida. Yo‘q qilish sanasi darhol — namuna olingandan 48 soat keyinga belgilangan.",
      columns: ["Sana, ovqatlanish", "Taom", "Namuna massasi, g", "Olingan vaqt", "Saqlash, °C", "Yo‘q qilish", "Olgan"],
      rows: [
        ["17.11.2026, tushlik", "No‘xat sho‘rva", "100", "12:05", "+4", "19.11 soat 12:10 da", "Ivanova M. P."],
        ["17.11.2026, tushlik", "Tovuq kotleti", "1 dona, 82", "12:07", "+4", "19.11 soat 12:10 da", "Ivanova M. P."],
        ["17.11.2026, tushlik", "Kartoshka pyuresi", "120", "12:07", "+4", "19.11 soat 12:10 da", "Ivanova M. P."],
        ["17.11.2026, tushlik", "Quritilgan mevalar kompoti", "150", "12:08", "+4", "19.11 soat 12:10 da", "Ivanova M. P."],
        ["17.11.2026, tushlik", "Javdar noni", "1 bo‘lak", "12:08", "+4", "19.11 soat 12:10 da", "Ivanova M. P."],
      ],
    },
    sections: [
      {
        heading: "Sutkalik namunalar qayerda olinadi",
        paragraphs: [
          "Namunalar uyushgan jamoalarda majburiy: bolalar bog‘chalari, maktablar, oromgohlar, shifoxonalar, sanatoriylarda, shuningdek ular uchun shartnoma asosida ovqat tayyorlaydiganlarda. Talab SanPiN 2.3/2.4.4282-26 da belgilangan. Oddiy kafelar namuna olmaydi, lekin ko‘plab korxona oshxonalari va tadbirlarga xizmat ko‘rsatuvchi keytering buni ixtiyoriy ravishda qiladi — namuna ularni ham himoya qiladi.",
        ],
      },
      {
        heading: "Namunani qanday to‘g‘ri olish va saqlash kerak",
        bullets: [
          "Har bir ovqatlanishdagi har bir taomdan, jumladan garnir, sous, non va ichimliklardan ham — brakerajdan keyin va tarqatish boshlanishidan oldin olinadi.",
          "Porsiyali namuna massasi — kamida 100 g; dona mahsulotlar (kotletlar, sirniklar, piroglar) butunligicha, kamida bitta dona olinadi.",
          "Idish — toza, qaynatilgan yoki ishlov berilgan, qopqoqli; har bir taom — alohida idishda.",
          "Idishda markirovka: sana, ovqatlanish, taom nomi.",
          "48 soat davomida alohida sovutkichda yoki ajratilgan tokchada +2…+6 °C da, begonalar kira olmaydigan joyda saqlanadi.",
        ],
      },
      {
        heading: "Kim javob beradi va 48 soatdan keyin nima qilinadi",
        paragraphs: [
          "Namunalarni buyruq bilan tayinlangan oshpaz yoki tibbiyot xodimi oladi — yo‘q qilish uchun ham aynan shu odam javob beradi. 48 soat o‘tgach namunalar yo‘q qilinadi, idishlar esa yuviladi va dezinfeksiya qilinadi. Agar shu ikki sutka ichida ovqatlanganlardan kimdir kasal bo‘lib qolsa, namunalar tashlanmaydi: ular Rospotrebnadzor mutaxassislari kelguncha saqlanadi.",
        ],
      },
      {
        heading: "Namunani foydasiz qiladigan xatolar",
        bullets: [
          "Hamma taomlardan olinmagan — masalan, non yoki qo‘shimcha menyudagi salat yo‘q.",
          "Namuna 100 g dan kam yoki kotletning yarmi olingan.",
          "Namunalar umumiy sovutkichda mahsulotlar bilan birga turibdi.",
          "Saqlash harorati haqida yozuv yo‘q yoki sovutkich termometr bilan nazorat qilinmaydi.",
          "Namunalar «joy bo‘shatish uchun» muddatidan oldin yo‘q qilingan.",
        ],
      },
      {
        heading: "Sutkalik namunalar jurnali elektron shaklda",
        paragraphs: [
          "WeSetup’da ovqatlanish taomlari ro‘yxati kunlik menyudan olinadi, oshpaz namuna olinganini telefonda belgilaydi va qaysi taomlardan namuna hali olinmaganini ko‘radi. Olingan vaqt avtomatik qayd etiladi, yo‘q qilish sanasi darhol qo‘yiladi, 48 soatdan keyin esa eslatma keladi. Jurnal qog‘oz blanka shaklida PDF ga yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) sutkalik namunalar uchun alohida modda yo‘q. Namunalar yoki ular haqidagi yozuvlarning yo‘qligi SanPiN ning ovqatlanishni tashkil etish talablarini buzish hisoblanadi, jamoada zaharlanish yuz berganda esa jiddiy og‘irlashtiruvchi holatga aylanadi:",
      items: [
        "KoAP 6.6-moddasi — aholi ovqatlanishini tashkil etishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish;",
        "KoAP 6.3-moddasi — sanitariya-epidemiologik farovonlikni ta’minlash sohasidagi qonunchilikni buzish: yuridik shaxslar uchun 10 000 dan 20 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish.",
      ],
      note: `${FINES_NOTE_UZ} Namunalarsiz oshxona zaharlanish sababi uning taomlarida emasligini isbotlay olmaydi.`,
    },
  },

  complaint_register: {
    sample: {
      caption:
        "Ikki haftalik yozuvlar: har bir shikoyat uchun kanal, mohiyati, tekshiruv natijasi va ko‘rilgan choralar. Oxirgi ustun holat yopilganmi va mehmon qanday javob olganini ko‘rsatadi.",
      columns: ["Sana", "Kanal", "E’tiroz mohiyati", "Tekshiruv", "Choralar", "Holat"],
      rows: [
        ["03.11.2026", "Og‘zaki, zalda", "Sovib qolgan sho‘rva", "Tarqatishdagi harorat 58 °C, marmit yoqilmagan", "Taom almashtirildi, ofitsiantlarga yo‘riqnoma", "Yopildi"],
        ["07.11.2026", "Saytdagi sharh", "Salatda soch", "Oshpaz smenada qalpoqsiz", "Uzr va kompensatsiya, sanitariya kiyimini tekshirish", "Yopildi"],
        ["11.11.2026", "Telefon", "Yetkazib berilgan ovqatdan keyin ahvol yomonlashgan", "Brakeraj va sutkalik namunalarda og‘ish yo‘q, boshqa mehmonlardan shikoyat yo‘q", "Mehmonga javob, kuzatuv", "Yopildi"],
        ["15.11.2026", "Ijtimoiy tarmoqlar", "Tarkibda allergen ko‘rsatilmagan", "Yetkazib berish menyusida yong‘oq haqida belgi yo‘q", "Menyu tuzatildi", "Jarayonda"],
      ],
    },
    sections: [
      {
        heading: "Har bir shikoyatni nima uchun ro‘yxatga olish kerak",
        paragraphs: [
          "RF «Iste’molchilar huquqlarini himoya qilish to‘g‘risida»gi qonuni mehmonga sifatsiz xizmat uchun taomni almashtirish, narxni kamaytirish yoki pulni qaytarishni talab qilish huquqini beradi va da’voga javob berish muddatlarini belgilaydi. Ro‘yxatga olish da’vo qabul qilingani va o‘z vaqtida ko‘rib chiqilganini ko‘rsatadi.",
          "HACCP tizimi uchun shikoyat — jarayondagi nosozlik signali. Sovuq taom haqida bitta shikoyat — tasodif, bir oyda uchta — tarqatishdagi harorat nazorati ishlamayotgani. Yagona reyestrsiz bunday takrorlanishlar ko‘rinmaydi.",
        ],
      },
      {
        heading: "Nimalarni ro‘yxatga olish kerak",
        bullets: [
          "Sifat va xavfsizlikka oid da’volar: begona narsalar, ta’m, hid, harorat, kam solinganlik.",
          "Ovqatdan keyin ahvol yomonlashgani haqidagi xabarlar — mehmon kompensatsiya talab qilmasa ham.",
          "Allergenlar va taom tarkibi bilan bog‘liq shikoyatlar.",
          "Saytlar va ijtimoiy tarmoqlardagi sharhlar, agar ularda aniq holat tasvirlangan bo‘lsa.",
          "Keytering buyurtmachilari va ovqat yetkazib beriladigan tashkilotlarning da’volari.",
        ],
      },
      {
        heading: "Shikoyatni qanday tahlil qilish kerak",
        paragraphs: [
          "Mas’ul shaxs — zal menejeri, boshqaruvchi yoki texnolog — murojaat kuni mohiyatini, sanani va aloqa ma’lumotini yozadi. So‘ng shu taom bo‘yicha yozuvlarni ko‘rib chiqadi: tayyor mahsulot brakeraji, harorat, smenaning gigiyenik ko‘rigi, agar olinsa — sutkalik namunalar. Natijalarga ko‘ra sababni va chorani belgilaydi: yo‘riqnoma, yetkazib beruvchini almashtirish, texnologik kartani o‘zgartirish.",
          "Agar mehmon zaharlanish alomatlari haqida xabar bersa, o‘sha kuniyoq tahlil qilish kerak: mahsulot qoldiqlari va namunalarni saqlab qolish, xomashyo partiyasini tashlamaslik, o‘xshash murojaatlar bor-yo‘qligini tekshirish.",
        ],
      },
      {
        heading: "Tekshiruv va auditda nimalarga qaraladi",
        bullets: [
          "Har bir shikoyat bo‘yicha faqat «uzr so‘raldi» emas, sabab haqida xulosa bormi.",
          "Tuzatuvchi choralar yopilganmi va ularning samaradorligi tekshirilganmi.",
          "Ro‘yxatga olingan shikoyatlar ochiq platformalardagi sharhlarga mos keladimi.",
          "HACCP rejasi qayta ko‘rib chiqilganda takroriy shikoyatlar tahlil qilinadimi.",
        ],
      },
      {
        heading: "WeSetup’da shikoyatlar reyestri",
        paragraphs: [
          "WeSetup’da shikoyat to‘g‘ridan-to‘g‘ri zalda telefon orqali ro‘yxatga olinadi va darhol ijrochi hamda muddat ko‘rsatilgan tuzatuvchi harakat vazifasiga aylanadi. Rahbar yopilmagan holatlar va takrorlanuvchi sabablarni ko‘radi, tekshiruvda esa jurnalni ko‘rilgan choralar tarixi bilan birga PDF ga yuklab oladi.",
        ],
      },
    ],
    fines: {
      intro:
        "Qonun bunday jurnalni yuritish majburiyatini bevosita belgilamaydi: bu HACCP tizimining tartibi. RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksi (KoAP) bo‘yicha jarima shikoyat ortida turgan narsa uchun solinadi — sifatsiz taom yoki shikoyat orqali aniqlangan sanitariya talablarining buzilishi uchun:",
      items: [
        "KoAP 14.4-moddasi 1-qismi — sifatsiz tovar sotish, sifatsiz ish bajarish yoki xizmat ko‘rsatish: yuridik shaxslar uchun 20 000 dan 30 000 ₽ gacha;",
        "KoAP 6.6-moddasi — aholi ovqatlanishini tashkil etishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish.",
      ],
      note: `${FINES_NOTE_UZ} Mehmonning Rospotrebnadzorga shikoyati ko‘pincha rejadan tashqari tekshiruvga sabab bo‘ladi, tahlillar yozilgan reyestr esa korxona o‘zi choralar ko‘rayotganini ko‘rsatadi.`,
    },
  },

  finished_product: {
    sample: {
      caption:
        "Oshxonada tushlik brakeraji: har bir taom tashqi ko‘rinishi, ta’mi va hidi bo‘yicha baholangan, harorati o‘lchangan, komissiya tarqatishga ruxsat bergan. Bitta taom tarqatishdan olingan — sababi qatorda ko‘rsatilgan.",
      columns: ["Vaqt", "Taom", "Organoleptika", "Harorat, °C", "Qaror", "Komissiya"],
      rows: [
        ["11:30, 17.11.2026", "Lapshali tovuq sho‘rva", "E’tirozsiz", "78", "Tarqatishga ruxsat berildi", "Ivanova M. P., Kuznetsov D. V."],
        ["11:35, 17.11.2026", "Mol go‘shtidan gulyash", "E’tirozsiz", "74", "Tarqatishga ruxsat berildi", "Ivanova M. P., Kuznetsov D. V."],
        ["11:40, 17.11.2026", "Qaynatilgan guruch", "Yopishib qolgan, haddan tashqari qurigan", "70", "Olib tashlandi, yangi partiya tayyorlandi", "Ivanova M. P., Kuznetsov D. V."],
        ["11:55, 17.11.2026", "Qaynatilgan guruch, yangi partiya", "E’tirozsiz", "72", "Tarqatishga ruxsat berildi", "Ivanova M. P., Kuznetsov D. V."],
        ["12:00, 17.11.2026", "Yangi karam salati", "E’tirozsiz", "8", "Tarqatishga ruxsat berildi", "Ivanova M. P., Kuznetsov D. V."],
      ],
    },
    sections: [
      {
        heading: "Brakeraj komissiyasi tarkibiga kimlar kiradi",
        paragraphs: [
          "Komissiya tarkibini rahbar buyruq bilan tasdiqlaydi. Kafe va restoranda bu odatda bosh oshpaz yoki su-shef va ikkinchi xodim — texnolog yoki administrator. Maktab va bog‘chada komissiyaga tibbiyot xodimi va ma’muriyat vakili kiradi, menyu va brakerajni ota-onalar nazorati ham tekshirishi mumkin. Ishlab chiqarishda — texnolog va smena ustasi.",
          "Taomni tayyorlagan oshpaz qatnashishi mumkin, lekin qarorni komissiya qabul qiladi: o‘z ishingizni o‘zingiz baholay olmaysiz.",
        ],
      },
      {
        heading: "Brakerajni qanday o‘tkazish kerak",
        bullets: [
          "Butun smena uchun bitta taomni emas, har bir partiyani tarqatish boshlanishidan oldin baholang.",
          "Texnologik karta bilan solishtiring: chiqish, tashqi ko‘rinish, konsistensiya, rang, hid, ta’m.",
          "Haroratni yuzasida emas, taomning ichida zond bilan o‘lchang.",
          "Toza asbob bilan, har bir taom uchun alohida qoshiq bilan tatib ko‘ring.",
          "Qaror va tarqatishga ruxsat berilgan vaqtni yozing; belgisiz taom berilmaydi.",
        ],
      },
      {
        heading: "Agar taom brakerajdan o‘tmasa",
        paragraphs: [
          "Taom tarqatishdan olinadi va sababi aniq yoziladi: «tuzi kam», «begona hid», «harorat me’yordan past». Agar nuqson xavfsiz tuzatilsa — isitish, tayyor holga keltirish — qayta ishlangandan keyin alohida qatorda takroriy brakeraj o‘tkaziladi. Buzilish belgilari, begona aralashmalar bo‘lgan yoki go‘sht va parranda yetarlicha issiqlik ishlovidan o‘tmagan taom tuzatilmaydi, balki hisobdan chiqariladi.",
          "Bitta taom bo‘yicha takrorlanuvchi e’tirozlar — texnologik kartani qayta ko‘rib chiqish yoki oshpaz bilan yo‘riqnoma o‘tkazish uchun sabab.",
        ],
      },
      {
        heading: "Tekshiruvchi nimalarga qaraydi",
        bullets: [
          "Brakeraj vaqti tushlikdan keyin emas, tarqatish boshlanishidan oldin.",
          "Kunlik menyudagi barcha taomlar, jumladan garnirlar, souslar va ichimliklar jurnalda bor.",
          "Baho aniq — «e’tirozsiz» deyish mumkin, lekin butun kun uchun bitta belgi bilan emas.",
          "Komissiyaning barcha a’zolari imzosi bor, tarkib buyruqqa mos keladi.",
        ],
      },
      {
        heading: "Brakeraj jurnali telefonda",
        paragraphs: [
          "WeSetup’da smena taomlari menyu yoki hisob tizimidan olinadi, komissiya a’zosi har birini tarqatish liniyasi yonida telefon orqali baholaydi va haroratni kiritadi. Yozuv vaqti avtomatik qo‘yiladi, tarqatishdan olingan taomlar rahbarga darhol ko‘rinadi, jurnal esa qog‘oz blanka shaklida PDF ga yuklab olinadi.",
        ],
      },
    ],
    fines: {
      intro:
        "RF Ma’muriy huquqbuzarliklar to‘g‘risidagi kodeksida (KoAP) brakeraj yozuvlari yo‘qligi uchun alohida modda yo‘q. Ammo taomlarni sifat nazoratisiz berish SanPiN 2.3/2.4.4282-26 va TR TS 021/2011 talablarini, sifatsiz taom esa iste’molchi huquqlarini buzadi:",
      items: [
        "KoAP 6.6-moddasi — aholi ovqatlanishini tashkil etishga oid sanitariya-epidemiologiya talablarini buzish: yuridik shaxslar uchun 20 000 dan 40 000 ₽ gacha jarima yoki faoliyatni 90 sutkagacha to‘xtatib qo‘yish;",
        "KoAP 14.43-moddasi — texnik reglamentlar (TR TS 021/2011) talablarini buzish: yakka tartibdagi tadbirkorlar (YaTT) uchun 20 000 dan 30 000 ₽ gacha, yuridik shaxslar uchun 100 000 dan 300 000 ₽ gacha;",
        "KoAP 14.4-moddasi 1-qismi — sifatsiz tovar sotish, sifatsiz ish bajarish yoki xizmat ko‘rsatish: yuridik shaxslar uchun 20 000 dan 30 000 ₽ gacha.",
      ],
      note: FINES_NOTE_UZ,
    },
  },
};
