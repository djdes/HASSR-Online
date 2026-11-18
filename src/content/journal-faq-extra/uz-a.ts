import type { JournalFaqExtra } from "./types";

/**
 * Additional journal FAQ (uz, part A): staff, organised catering and
 * sanitary journals. Translation of `FAQ_EXTRA_RU_A` with the same keys,
 * item count and order.
 */
export const FAQ_EXTRA_UZ_A: JournalFaqExtra = {
  hygiene: [
    {
      q: "Xodimlari yo‘q YaTT gigiyena jurnalini yuritishi kerakmi?",
      a: "Smena oldidan ko‘rik oziq-ovqat mahsulotlari bilan ishlaydigan har bir kishiga taalluqli, sanitariya qoidalarida esa egasi uchun alohida istisno yo‘q. Agar YaTT o‘zi ovqat tayyorlasa, qadoqlasa yoki mahsulot sotsa, odatda jurnal o‘ziga nisbatan ham yuritiladi: kuniga harorat va ishga ruxsat belgisi bilan bitta qator. Bu bir daqiqa vaqt oladi va tekshiruvda savol tug‘dirmaydi. Yordamchilar, stajyorlar yoki shartnoma bo‘yicha ishlovchilar paydo bo‘lishi bilan ular birinchi kundan jurnalga kiritiladi.",
    },
    {
      q: "Gigiyena jurnalida kim imzo chekadi — xodimmi yoki mas’ul shaxsmi?",
      a: "Ishga ruxsat haqidagi qarorni buyruq bilan tayinlangan ko‘rik uchun mas’ul shaxs imzolaydi: bosh oshpaz, smena administratori yoki tibbiyot xodimi. Xodim ham odatda imzo chekadi — u o‘z ahvoli, oiladagi ichak infeksiyalari va qo‘lidagi yaralar haqida xabar berganini tasdiqlaydi. Mas’ul shaxs o‘zini o‘zi ko‘rikdan o‘tkazmaydi: uning ishga ruxsatini o‘rinbosari yoki rahbar imzolaydi.",
    },
    {
      q: "Oshpazlardan tashqari yana qaysi xodimlar gigiyena jurnaliga yoziladi?",
      a: "Mahsulotlar, toza idishlar va anjomlar bilan aloqada bo‘ladigan barcha xodimlar: qandolatchilar, oshxona ishchilari, idish yuvuvchilar, ofitsiantlar, barmenlar va baristalar, tarqatuvchilar, omborchilar. Tarqatishda yoki barda yordam beradigan administrator ham ko‘rikdan o‘tkaziladi. Agar odam jadval bo‘yicha smenada bo‘lsa-yu, u bo‘yicha qator bo‘lmasa, tekshiruvchi buni o‘tkazib yuborilgan ko‘rik deb hisoblaydi.",
    },
    {
      q: "Gigiyena jurnali salomatlik jurnalidan nimasi bilan farq qiladi?",
      a: "Mohiyatan bu smena oldidan o‘tkaziladigan bitta ko‘rikning o‘zi. Gigiyena jurnalida mas’ul shaxs yakunni — ruxsat berildi yoki chetlatildi — qayd etadi, salomatlik jurnalida esa har bir belgini alohida belgilaydi: harorat, O‘RVI, ichak buzilishlari, qo‘l terisining holati. Ikkala shaklni bir vaqtda yuritish shart emas: bittasi tanlanadi va ishlab chiqarish nazorati dasturida mustahkamlanadi. Xodimlari kam kafega odatda gigiyena jurnalining o‘zi yetarli.",
    },
  ],

  health_check: [
    {
      q: "Salomatlik jurnali blankasini qayerdan bepul yuklab olish mumkin?",
      a: "Shu sahifada: «PDF formatida yuklab olish» tugmasi bo‘sh blankani beradi, Word (DOCX) varianti ham bor. Yuklab olishda ko‘rsatgan tashkilot nomingiz darhol blanka sarlavhasiga qo‘yiladi, varaqlarni chop etish qoladi, xolos. Qog‘oz yuritishni istamasangiz, jurnalni elektron to‘ldirish mumkin — dastlabki 14 kun bepul, xuddi shu shakldagi PDF eksport bilan.",
    },
    {
      q: "Salomatlik jurnali qachon to‘ldiriladi — smenadan oldinmi yoki kun oxiridami?",
      a: "Faqat ish boshlanishidan oldin: har bir xodim sanitariya kiyimini kiyishdan va sexga kirishdan oldin ko‘rikdan o‘tkaziladi, kech qolganlar esa kelishi bilanoq. Smena oxirida butun kun uchun to‘ldirish qoidabuzarlik hisoblanadi: agar infeksiya belgilari bor odam smenani ishlab bo‘lgan bo‘lsa, orqa sana bilan qo‘yilgan «ruxsat berildi» belgisi hech narsadan himoya qilmaydi va tekshiruvda rasmiyatchilik uchun yuritilgan hisobga o‘xshaydi.",
    },
    {
      q: "Xodim dam olishda, ta’tilda yoki kasallik varaqasida bo‘lsa, salomatlik jurnaliga nima qo‘yiladi?",
      a: "Bo‘sh katakni tekshiruvchi o‘tkazib yuborilgan ko‘rik deb qabul qilishi mumkin, shuning uchun uning o‘rniga yo‘qlik maqomi qo‘yiladi: «V» — dam olish kuni, «Otp» — ta’til, «B/l» — kasallik varaqasi. Belgilarning izohi sarlavhada yoki jadval ostida beriladi. Kasallik varaqasidan keyin xodim ishga chiqqan kuni qaytadan ko‘rikdan o‘tkaziladi, sabab ichak infeksiyasi bo‘lgan bo‘lsa, shifokordan hujjat so‘raladi. Elektron jurnalda maqomlar smenalar jadvalidan avtomatik qo‘yiladi.",
    },
    {
      q: "Harorati bo‘lmasa, tumovi bor oshpazni ishga qo‘yish mumkinmi?",
      a: "Yo‘q. O‘RVI belgilari — tumov, yo‘tal, tomoq og‘rig‘i — harorat me’yorda bo‘lsa ham oziq-ovqat bilan ishlashdan chetlatish uchun asos bo‘ladi: qo‘zg‘atuvchi mahsulotlarga qo‘ldan va aksirganda tushadi. Jurnalda belgi va «chetlatildi» qarori qayd etiladi, xodim shifokorga yuboriladi. Agar smena oshpazsiz qolsa, buni rahbar kasal xodimni ishga qo‘yish bilan emas, odamlarni qayta taqsimlash bilan hal qiladi.",
    },
  ],

  med_books: [
    {
      q: "Tibbiy daftarchalarni hisobga olish jurnali blankasini qayerdan bepul yuklab olish mumkin?",
      a: "Shu sahifadagi «PDF formatida yuklab olish» tugmasi tayyor ustunli bo‘sh blankani beradi: F.I.Sh. va lavozim, tibbiy daftarcha raqami, oxirgi va keyingi tibbiy ko‘rik sanalari, flyuorografiya va emlashlar. Yuklab olishda tashkilot nomi sarlavhaga qo‘yiladi. Sanalarni qo‘lda kuzatishni istamasangiz, hisobni elektron yuritish mumkin — 14 kun bepul, ko‘rik muddati tugashidan 30 kun oldin eslatma bilan.",
    },
    {
      q: "Kafe va restoranda kimga tibbiy daftarcha majburiy?",
      a: "Ovqatni qabul qilish, saqlash, tayyorlash va tarqatish, idish yuvish va mehmonlarga xizmat ko‘rsatishda ishtirok etadigan barchaga: oshpazlar, qandolatchilar, oshxona ishchilari, idish yuvuvchilar, ofitsiantlar, barmenlar, omborchilar, ekspeditorlar, shuningdek sex va zalda ishlaydigan boshqaruvchilarga. Stajyorlar, o‘rindoshlar va mavsumiy xodimlar ham daftarchasiz smenaga chiqa olmaydi. Sex va zalga kirmaydigan ofis xodimlariga daftarcha odatda kerak emas.",
    },
    {
      q: "Elektron tibbiy daftarchalar (ELMK) qanday hisobga olinadi?",
      a: "Qog‘oz daftarchalar kabi: jurnalga Rospotrebnadzor reyestridagi elektron daftarcha raqami, tibbiy ko‘rik, tekshiruvlar va gigiyenik attestatsiya sanalari hamda keyingi ko‘rik sanasi kiritiladi. Raqam va sanalarni hujjatning o‘zi bilan solishtiring — tekshiruvda ular reyestr bilan taqqoslanadi. Bitta korxonada bir vaqtning o‘zida ham qog‘oz, ham elektron daftarchalar bo‘lishi mumkin, ular uchun hisob umumiy.",
    },
    {
      q: "Xodimlarning tibbiy daftarchalari qayerda saqlanadi — ish beruvchidami yoki xodimdami?",
      a: "Tartib tashkilotning ichki hujjati bilan belgilanadi. Ko‘pincha qog‘oz daftarchalar xodim ishlaydigan nuqtadagi ma’muriyatda saqlanadi va tibbiy ko‘rik vaqtida yoki ishdan bo‘shaganda imzo qo‘ydirib beriladi — shunda tekshiruvda daftarcha doim joyida bo‘ladi. Agar daftarchani xodimning o‘zi saqlasa, u birinchi talabdayoq uni olib kelishi shart, jurnalda esa baribir ko‘rik sanalari yuritiladi.",
    },
  ],

  training_plan: [
    {
      q: "Kichik kafega HACCP bo‘yicha o‘qitish rejasi kerakmi?",
      a: "Ha, agar kafe oziq-ovqat mahsuloti tayyorlasa: TR TS 021/2011 ning 10-moddasiga ko‘ra HACCP tamoyillariga asoslangan protseduralar maydon va xodimlar sonidan qat’i nazar majburiy. 5–10 kishilik kafe uchun reja bir sahifani egallaydi: yangi xodimlar uchun kirish o‘qitishi, oshpazlar uchun nazorat nuqtalari, idish yuvuvchilar uchun yuvish va dezinfeksiya, oshxona va zal uchun allergenlar — yarim yilda yoki yilda bir marta davriylik bilan.",
    },
    {
      q: "HACCP bo‘yicha o‘qitishni guvohnoma beradigan o‘quv markazida o‘tish kerakmi?",
      a: "Qonun tashqi kurslarni talab qilmaydi: muhimi, xodimlar aynan sizning ishlab chiqarishingiz protseduralarini bilishi va bu yozuvlar bilan tasdiqlanishi. O‘qitishni texnolog, bosh oshpaz yoki HACCP guruhi rahbari ichki materiallar asosida o‘tkazishi mumkin. Tashqi kurs HACCP rejasini ishlab chiquvchi uchun foydali, ammo sizning nazorat nuqtalaringiz bo‘yicha yo‘riqnomalarni almashtirmaydi. Buni tibbiy daftarcha uchun gigiyenik attestatsiya bilan adashtirmang — bu alohida majburiyat.",
    },
    {
      q: "O‘qitish rejasi yo‘riqnomalarni ro‘yxatga olish jurnalidan nimasi bilan farq qiladi?",
      a: "Reja — bir yil oldinga tuziladigan hujjat: qaysi mavzular, qaysi lavozimlar uchun, qanchalik tez-tez va kim o‘tkazadi. Ro‘yxatga olish jurnali — fakt: sana, mavzu, F.I.Sh. va imzolar. Tekshiruvchi ularni bir-biri bilan solishtiradi: rejadagi mavzu jurnalda yozuvsiz bo‘lsa, o‘tkazilmagan hisoblanadi, rejada yo‘q mashg‘ulotning esa tushunarli sababi bo‘lishi kerak — yangi uskuna, vosita almashtirilishi, mehmon shikoyati.",
    },
    {
      q: "Xodimlarni HACCP bo‘yicha o‘qitish rejasi namunasini qayerdan olish mumkin?",
      a: "Lavozimlar bo‘yicha mavzular yozilgan namuna shu sahifada yuqorida bor — uni asos qilib olish qulay. Ammo tayyor shablonni o‘zingizga moslab qayta ishlash kerak: tekshiruvchi reja sizning ishlab chiqarishingiz xavflariga mos kelishini tekshiradi. HACCP rejangizdagi nazorat nuqtalaridan boshlang, haqiqatda ishlatiladigan vositalar va uskunalar bo‘yicha mavzular qo‘shing, sizda yo‘q narsalarni esa olib tashlang.",
    },
  ],

  staff_training: [
    {
      q: "Kafeda HACCP bo‘yicha yo‘riqnomani kim o‘tkazishi mumkin?",
      a: "Qonun maxsus guvohnoma talab qilmaydi. Yo‘riqnomani protseduralarni o‘zi yaxshi biladigan xodim o‘tkazadi: texnolog, bosh oshpaz, su-shef, HACCP guruhi rahbari yoki taklif qilingan mutaxassis. U o‘qitish rejasida ko‘rsatiladi yoki buyruq bilan tayinlanadi. Muhimi, o‘tkazuvchi mavzu bo‘yicha savollarga javob bera olishi va jurnalda o‘qitilayotgan xodim yonida imzo chekishi kerak.",
    },
    {
      q: "Bir-ikki kunga chiqqan stajyorga yo‘riqnoma kerakmi?",
      a: "Ha. Kirish o‘qitishi mahsulotlarga qo‘yilgan har qanday kishiga mustaqil ish boshlanishidan oldin o‘tkaziladi: stajyor, o‘rindosh, mavsumiy yoki vaqtinchalik xodim. Qisqa stajirovka uchun shaxsiy gigiyena, sanitariya kiyimi va sex qoidalari bo‘yicha kirish yo‘riqnomasi yetarli, lekin jurnalda birinchi kun sanasi bilan yozuv bo‘lishi kerak — aks holda odam smenalar jadvalida bor-u, o‘qitish yo‘q bo‘lib chiqadi.",
    },
    {
      q: "Xodim yo‘riqnomani o‘zlashtirganini qanday tekshirish mumkin?",
      a: "Imzo faqat qatnashganini tasdiqlaydi. Bilim mavzu bo‘yicha qisqa og‘zaki so‘rov yoki 5–10 savollik test bilan, ish joyida esa ko‘rsatib berishni so‘rash orqali tekshiriladi: kritik nuqta qayerda, uning chegarasi qanday va og‘ish bo‘lganda nima qilish kerak. Natija izohda yoziladi. Agar xodim javob bera olmasa, yo‘riqnoma takrorlanadi va haqiqiy sana bilan yangi yozuv qilinadi.",
    },
    {
      q: "HACCP bo‘yicha takroriy yo‘riqnoma qanchalik tez-tez o‘tkaziladi?",
      a: "Qonun yagona davriylikni belgilamaydi — uni tasdiqlangan o‘qitish rejasi belgilaydi. Odatda har bir mavzu yarim yilda yoki yilda bir marta, xodimlar xato qilgan mavzular esa tez-tez takrorlanadi. Rejali yo‘riqnomadan tashqari, yangi uskuna paydo bo‘lganda, yuvish vositasi yoki retseptura almashganda rejadan tashqari yo‘riqnoma, jiddiy og‘ish yoki mehmon shikoyatidan keyin esa maqsadli yo‘riqnoma o‘tkaziladi.",
    },
  ],

  ppe_issuance: [
    {
      q: "Shaxsiy himoya vositalari uchun kim to‘laydi — ish beruvchimi yoki xodimmi?",
      a: "Ish beruvchi, o‘z hisobidan — bu mehnat qonunchiligi bo‘yicha uning bevosita majburiyati. Narxini ish haqidan ushlab qolish yoki xodimdan qo‘lqop va poyabzalni o‘zi sotib olishni so‘rash mumkin emas. Xodim esa o‘z navbatida berilgan shaxsiy himoya vositalaridan foydalanishi va ular yaroqsiz holga kelgani haqida xabar berishi shart — shunda ular muddatidan oldin, jurnalga yozilgan holda almashtiriladi.",
    },
    {
      q: "Bir martalik qo‘lqoplarning har bir jufti uchun imzo chekish kerakmi?",
      a: "Yo‘q. Bir martalik qo‘lqoplar sarflanishiga qarab partiyalab, masalan bir hafta yoki bir oyga beriladi: sana, dona yoki qadoqdagi miqdori va oluvchining familiyasi yoziladi, xodim partiya uchun imzo chekadi. Shunda qo‘lqoplar muntazam berilayotgani va ularning sarfi xaridlarga mos kelishi ko‘rinib turadi.",
    },
    {
      q: "Oshxona xodimlarining shaxsiy himoya vositalari qanchalik tez-tez almashtiriladi?",
      a: "Kiyish muddati lavozim uchun berish me’yorlaridan olinadi, ularni ish beruvchi Mehnat vazirligining 767n-son buyrug‘i va kasbiy xavflarni baholash asosida tasdiqlaydi. Muddat berilgan sanadan boshlab hisoblanadi va jurnalda pozitsiya yonida yoziladi. Yirtilgan, kuygan yoki himoya xususiyatini yo‘qotgan vositalar muddatini kutmasdan oldinroq almashtiriladi va almashtirish sababi yoziladi.",
    },
    {
      q: "Xodim shaxsiy himoya vositalarini kiyishdan bosh tortsa, nima qilish kerak?",
      a: "Avval vositalar o‘lchamiga mosligini va ishga xalaqit bermasligini tekshirish kerak: bosh tortishning ko‘p uchraydigan sababi — noqulay qo‘lqop yoki poyabzal. Keyin yozuv bilan takroriy yo‘riqnoma o‘tkaziladi. Xodim berilgan vositalardan foydalanishi shart, ish beruvchi esa ular talab qilinadigan ishga uni himoyasiz qo‘ymasligi kerak. Bosh tortish yozma ravishda — tushuntirish xati yoki dalolatnoma bilan qayd etiladi.",
    },
  ],

  vitaminization: [
    {
      q: "S vitamini qaysi taomlarga qo‘shiladi?",
      a: "Odatda uchinchi taomlarga — kompot, kisel, ichimlikka — ular sovigandan keyin. Preparat taomning kichik hajmida eritiladi, qolgan qismi bilan aralashtiriladi va tarqatishdan biroz oldin qo‘shiladi. Issiq taomlarga vitamin qo‘shilmaydi va qo‘shilgandan keyin taom isitilmaydi: askorbin kislotasi qizdirilganda parchalanadi. Qo‘shish o‘rniga sanoatda ishlab chiqarilgan vitaminlashtirilgan ichimliklar berilishi mumkin — bu ham jurnalga yoziladi.",
    },
    {
      q: "Bir porsiyaga qancha askorbin kislotasi qo‘shiladi?",
      a: "Doza muassasa uchun yosh me’yori va preparat yo‘riqnomasi bo‘yicha aniqlanadi, so‘ngra joriy kundagi porsiyalar soniga ko‘paytiriladi. Turli yoshdagi bolalar uchun me’yor turlicha, shuning uchun aralash guruhlarda alohida hisoblanadi. «Bir qozonga» bir xil raqamni ishlatib bo‘lmaydi: porsiyalar kam bo‘lsa, me’yordan oshib ketadi, ko‘p bo‘lsa — yetishmaydi. Hisob-kitobni jurnal yonidagi jadvalda saqlash qulay.",
    },
    {
      q: "Taomlarni vitaminlashtirishni tabletkadagi polivitaminlar bilan almashtirish mumkinmi?",
      a: "Yo‘q. Tabletkadagi polivitaminlar vitaminlashtirish jurnalini almashtirmaydi: vitaminlashtirish — bu ruxsat etilgan preparatni taomga qo‘shish yoki ishlab chiqaruvchi yo‘riqnomasiga ko‘ra vitaminlashtirilgan ichimlik berish. Individual vitaminlarni shifokor tayinlaydi, oshxona ularni bermaydi. Taomlar uchun preparatning kelib chiqishi haqidagi hujjatlari bo‘lishi va yaroqlilik muddati o‘tmagan bo‘lishi kerak.",
    },
    {
      q: "Dam olish va bayram kunlari ham taomlarni vitaminlashtirish kerakmi?",
      a: "Agar bu kunlarda ovqatlanish tashkil etilgan bo‘lsa — ha. Lager, shifoxona, sanatoriy, qariyalar uyida vitaminlashtirish har kuni, jumladan dam olish va bayram kunlari ham o‘tkaziladi va yozuvlar har bir kun uchun bo‘lishi kerak. Maktab va bolalar bog‘chasida ovqatlanish bo‘lmagan kunlarda yozuvlar bo‘lmaydi. Tekshiruvchi jurnalni menyu va ovqatlanuvchilar soni bilan solishtiradi, shuning uchun oshxona ishlagan kunlardagi bo‘shliqlar darhol ko‘zga tashlanadi.",
    },
  ],

  ration_control: [
    {
      q: "Jamlanma qaydnoma nima va u menyudan nimasi bilan farq qiladi?",
      a: "Menyu — reja: qaysi taomlar va qanday chiqish bilan berilishi kerak. Jamlanma qaydnoma — fakt: davr mobaynida har bir guruhdagi mahsulotlardan qozonga haqiqatda qancha ketgani, bir kishiga bir kunga hisoblaganda. Aynan qaydnoma me’yorlar bajarilganini ko‘rsatadi, chunki menyu almashtirishlar bilan o‘zgaradi, ovqatlanuvchilar soni esa tebranib turadi.",
    },
    {
      q: "Mahsulotlarni almashtirishni me’yor bajarilishiga hisoblash mumkinmi?",
      a: "Ha, agar almashtirish oqsil va uglevodlar bo‘yicha qayta hisoblangan teng qiymatli almashtirishlar jadvali asosida qilingan bo‘lsa: masalan, go‘shtni belgilangan miqdorda baliq yoki tvorogga. Qaydnomada almashtirish aniq ko‘rsatiladi — bir guruh bo‘yicha kamomad va boshqasi bo‘yicha ortiqcha, izohda bir xil belgi bilan. «Taxminan» qilingan yoki boshqa guruh mahsulotiga, aytaylik go‘shtni makaronga almashtirish me’yorni yopmaydi.",
    },
    {
      q: "Davr mobaynida ovqatlanish me’yorlaridan qanday og‘ishga yo‘l qo‘yiladi?",
      a: "Me’yorlar o‘rtacha sutkalik, shuning uchun bajarilish alohida kun bo‘yicha emas, 10 kun yoki bir oy bo‘yicha baholanadi: bir kuni go‘sht ko‘proq, boshqa kuni kamroq bo‘lishi mumkin. Og‘ishning joiz foizi va menyuni qachon o‘zgartirish qoidasi ishlab chiqarish nazorati dasturida mustahkamlanadi. Har qanday sezilarli og‘ish izohda tushuntiriladi va keyingi davrda tenglashtiriladi.",
    },
    {
      q: "Ovqatni shartnoma bo‘yicha kombinat tayyorlasa, ratsion nazorati qaydnomasini kim yuritadi?",
      a: "Qaydnomani menyu bo‘yicha ovqat tayyorlaydigan va beradigan tomon hisoblaydi — odatda ovqatlanish operatori yoki kombinat. Maktab yoki bolalar bog‘chasi buyurtmachi sifatida uni so‘rab, menyu va haqiqatda berilgan ovqat bilan solishtirishga, ota-onalar nazorati esa u bilan tanishishga haqli. Qaydnomani kim hisoblashi va saqlashini shartnomada va ishlab chiqarish nazorati dasturida yozib qo‘yish qulay.",
    },
  ],

  daily_samples: [
    {
      q: "Sutkalik namunalar jurnali blankasini qayerdan bepul yuklab olish mumkin?",
      a: "Shu sahifada — «PDF formatida yuklab olish» tugmasi: sana va ovqatlanish mahali, taom, namuna massasi, olingan vaqt, saqlash harorati va utilizatsiya uchun ustunlari bo‘lgan bo‘sh blanka. Yuklab olishda tashkilot nomi sarlavhaga qo‘yiladi. Qog‘oz noqulay bo‘lsa, jurnalni elektron yuritish mumkin — 14 kun bepul: taomlar ro‘yxati menyudan olinadi, 48 soatdan keyin esa utilizatsiya haqida eslatma keladi.",
    },
    {
      q: "Oldinda dam olish kunlari bo‘lsa, sutkalik namuna qancha saqlanadi?",
      a: "Kamida 48 soat alohida sovutkichda yoki ajratilgan tokchada +2…+6 °C da. Dam olish va bayram kunlari bu muddatga kiritilmaydi: juma kuni olingan namunani yakshanba kuni tashlab yuborib bo‘lmaydi — uni muddat tugaganda ish kunidagi smena utilizatsiya qiladi. Agar shu vaqt ichida ovqatlanganlardan kimdir kasal bo‘lib qolsa, namunalar Rospotrebnadzor mutaxassislari qaror qabul qilgunga qadar saqlanadi.",
    },
    {
      q: "Oddiy kafe yoki restoran sutkalik namunalarni qoldirishi kerakmi?",
      a: "Mehmonlarni menyu bo‘yicha ovqatlantiradigan kafe uchun namuna olish majburiy emas. Talab tashkiliy ovqatlanishga — bolalar, bemorlar, ijtimoiy xizmat oluvchilarga — hamda jamoalarni shartnoma bo‘yicha, shu jumladan sayyor xizmat orqali ovqatlantiradiganlarga taalluqli. Muntazam banketlar o‘tkazadigan restoranga bunday tadbirlarda namuna olishni ishlab chiqarish nazorati dasturida mustahkamlash maqsadga muvofiq: namuna muassasaning o‘zini ham himoya qiladi.",
    },
    {
      q: "Sutkalik namuna brakerajdan oldin olinadimi yoki keyinmi?",
      a: "Brakerajdan keyin va tarqatish boshlanishidan oldin: komissiya avval taomni berishga ruxsat beradi, so‘ngra namuna tarqatishga olib boriladigan o‘sha partiyadan olinadi. Oldindan «birinchi qozondan» yoki tarqatishdan keyin olingan namuna haqiqatda nima yeyilganini ko‘rsatmaydi. Olingan vaqt jurnalga yoziladi — tekshiruvchi u orqali jurnalni brakeraj jurnali bilan solishtiradi.",
    },
  ],

  complaint_register: [
    {
      q: "Mehmon da’vosiga qancha muddatda javob berish kerak?",
      a: "Sifatsiz ko‘rsatilgan xizmat uchun narxni kamaytirish yoki pulni qaytarish talablarini RF «Iste’molchilar huquqlarini himoya qilish to‘g‘risida»gi Qonuni taqdim etilgan kundan boshlab 10 kun ichida qondirishni belgilaydi. Zaldagi og‘zaki da’vo odatda darhol — taomni almashtirish yoki chegirma bilan hal qilinadi. Jurnalda murojaat sanasi va javob sanasi qayd etiladi: ular orqali muddatga rioya qilingani ko‘rinadi.",
    },
    {
      q: "Shikoyatlar jurnali fikr va takliflar kitobidan nimasi bilan farq qiladi?",
      a: "Fikrlar kitobini, agar u zalda bo‘lsa, mehmonning o‘zi to‘ldiradi. Shikoyatlar jurnali — korxonaning ichki hujjati: unga barcha da’volar — kitobdan, telefon orqali, saytlardan, ijtimoiy tarmoqlardan — ko‘chiriladi hamda tekshiruv, sabab va ko‘rilgan choralar yoziladi. Fikrlar kitobidagi yozuvni ham tahlil qilib, jurnalga kiritish kerak, aks holda u javobsiz va xulosasiz qoladi.",
    },
    {
      q: "Mehmon aloqa ma’lumotlarini qoldirmagan bo‘lsa, shikoyatni yozish kerakmi?",
      a: "Ha. Aloqa ma’lumotlari javob berish uchun kerak, ammo tahlil uchun sana, vaqt, taom va da’voning mohiyati muhim. Anonim yoki og‘zaki shikoyat ham xuddi shunday yoziladi, kanal ustunida esa, masalan, «og‘zaki, aloqa ma’lumotlarisiz» deb ko‘rsatiladi. Agar shikoyat asosli bo‘lsa, chora baribir ko‘riladi: mehmon ketdi, sabab esa oshxonada qoldi.",
    },
    {
      q: "Iste’molchilar shikoyatlari jurnali qanday tahlil qilinadi?",
      a: "Har bir shikoyat darhol ko‘rib chiqiladi, umumlashgan tahlil esa oyda yoki chorakda bir marta qilinadi: shikoyatlar taomlar, smenalar va sabablar bo‘yicha guruhlanadi. Bir oy ichidagi bir nechta o‘xshash shikoyat — alohida-alohida uzr so‘rash emas, jarayonni o‘zgartirish uchun signal: texnologik kartani, tarqatishdagi harorat nazoratini yoki yetkazib beruvchini qayta ko‘rib chiqish kerak. Tahlil natijalaridan HACCP rejasini qayta ko‘rib chiqishda foydalaniladi.",
    },
  ],

  finished_product: [
    {
      q: "Brakeraj jurnali blankasini qayerdan bepul yuklab olish mumkin?",
      a: "Shu sahifada: «PDF formatida yuklab olish» tugmasi tayyor mahsulot brakeraji uchun bo‘sh blankani beradi, Word (DOCX) varianti ham bor. Yuklab olishda ko‘rsatilgan tashkilot nomi sarlavhaga qo‘yiladi. Qog‘oz yuritishni istamasangiz, brakerajni tarqatish liniyasi yonida telefondan yozish mumkin — dastlabki 14 kun bepul, xuddi shu shakldagi PDF eksport bilan.",
    },
    {
      q: "Brakeraj jurnalida kim imzo chekadi?",
      a: "Taomni baholagan brakeraj komissiyasining barcha a’zolari — kamida ikki kishi, tarkibi rahbar buyrug‘i bilan tasdiqlanadi. Taomni tayyorlagan oshpaz o‘zini o‘zi baholamaydi va qaror uchun imzo chekmaydi. Agar komissiya a’zolaridan biri smenada bo‘lmasa, buyruqda ko‘rsatilgan o‘rinbosari imzo chekadi; yo‘q odam o‘rniga orqa sana bilan imzo qo‘yish — qoidabuzarlik.",
    },
    {
      q: "Buyurtma bo‘yicha tayyorlangan har bir taomni brakeraj jurnaliga yozish kerakmi?",
      a: "Zagotovkalar, sho‘rvalar, souslar, garnirlar va pishiriqlar berish boshlanishidan oldin har bir partiya bo‘yicha baholanadi. Buyurtma bo‘yicha tayyorlanadigan porsiyali taomlar uchun tartib texnologik kartalar asosida ishlab chiqarish nazorati dasturida mustahkamlanadi: masalan, smenadagi birinchi porsiya va taom yig‘iladigan yarim tayyor mahsulotlar bo‘yicha brakeraj. Asosiysi — qoida yozib qo‘yilgan va har kuni bajarilishi kerak.",
    },
    {
      q: "Tayyor mahsulot brakeraji tez buziladigan mahsulot brakerajidan nimasi bilan farq qiladi?",
      a: "Tayyor mahsulot brakeraji — o‘zi ishlab chiqargan taomlarni berishdan oldin baholash: ta’m, hid, tashqi ko‘rinish, konsistensiya, harorat va komissiya qarori. Tez buziladigan mahsulot brakeraji — kelayotgan xomashyo va yarim tayyor mahsulotlarning kirish nazorati: hujjatlar, qabul qilishdagi organoleptika, saqlash sharoitlari va sotish muddati. Bular ikki xil jurnal va biri ikkinchisini almashtirmaydi.",
    },
  ],

  cleaning: [
    {
      q: "Tozalash jurnali blankasini qayerdan bepul yuklab olish mumkin?",
      a: "Shu sahifada: «PDF formatida yuklab olish» tugmasi xonalarni tozalash jurnalining bo‘sh blankasini beradi, Word (DOCX) varianti ham bor. Yuklab olishda ko‘rsatilgan tashkilot nomi sarlavhaga qo‘yiladi, jadval ostida esa joriy va umumiy tozalash reglamenti chop etiladi. Qog‘ozsiz qulayroq bo‘lsa, tozalashni telefondan QR-kod orqali belgilash mumkin — dastlabki 14 kun bepul.",
    },
    {
      q: "Umumiy tozalash uchun alohida jurnal kerakmi?",
      a: "Shart emas. Bizning shaklimizda joriy va umumiy tozalash bitta jurnalda «T» va «G» harflari bilan belgilanadi. Umumiy tozalashlarning alohida jadvali ular bir oy oldinga uchastkalar bo‘yicha rejalashtirilganda va ularni alohida mas’ul shaxs qabul qilganda qulay: u yerda rejadagi sana yonida haqiqiy sana qo‘yiladi. Muhimi, har bir umumiy tozalash bir joyda yozilgan bo‘lishi va takrorlanmasligi kerak.",
    },
    {
      q: "Barcha xonalar uchun bitta tozalash jurnalini yuritish mumkinmi?",
      a: "Ha. Bitta jurnalda har bir xona yoki hudud — issiq va sovuq sex, yuvish xonasi, ombor, zal, xodimlar sanuzeli — uchun qator ochiladi va tozalash kunlar bo‘yicha belgilanadi. Sexlar bo‘yicha alohida jurnallar hududlar uchun turli odamlar javob beradigan yirik ishlab chiqarishda ma’noga ega. Asosiysi, jurnalda ishlab chiqarish nazorati dasturidagi barcha xonalar bo‘lishi kerak.",
    },
    {
      q: "Oshxonani tozalash uchun maishiy kimyodan foydalanish mumkinmi?",
      a: "Dezinfeksiya uchun — yo‘q: ovqatlanish korxonalari uchun ruxsat etilgan, qo‘llash yo‘riqnomasi va davlat ro‘yxatidan o‘tganlik hujjatlari bor vositalar kerak, ishchi eritma esa qat’iy yo‘riqnoma bo‘yicha tayyorlanadi. Vosita nomi va konsentratsiyasi jurnalga yoziladi va ular yo‘riqnoma hamda dezinfeksiya vositalari hisobiga mos kelishi kerak. Konsentratsiyasi ko‘rsatilmagan maishiy vosita — tekshiruvda ko‘p uchraydigan e’tiroz.",
    },
  ],

  climate_control: [
    {
      q: "Harorat va namlik jurnali blankasini qayerdan bepul yuklab olish mumkin?",
      a: "Shu sahifadagi «PDF formatida yuklab olish» tugmasi xona, harorat va namlikning ertalabki va kechki o‘lchovi hamda og‘ishdagi choralar uchun ustunlari bo‘lgan bo‘sh blankani beradi. Yuklab olishda tashkilot nomi sarlavhaga qo‘yiladi. Agar xonada datchik o‘rnatilgan bo‘lsa, jurnalni elektron yuritish mumkin — 14 kun bepul, ko‘rsatkichlar o‘zi yozilib boradi.",
    },
    {
      q: "Quruq mahsulotlar omborida harorat va namlik me’yori qanday?",
      a: "Yagona raqam yo‘q: saqlash sharoitlarini ishlab chiqaruvchi markirovkada belgilaydi, xona me’yori esa eng talabchan mahsulot bo‘yicha olinadi. Ko‘pchilik yorma, un, shakar va bakaleya mahsulotlari uchun bu +18…+20 °C dan yuqori bo‘lmagan harorat va 70–75 % dan oshmaydigan nisbiy namlik. Sabzavot omborining me’yorlari boshqacha — salqinroq va namlik yuqoriroq, shuning uchun u alohida qatorda yuritiladi.",
    },
    {
      q: "Harorat va namlik jurnali sovutkichlar jurnalidan nimasi bilan farq qiladi?",
      a: "Sovutish uskunalari jurnalida faqat sovutkich va muzlatkichlar ichidagi harorat nazorat qilinadi. Harorat va namlik jurnali mahsulotlar sovutishsiz saqlanadigan xonalar — quruq mahsulotlar, sabzavotlar, ichimliklar omborxonalari, shuningdek sexlar uchun yuritiladi va unda ikkala ko‘rsatkich majburiy: °C dagi harorat va foizdagi nisbiy namlik.",
    },
    {
      q: "Alohida ombori yo‘q kafega harorat va namlik jurnali kerakmi?",
      a: "Ha, agar mahsulotlar sovutkichlardan tashqarida — omborxonada, shkafda yoki sexdagi stellajda saqlansa. Nazorat nuqtasi yorma, un, konservalar, sabzavotlar va ichimliklar turgan joy bo‘ladi: u yerga gigrometrli termometr osiladi va ko‘rsatkichlar yoziladi. Agar sovutishsiz hech narsa saqlanmasa, buni ishlab chiqarish nazorati dasturida to‘g‘ridan-to‘g‘ri ko‘rsatib qo‘yish kerak.",
    },
  ],

  cold_equipment_control: [
    {
      q: "Sovutkich harorati jurnali blankasini qayerdan bepul yuklab olish mumkin?",
      a: "Shu sahifada: «PDF formatida yuklab olish» tugmasi SanPiN 2.3/2.4.4282-26 ga 2-sonli ilova shaklidagi bo‘sh blankani beradi, Word (DOCX) varianti ham bor. Yuklab olishda ko‘rsatilgan tashkilot nomi sarlavhaga qo‘yiladi. Raqamlarni qayta ko‘chirishni istamasangiz, jurnalni elektron yuritish mumkin — 14 kun bepul, simsiz termometr bilan esa ko‘rsatkichlar o‘zi tushadi.",
    },
    {
      q: "SanPiN bo‘yicha sovutkichda harorat qanday bo‘lishi kerak?",
      a: "Me’yor sovutkichga emas, mahsulotga bog‘liq: saqlash sharoitlarini ishlab chiqaruvchi markirovkada belgilaydi. Umumiy ovqatlanish uchun mo‘ljallar: sut mahsulotlari, salatlar, kulinariya — +2…+6 °C, sovutilgan go‘sht va parranda — 0…+4 °C, muzlatilgan mahsulotlar — −18 °C dan yuqori bo‘lmagan. Agar bitta kamerada turli mahsulotlar saqlansa, me’yor ularning eng talabchani bo‘yicha belgilanadi va jurnalga yoziladi.",
    },
    {
      q: "Bir nechta sovutkich uchun bitta jurnal yuritish mumkinmi?",
      a: "Ha, shakl aynan shunday tuzilgan: bitta jurnalda har bir sovutish va muzlatish uskunasi uchun qator, o‘lchovlar oy kunlari bo‘yicha boradi. Har bir sovutkichga korpusdagi yorliq bilan mos keladigan raqam beriladi va uning me’yori ko‘rsatiladi. Har bir shkaf uchun alohida jurnal ochish shart emas, lekin ikkita sovutkichni bitta qatorga birlashtirib ham bo‘lmaydi.",
    },
    {
      q: "Termometr o‘rniga o‘rnatilgan datchikdan foydalanish mumkinmi?",
      a: "Sovutkich tablosi bug‘latgich yonidagi havo haroratini ko‘rsatadi, shuning uchun u kamera ichidagi alohida termometr bilan solishtiriladi. Oshxonada simobli termometrlar ishlatilmaydi: kolba sinsa, simob mahsulotlarga tushadi. Spirtli va elektron termometrlar hamda avtomatik datchik-registratorlar mos keladi — amaldagi qiyoslash yoki kalibrlash bilan.",
    },
  ],

  cleaning_ventilation_checklist: [
    {
      q: "Kiritish-chiqarish ventilyatsiyasi bo‘lsa, shamollatish nazorat ro‘yxati kerakmi?",
      a: "Agar xonaga doimiy ishlaydigan kiritish-chiqarish ventilyatsiyasi xizmat qilsa, u yerda derazalar orqali shamollatish ko‘pincha talab qilinmaydi, ammo nazorat ro‘yxatida ventilyatsiya yoqilgani va ishlayotgani belgilanadi. Derazali va mexanik ventilyatsiyasiz xonalar — kiyinish xonalari, maishiy xonalar, kichik zallar uchun shamollatish alohida protsedura bo‘lib qoladi. Har bir xona bo‘yicha qaror ishlab chiqarish nazorati dasturida qayd etiladi.",
    },
    {
      q: "Shamollatish nazorat ro‘yxatini tozalash jurnali bilan birlashtirish mumkinmi?",
      a: "Mumkin, agar tozalash jurnalida vaqt va nazoratchi imzosi bilan shamollatish belgisi bo‘lsa. Odatda ular ajratiladi: tozalash jurnali vositalar va konsentratsiyalar bilan tozalashni qayd etadi, nazorat ro‘yxati esa kun davomida takrorlanadigan qisqa protseduralarni. Asosiysi — bir narsani ikki joyda yuritmaslik: har bir protsedura ishlab chiqarish nazorati dasturida ko‘rsatilgan bitta hujjatda yoziladi.",
    },
    {
      q: "Kafe ishlayotgan paytda zalni shamollatish mumkinmi?",
      a: "Mumkin, agar havo oqimi tayyorlash va tarqatish hududi orqali o‘tmasa, issiq mavsumda ochiladigan derazalarda esa hasharotlarga qarshi to‘rlar bo‘lsa. Odatda zal ochilishdan oldin va mehmonlar kamaygan paytda, tig‘iz soatlardan keyin shamollatiladi. Bolalar muassasalarida ovqatlanish zalida bolalar bor paytda shamollatilmaydi — u guruhlar kelishidan oldinga va ketganidan keyinga qo‘yiladi.",
    },
    {
      q: "Nazorat ro‘yxatida xodimlar sanuzelini tozalashni belgilash kerakmi?",
      a: "Ha, agar sanuzel xonalar ro‘yxatiga kirsa. U boshqa xonalarga qaraganda tez-tez, sexlarda ishlatilmaydigan alohida markirovkalangan anjomlar bilan va alohida kiyimda tozalanadi va dezinfeksiya qilinadi. Nazorat ro‘yxatida har bir tozalash vaqti, ijrochi va tekshirgan shaxs ko‘rsatiladi — bu qatorlar orqali tozalash kechqurun bir marta emas, butun kun davomida o‘tkazilgani ko‘rinadi.",
    },
  ],

  general_cleaning: [
    {
      q: "Umumiy tozalashlar jadvali blankasini qayerdan bepul yuklab olish mumkin?",
      a: "Shu sahifadagi «PDF formatida yuklab olish» tugmasi rejadagi va haqiqiy sana, uchastka, ijrochi va qabul qilish belgisi uchun ustunlari bo‘lgan bo‘sh blankani beradi. Yuklab olishda tashkilot nomi sarlavhaga qo‘yiladi. Qog‘ozsiz qulayroq bo‘lsa, jadvalni elektron yuritish mumkin — 14 kun bepul: sanadan bir kun oldin ijrochi eslatma oladi, reja va fakt esa bitta jadval bo‘lib yuklanadi.",
    },
    {
      q: "Kafeda oyiga necha marta umumiy tozalash o‘tkazish kerak?",
      a: "Davriylikni korxonaning o‘zi ishlab chiqarish nazorati dasturida belgilaydi. Sexlar, omborlar va yuvish xonalari uchun bu odatda oyiga kamida bir marta, yuqori xavfli hududlar — masalan, sovuq sex yoki xom go‘sht bilan ishlanadigan uchastkalar uchun esa tez-tez, haftalik tozalashgacha. Bolalar va tibbiyot muassasalarining oshxonalarida umumiy tozalashlar oddiy kafega qaraganda tez-tez o‘tkaziladi.",
    },
    {
      q: "Tekshiruvchilar umumiy tozalashlar jurnalida qanday xatolarni topadi?",
      a: "Ko‘pincha — rejadagi sanalar yo‘q yoki jadval orqa sana bilan tuzilgan; ro‘yxatdan o‘tgan dezinfeksiya vositasi o‘rniga maishiy vosita ko‘rsatilgan yoki ishchi konsentratsiya yozilmagan; qabul qilish ustuni ishlab chiqarish mudirining imzosisiz bo‘sh; tozalash belgilangan, lekin uskuna ortida, so‘rg‘ich ustida va stellajlar ostida kir. Bularning barchasi tekshiruvchiga tozalash faqat qog‘ozda o‘tganini ko‘rsatadi.",
    },
    {
      q: "Kafeni yopmasdan umumiy tozalash o‘tkazish mumkinmi?",
      a: "Ha, agar shu vaqtga ishdan chiqarilgan uchastkalar bo‘yicha tozalansa. Tozalash hududidagi mahsulotlar va toza idishlar olib qo‘yiladi yoki zich yopiladi, bu uchastkada esa sirtlarni dezinfeksiya qilish va chayish tugamaguncha ovqat tayyorlash boshlanmaydi. Shuning uchun jadvaldagi sanalar taqsimlanadi: bir kuni — issiq sex, bir haftadan keyin — sovuq sex, butun ishlab chiqarishni birdaniga to‘xtatmaslik uchun.",
    },
  ],

  uv_lamp_runtime: [
    {
      q: "Bakteritsid lampa almashtirilgunga qadar necha soat ishlaydi?",
      a: "Resurs lampa pasportida ko‘rsatilgan: ko‘p tarqalgan modellarning aksariyatida taxminan 8000 soat, lekin kamroq ham bo‘ladi. Ko‘rinadigan nurga emas, aynan pasportga qaraladi: resurs oxiriga kelib ultrabinafsha nurlanish kamayadi, holbuki lampa hali yonib turadi. Shuning uchun jurnalda soatlarning o‘sib boruvchi jami yuritiladi va u pasportdagi qiymatga yetganda lampa almashtiriladi.",
    },
    {
      q: "Retsirkulyator ishlayotganda xonada bo‘lish mumkinmi?",
      a: "Ha, yopiq turdagi retsirkulyator odamlar bor paytda ishlash uchun mo‘ljallangan: lampalar korpus ichiga yashirilgan, havo esa nurlantirish kamerasi orqali o‘tkaziladi. Ochiq turdagi nurlantirgichlar faqat odamlar yo‘qligida yoqiladi. Rejim — kuniga nechta seans va qancha davomiylikda — xonangiz hajmi uchun ishlab chiqaruvchi yo‘riqnomasidan olinadi va jurnal sarlavhasiga yoziladi.",
    },
    {
      q: "Nurlantirgich kuniga bir necha marta yoqilsa, ishlash vaqti qanday hisoblanadi?",
      a: "Har bir yoqish boshlanish va tugash vaqti bilan yoziladi, davomiyligi joriy lampa o‘rnatilgan sanadan boshlab o‘sib boruvchi jamiga qo‘shiladi. Agar nurlantirgich taymer bo‘yicha ishlasa, davomiylik sozlamadan olinadi, ammo yoqilgani baribir belgilanadi. Agar asbobda o‘rnatilgan soat hisoblagichi bo‘lsa, uning ko‘rsatkichi jurnalga ko‘chiriladi — bu eng ishonchli jami.",
    },
    {
      q: "Bakteritsid lampa sinib qolsa, nima qilish kerak?",
      a: "Lampada simob bor, shuning uchun odamlar xonadan chiqariladi va derazalar ochiladi. Siniqlar changyutgich yoki supurgi bilan emas, germetik idishga yig‘iladi, joyga demerkurizatsiya yo‘riqnomasi bo‘yicha ishlov beriladi yoki ixtisoslashgan xizmat chaqiriladi. Xonadagi ochiq mahsulotlar hisobdan chiqariladi. Hodisa va lampaning almashtirilishi jurnalga yoziladi, siniqlar esa ishlatilgan lampalar bilan birga topshiriladi.",
    },
  ],

  disinfectant_usage: [
    {
      q: "Dezinfeksiya vositasining ishchi eritmasi qancha saqlanadi?",
      a: "Ishchi eritmaning yaroqlilik muddati aniq vosita yo‘riqnomasida ko‘rsatilgan: ba’zi eritmalarda — bir sutka, boshqalarida — bir necha kun. Xlorli tabletkalardan tayyorlangan eritmalar ko‘pincha bir smenaga tayyorlanadi. Idishga yozib qo‘yiladi: nomi, konsentratsiyasi, tayyorlangan sanasi va yaroqlilik muddati. Muddati o‘tgan eritma to‘kib tashlanadi va yangisi tayyorlanadi, tayyorlash esa jurnalga yoziladi.",
    },
    {
      q: "Dezinfeksiya vositasining oylik sarfini qanday hisoblash mumkin?",
      a: "Tozalash jurnali va umumiy tozalashlar jadvalidan har bir hududga ishlov berishlar sonini oling, uni bitta ishlov berishga ketadigan ishchi eritma hajmiga ko‘paytiring va yo‘riqnomadagi suyultirish jadvali bo‘yicha konsentratga qayta hisoblang. Rejadan tashqari ishlov berishlar uchun zaxira qo‘shing. Agar jurnaldagi haqiqiy sarf hisoblanganidan sezilarli kam bo‘lsa, ehtimol eritma me’yordan kuchsizroq tayyorlanmoqda yoki tozalashlarning bir qismi o‘tkazilmayapti.",
    },
    {
      q: "Jurnalda qo‘l uchun antiseptikni hisobga olish kerakmi?",
      a: "Ha, agar u korxona vositalari ro‘yxatiga kirsa: teri antiseptigi ham xuddi shunday hisobga olinadi — partiya kirimi, uchastkalarga berish, qoldiq. U tayyor holda ishlatiladi, shuning uchun eritma tayyorlanmaydi, lekin yaroqlilik muddati, jumladan, yo‘riqnomada ko‘rsatilgan bo‘lsa, flakon ochilgandan keyingi muddat ham kuzatiladi. Sexga kirishdagi dozatorlar markirovkasiz shishalardan emas, hisobga olingan partiyadan to‘ldiriladi.",
    },
    {
      q: "Dezinfeksiya vositalarini almashlab turish kerakmi?",
      a: "Mikroorganizmlarda bitta ta’sir etuvchi moddaga chidamlilik paydo bo‘lmasligi uchun almashlab turish ko‘pincha tavsiya etiladi: masalan, xlorli vosita vaqti-vaqti bilan boshqa guruhdagi vositaga almashtiriladi. Almashtirish tartibi va davriyligi ishlab chiqarish nazorati dasturida mustahkamlanadi. Yangi vositaga o‘tishda uning konsentratsiyalari va ekspozitsiyasi bo‘yicha yo‘riqnoma o‘tkaziladi va u jurnalga yangi pozitsiya sifatida kiritiladi.",
    },
  ],

  sanitary_day_control: [
    {
      q: "Kafeda sanitariya kuni qanchalik tez-tez o‘tkaziladi?",
      a: "Odatda oyiga bir marta, lekin aniq davriylikni korxonaning o‘zi tanlaydi va ishlab chiqarish nazorati dasturida mustahkamlaydi. Xavfi yuqori oshxonalarga — bolalar, shifoxona oshxonalari, tayyor ovqat ishlab chiqarishlariga — sanitariya kuni bundan siyrak emas, ba’zan esa tez-tez kerak. Pudratchilar bilan oldindan kelishib olish va mehmonlarni ogohlantirish uchun sanalarni bir yil oldinga tasdiqlab qo‘yish qulay.",
    },
    {
      q: "Sanitariya kuni uchun kafeni yopish kerakmi?",
      a: "To‘liq sanitariya kuni uchun — ha, hech bo‘lmaganda kunning bir qismiga: mahsulotlar va idishlar olib qo‘yiladi, ishlar barcha hududlarda bir vaqtda olib boriladi, hasharotlarga qarshi ishlov berilgandan keyin esa kutish muddati amal qiladi. Agar yopib bo‘lmasa, sanitariya kuni hududlar bo‘yicha bir necha kecha yoki erta tongga bo‘linadi, ammo har bir hudud tozalash vaqtida ishdan chiqariladi. Mehmonlar oldindan e’lon orqali ogohlantiriladi.",
    },
    {
      q: "Sanitariya kunini Rospotrebnadzor bilan kelishish kerakmi?",
      a: "Yo‘q, sanitariya kuni — korxonaning ichki tadbiri, u haqda xabar berish yoki uni kelishish shart emas. Sana ko‘rsatilgan buyruq yoki tasdiqlangan jadval, ijrochilar va tekshiruvchining belgilari bo‘lgan nazorat ro‘yxati hamda, agar ishtirok etgan bo‘lsa, pudratchilarning dalolatnomalari yetarli. Tekshiruvda aynan shu hujjatlar ko‘rsatiladi.",
    },
    {
      q: "Sanitariya kunini klining kompaniyasi kuchi bilan o‘tkazish mumkinmi?",
      a: "Mumkin, lekin natija uchun javobgarlik korxonada qoladi. Nazorat ro‘yxatida pudratchi ijrochi sifatida ko‘rsatiladi, qabul qilishni esa o‘z xodimi — ishlab chiqarish mudiri yoki administrator amalga oshiradi. Kliningda oziq-ovqat korxonalari uchun ruxsat etilgan, yo‘riqnomalari bor vositalar bo‘lishi kerak; ularning nomi va konsentratsiyasi o‘z kuchi bilan tozalashdagidek yoziladi, pudratchi dalolatnomasi esa nazorat ro‘yxatiga ilova qilinadi.",
    },
  ],

  equipment_cleaning: [
    {
      q: "Go‘sht maydalagich va slayserni har yuvishda qismlarga ajratish kerakmi?",
      a: "Smena oxiridagi yuvishda va xom go‘sht, baliq yoki tuxum bilan ishlagandan keyin — ha: mahsulot qoldiqlari tashqaridan ko‘rinmaydigan qismlarda to‘planib qoladi. Smena davomida bir xil mahsulot partiyalari orasida, agar ishlab chiqaruvchi yo‘riqnomasi ruxsat bersa, to‘liq qismlarga ajratmasdan tozalash yetarli bo‘ladi. Har bir uskuna turi uchun tartib yuvish yo‘riqnomasida mustahkamlanadi.",
    },
    {
      q: "Uskuna detallarini idish yuvish mashinasida yuvish mumkinmi?",
      a: "Faqat uskuna ishlab chiqaruvchisining yo‘riqnomasi bunga to‘g‘ridan-to‘g‘ri ruxsat bersa: alyuminiy detallarning bir qismi ishqoriy vositalardan qorayadi va korroziyaga uchraydi, kesuvchi qirralar esa o‘tmaslashadi. Agar ruxsat berilgan bo‘lsa, jurnalda «idish yuvish mashinasi» va dastur ko‘rsatiladi. Olinmaydigan qismlar har qanday holatda joyida qo‘lda yuviladi va dezinfeksiya qilinadi, vosita va konsentratsiya yoziladi.",
    },
    {
      q: "Xom va tayyor mahsulotlar uchun bitta uskunadan foydalanish mumkinmi?",
      a: "Yo‘q: xom va tayyor mahsulot uchun uskuna va anjomlar ajratiladi va markirovkalanadi — alohida go‘sht maydalagichlar, taxtalar, pichoqlar. Agar bitta apparatda turli tayyor mahsulotlarga ishlov berilsa, masalan, pishloq va kolbasa uchun slayser, ular orasida yuvish o‘tkaziladi va yozuv qilinadi. Bunday uskuna uchun kuniga bitta yozuv tekshiruvchida savol tug‘diradi.",
    },
    {
      q: "Bug‘-konvektomatning avtomatik yuvilishini jurnalga yozish kerakmi?",
      a: "Ha, bu ham uskunani yuvishning o‘zi. Avtomatik yuvish dasturi, vosita — ishlab chiqaruvchi yo‘riqnomasiga ko‘ra tabletkalar yoki suyuqlik — va uni kim ishga tushirgani ko‘rsatiladi. Agar protseduraga kirsa, eshik zichlagichi, panjaralar va yo‘naltiruvchilarni qo‘lda tozalash alohida belgilanadi: avtomatik yuvish dasturi ularni har doim ham yuvib bermaydi.",
    },
  ],

  intensive_cooling: [
    {
      q: "Issiq taomni qancha vaqtda sovutish kerak?",
      a: "HACCP tizimlarining umumiy mo‘ljali — +60 °C dan +10 °C gacha bo‘lgan diapazonni 2 soatdan tezroq o‘tish, so‘ngra mahsulotni saqlash haroratigacha yetkazish. Har bir taom uchun aniq muddat va haroratlar texnologik hujjatlarda va HACCP rejasida belgilanadi — jurnal yozuvlari aynan ular bilan solishtiriladi. Hajm qancha katta va idish qancha chuqur bo‘lsa, muddatga sig‘ish shuncha qiyin.",
    },
    {
      q: "Issiq ovqatni oddiy sovutkichda sovutish mumkinmi?",
      a: "Issiq qozonni oddiy sovutkichga qo‘yib bo‘lmaydi: u issiqlikni chiqarish uchun emas, saqlash uchun mo‘ljallangan, shuning uchun taom soatlab soviydi, yonidagi mahsulotlar esa isiydi. Shok sovutish shkafi bo‘lmasa, muzli suv vannasi, sayoz gastroyomkostlarga taqsimlash va aralashtirishdan foydalaniladi, mahsulot esa issiqlikning asosiy qismi chiqarilgandan keyin sovutkichga qo‘yiladi va vaqt o‘lchovlar bo‘yicha qayd etiladi.",
    },
    {
      q: "Restoranda shok shkafi bo‘lmasa, sovutish jurnali kerakmi?",
      a: "Ha, agar siz issiq taomlarni saqlash uchun sovutsangiz: sho‘rvalar, souslar, garnirlar, ertangi kun uchun zagotovkalar. Jurnal uskunani emas, faktni qayd etadi — mahsulot xavfli diapazonni qancha vaqtda o‘tgani. Agar taomlar sovutilmasa, balki tayyorlanib darhol mehmonlarga berilsa, jurnal kerak emas; buni HACCP rejasida aks ettirish kerak.",
    },
    {
      q: "Sovutishni qanday termometr bilan nazorat qilish kerak?",
      a: "Mahsulot yuzasida emas, markazida haroratni o‘lchaydigan zondli elektron termometr bilan. Zond mahsulotlar orasida, ayniqsa xom mahsulotdan tayyoriga o‘tishda yuviladi va dezinfeksiya qilinadi. Termometr vaqti-vaqti bilan tekshiriladi: erib borayotgan muzda u taxminan 0 °C ni ko‘rsatishi kerak, tekshiruv natijasi esa kalibrlash jurnaliga yoziladi.",
    },
  ],

  transport_temperature: [
    {
      q: "Tez buziladigan mahsulotlarni yetkazib berish uchun refrijerator kerakmi?",
      a: "Tez buziladigan mahsulotlar ishlab chiqaruvchining saqlash sharoitlarini saqlaydigan transportda yoki idishda tashiladi: masofa va yo‘ldagi vaqtga qarab refrijerator, izotermik kuzov yoki sovuq akkumulyatorli termokonteynerlar. Qisqa marshrutda ko‘pincha termokonteynerlar yetarli, lekin bu yuklash va tushirishdagi o‘lchovlar bilan tasdiqlanadi. Agar o‘lchovlar me’yordan chiqsa, idish yoki marshrut o‘zgartiriladi.",
    },
    {
      q: "Xomashyo va tayyor mahsulotni bitta mashinada tashish mumkinmi?",
      a: "Faqat ular bir-biriga tegmaydigan va bir-birini ifloslantirmaydigan qilib: alohida yopiq idishlar, alohida bo‘linmalar yoki kuzov hududlari. Xom go‘sht, baliq va tuxum tayyor taomlar ustiga qo‘yilmaydi, xomashyo va tayyor mahsulot idishlari bir-birining o‘rniga ishlatilmaydi. Agar kuzovda mahsulotni ajratib bo‘lmasa, u turli reyslarda tashiladi.",
    },
    {
      q: "Issiq tushliklar qanday haroratda yetib kelishi kerak?",
      a: "Issiq taomlar tarqatilgunga qadar issiq qolishi kerak: tushirishdagi harorat texnologik karta yoki ovqatlanish shartnomasidagi me’yor bilan solishtiriladi. Muddatga sig‘ish uchun taomlar termokonteynerlarda tashiladi, manzilgacha ochilmaydi va yo‘ldagi vaqt qisqartiriladi. Agar qabul qiluvchida taom me’yordan sovuqroq bo‘lib chiqsa, bu yoziladi, berish haqidagi qarorni esa haydovchi emas, mas’ul shaxs qabul qiladi.",
    },
    {
      q: "Tashishdagi harorat jurnalini kim to‘ldiradi — haydovchimi yoki omborchimi?",
      a: "Yuklashdagi o‘lchovni mahsulotni jo‘natuvchi — omborchi yoki oshpaz, tushirishdagi o‘lchovni esa haydovchi yoki ekspeditor qabul qiluvchi bilan birga qiladi. Ikkala yozuvni ekspeditor kiritsa, qabul qiluvchi esa tushirishni imzo bilan tasdiqlasa, qulayroq. Asosiysi, har bir yozuvda vaqt va familiya bo‘lishi, termometr esa soz va tekshirilgan bo‘lishi kerak.",
    },
  ],

  pest_control: [
    {
      q: "Deratizatsiya va dezinseksiyani mustaqil o‘tkazish mumkinmi?",
      a: "Profilaktikani — tuzoqlarni kuzatish, tirqishlarni bekitish, derazalarda to‘r va chiqindilar uchun yopiq konteynerlarni saqlashni — korxonaning o‘zi bajaradi. Zahar va insektitsidlar bilan ishlov berish odatda shartnoma asosida ixtisoslashgan tashkilotga topshiriladi: o‘qitilgan mutaxassislar, bunday obyektlar uchun ruxsat etilgan vositalar va har bir ishlov berish uchun dalolatnoma kerak. Tekshiruvchi birinchi navbatda aynan shartnoma va dalolatnomalarni so‘raydi.",
    },
    {
      q: "Kafeda deratizatsiya qanchalik tez-tez o‘tkaziladi?",
      a: "Rejali ishlov berishlar davriyligi dezinfeksiya tashkiloti bilan shartnomada va ishlab chiqarish nazorati dasturida belgilanadi — ovqatlanish korxonalari uchun odatda oyiga bir marta. Pudratchi tashriflari oralig‘ida xodimlar tuzoqlar va jalb qiluvchi stansiyalarni ko‘zdan kechiradi, kemiruvchilar yoki hasharotlar izlari topilganda esa darhol rejadan tashqari ishlov berishga ariza beradi va buni jurnalga yozadi.",
    },
    {
      q: "Hasharotlar bo‘lmasa, dezinseksiya shartnomasi kerakmi?",
      a: "Ha. Profilaktik ishlov berish va ko‘riklar zararkunandalar ko‘rinadimi-yo‘qmi, qat’i nazar o‘tkaziladi: ularning yo‘qligi — muntazam ishning natijasi, uni to‘xtatish uchun sabab emas. Dalolatnomalar bilan shartnoma — tekshiruvchi bu mavzu bo‘yicha birinchi so‘raydigan narsa. Agar ko‘rikda izlar topilmasa, bu ham yoziladi: «ko‘rik, izlar yo‘q».",
    },
    {
      q: "Oshxonada suvarak yoki sichqon ko‘rilsa, nima qilish kerak?",
      a: "Hodisani jurnalga yozish — sana, joy, nima topilgani — va o‘sha kuniyoq pudratchiga rejadan tashqari ishlov berish uchun ariza berish. Shu hududdagi ochiq mahsulotlar va idishlarni tekshirish: kemiruvchilar yoki hasharotlar izlari bor mahsulotlar hisobdan chiqariladi, sirtlar yuviladi va dezinfeksiya qilinadi. So‘ngra kirib kelish yo‘lini — tirqishlar, ventilyatsiya, yetkazib beruvchi idishlari — topib, uni bekitish kerak.",
    },
  ],
};
