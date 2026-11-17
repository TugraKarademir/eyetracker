/* Kelime listesi: [kelime, emoji, kategori]. Kendi kelimelerinizi buraya ekleyebilir
   ya da oyunun "Ayarlar > Kendi kelimelerim" kutusunu kullanabilirsiniz. */
window.KELIMELER = [
  // Hayvanlar
  ['KEDİ', '🐱', 'hayvan'], ['KÖPEK', '🐶', 'hayvan'], ['BALIK', '🐟', 'hayvan'], ['KUŞ', '🐦', 'hayvan'],
  ['AT', '🐴', 'hayvan'], ['İNEK', '🐮', 'hayvan'], ['FİL', '🐘', 'hayvan'], ['ASLAN', '🦁', 'hayvan'],
  ['MAYMUN', '🐒', 'hayvan'], ['TAVŞAN', '🐰', 'hayvan'], ['KAPLUMBAĞA', '🐢', 'hayvan'], ['YILAN', '🐍', 'hayvan'],
  ['ARI', '🐝', 'hayvan'], ['KELEBEK', '🦋', 'hayvan'], ['PENGUEN', '🐧', 'hayvan'], ['BAYKUŞ', '🦉', 'hayvan'],
  ['AYI', '🐻', 'hayvan'], ['TİLKİ', '🦊', 'hayvan'], ['ZÜRAFA', '🦒', 'hayvan'], ['ÖRDEK', '🦆', 'hayvan'],
  ['TAVUK', '🐔', 'hayvan'], ['KURBAĞA', '🐸', 'hayvan'], ['FARE', '🐭', 'hayvan'], ['KOYUN', '🐑', 'hayvan'],
  ['KEÇİ', '🐐', 'hayvan'], ['DEVE', '🐫', 'hayvan'], ['ZEBRA', '🦓', 'hayvan'], ['KAPLAN', '🐯', 'hayvan'],
  ['KURT', '🐺', 'hayvan'], ['YUNUS', '🐬', 'hayvan'], ['BALİNA', '🐳', 'hayvan'], ['AHTAPOT', '🐙', 'hayvan'],
  ['SALYANGOZ', '🐌', 'hayvan'], ['KARINCA', '🐜', 'hayvan'], ['HOROZ', '🐓', 'hayvan'], ['CİVCİV', '🐤', 'hayvan'],
  ['PAPAĞAN', '🦜', 'hayvan'], ['TİMSAH', '🐊', 'hayvan'], ['KANGURU', '🦘', 'hayvan'], ['SİNCAP', '🐿️', 'hayvan'],
  ['KARTAL', '🦅', 'hayvan'], ['YENGEÇ', '🦀', 'hayvan'], ['DİNOZOR', '🦕', 'hayvan'], ['ÖRÜMCEK', '🕷️', 'hayvan'],
  // Yiyecekler
  ['ELMA', '🍎', 'yiyecek'], ['MUZ', '🍌', 'yiyecek'], ['ÜZÜM', '🍇', 'yiyecek'], ['ÇİLEK', '🍓', 'yiyecek'],
  ['KARPUZ', '🍉', 'yiyecek'], ['LİMON', '🍋', 'yiyecek'], ['HAVUÇ', '🥕', 'yiyecek'], ['PEYNİR', '🧀', 'yiyecek'],
  ['EKMEK', '🍞', 'yiyecek'], ['SÜT', '🥛', 'yiyecek'], ['YUMURTA', '🥚', 'yiyecek'], ['PASTA', '🎂', 'yiyecek'],
  ['DONDURMA', '🍦', 'yiyecek'], ['DOMATES', '🍅', 'yiyecek'], ['MANTAR', '🍄', 'yiyecek'], ['ARMUT', '🍐', 'yiyecek'],
  ['KİRAZ', '🍒', 'yiyecek'], ['PİZZA', '🍕', 'yiyecek'], ['PORTAKAL', '🍊', 'yiyecek'], ['ANANAS', '🍍', 'yiyecek'],
  ['KAVUN', '🍈', 'yiyecek'], ['ŞEFTALİ', '🍑', 'yiyecek'], ['MISIR', '🌽', 'yiyecek'], ['PATATES', '🥔', 'yiyecek'],
  ['SALATALIK', '🥒', 'yiyecek'], ['BİBER', '🫑', 'yiyecek'], ['SOĞAN', '🧅', 'yiyecek'], ['BAL', '🍯', 'yiyecek'],
  ['KEK', '🧁', 'yiyecek'], ['KURABİYE', '🍪', 'yiyecek'], ['ÇİKOLATA', '🍫', 'yiyecek'], ['ŞEKER', '🍬', 'yiyecek'],
  ['HAMBURGER', '🍔', 'yiyecek'], ['ÇAY', '🍵', 'yiyecek'], ['KAHVE', '☕', 'yiyecek'], ['PATLICAN', '🍆', 'yiyecek'],
  ['KESTANE', '🌰', 'yiyecek'], ['SANDVİÇ', '🥪', 'yiyecek'], ['ÇORBA', '🍲', 'yiyecek'], ['KİVİ', '🥝', 'yiyecek'],
  ['ZEYTİN', '🫒', 'yiyecek'], ['TUZ', '🧂', 'yiyecek'],
  // Eşyalar
  ['TOP', '⚽', 'esya'], ['EV', '🏠', 'esya'], ['KALEM', '✏️', 'esya'], ['KİTAP', '📖', 'esya'],
  ['SAAT', '⌚', 'esya'], ['ŞAPKA', '🎩', 'esya'], ['AYAKKABI', '👟', 'esya'], ['ANAHTAR', '🔑', 'esya'],
  ['KAPI', '🚪', 'esya'], ['YATAK', '🛏️', 'esya'], ['BALON', '🎈', 'esya'], ['HEDİYE', '🎁', 'esya'],
  ['ZİL', '🔔', 'esya'], ['DAVUL', '🥁', 'esya'], ['GİTAR', '🎸', 'esya'], ['ÇORAP', '🧦', 'esya'],
  ['ELBİSE', '👗', 'esya'], ['GÖZLÜK', '👓', 'esya'], ['MUM', '🕯️', 'esya'], ['MAKAS', '✂️', 'esya'],
  ['ÇEKİÇ', '🔨', 'esya'], ['ŞEMSİYE', '☂️', 'esya'], ['TELEFON', '📱', 'esya'], ['BİLGİSAYAR', '💻', 'esya'],
  ['TELEVİZYON', '📺', 'esya'], ['LAMBA', '💡', 'esya'], ['SANDALYE', '🪑', 'esya'], ['KOLTUK', '🛋️', 'esya'],
  ['ÇANTA', '🎒', 'esya'], ['GÖMLEK', '👕', 'esya'], ['PANTOLON', '👖', 'esya'], ['ELDİVEN', '🧤', 'esya'],
  ['ATKI', '🧣', 'esya'], ['TAÇ', '👑', 'esya'], ['YÜZÜK', '💍', 'esya'], ['ZARF', '✉️', 'esya'],
  ['KUPA', '🏆', 'esya'], ['ROBOT', '🤖', 'esya'], ['OYUNCAK', '🧸', 'esya'], ['KEMAN', '🎻', 'esya'],
  ['PİYANO', '🎹', 'esya'], ['FIRÇA', '🖌️', 'esya'], ['MIKNATIS', '🧲', 'esya'], ['KAŞIK', '🥄', 'esya'],
  ['FENER', '🔦', 'esya'], ['SABUN', '🧼', 'esya'], ['AYNA', '🪞', 'esya'], ['MERDİVEN', '🪜', 'esya'],
  ['KUTU', '📦', 'esya'], ['PİL', '🔋', 'esya'],
  // Doğa
  ['GÜNEŞ', '☀️', 'doga'], ['AY', '🌙', 'doga'], ['YILDIZ', '⭐', 'doga'], ['ÇİÇEK', '🌸', 'doga'],
  ['AĞAÇ', '🌳', 'doga'], ['BULUT', '☁️', 'doga'], ['KAR', '❄️', 'doga'], ['YAĞMUR', '🌧️', 'doga'],
  ['GÖKKUŞAĞI', '🌈', 'doga'], ['ŞİMŞEK', '⚡', 'doga'], ['ATEŞ', '🔥', 'doga'], ['DAĞ', '⛰️', 'doga'],
  ['DENİZ', '🌊', 'doga'], ['YAPRAK', '🍁', 'doga'], ['GÜL', '🌹', 'doga'], ['KAKTÜS', '🌵', 'doga'],
  ['VOLKAN', '🌋', 'doga'], ['DÜNYA', '🌍', 'doga'], ['ADA', '🏝️', 'doga'], ['ÇAM', '🌲', 'doga'],
  ['LALE', '🌷', 'doga'], ['TAŞ', '🪨', 'doga'],
  // Taşıtlar
  ['ARABA', '🚗', 'tasit'], ['UÇAK', '✈️', 'tasit'], ['GEMİ', '🚢', 'tasit'], ['TREN', '🚆', 'tasit'],
  ['BİSİKLET', '🚲', 'tasit'], ['ROKET', '🚀', 'tasit'], ['OTOBÜS', '🚌', 'tasit'], ['KAMYON', '🚚', 'tasit'],
  ['TAKSİ', '🚕', 'tasit'], ['MOTOR', '🏍️', 'tasit'], ['HELİKOPTER', '🚁', 'tasit'], ['TRAKTÖR', '🚜', 'tasit'],
  ['AMBULANS', '🚑', 'tasit'], ['İTFAİYE', '🚒', 'tasit'], ['TEKNE', '⛵', 'tasit'], ['KANO', '🛶', 'tasit'],
  ['TRAMVAY', '🚋', 'tasit'], ['KIZAK', '🛷', 'tasit'],
  // Beden ve aile
  ['GÖZ', '👁️', 'beden'], ['EL', '✋', 'beden'], ['KULAK', '👂', 'beden'], ['BURUN', '👃', 'beden'],
  ['AYAK', '🦶', 'beden'], ['DİŞ', '🦷', 'beden'], ['KALP', '❤️', 'beden'], ['AĞIZ', '👄', 'beden'],
  ['BEYİN', '🧠', 'beden'], ['KOL', '💪', 'beden'], ['BACAK', '🦵', 'beden'], ['DİL', '👅', 'beden'],
  ['BEBEK', '👶', 'beden'], ['KIZ', '👧', 'beden'], ['ÇOCUK', '🧒', 'beden'], ['DEDE', '👴', 'beden'],
  ['NİNE', '👵', 'beden']
];

window.KATEGORILER = {
  hepsi: 'Hepsi', hayvan: 'Hayvanlar', yiyecek: 'Yiyecekler', esya: 'Eşyalar',
  doga: 'Doğa', tasit: 'Taşıtlar', beden: 'Beden ve aile', ozel: 'Kendi kelimelerim'
};
