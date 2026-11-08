import * as fs from 'fs';
import * as path from 'path';

const questionsPath = path.resolve('backend/prisma/questions.json');
const currentQuestions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

const newQuestions = [
  // 10 FUTBOLCUYU BUL (PLAYER_GUESS) - Tur 5, 1000 Puan
  {
    code: "q_pg_arda_guler",
    type: "PLAYER_GUESS",
    category: "Futbolcuyu Bul",
    text: "Kariyeri: Gençlerbirliği altyapısı, Fenerbahçe, Real Madrid. 2024'te Real Madrid ile Şampiyonlar Ligi şampiyonu olan genç Türk 10 numara kimdir?",
    metadata: {
      options: ["Arda Güler", "Kenan Yıldız", "Emre Mor", "Cengiz Ünder"],
      aliases: ["Arda Guler", "Guler", "Arda"],
      clues: ["Fenerbahçe altyapısında parladı", "Real Madrid'de 15 numaralı formayı giydi"],
      imageUrl: "https://assets.footquiz.local/players/arda_guler.webp"
    },
    correctAnswer: "Arda Güler"
  },
  {
    code: "q_pg_icardi",
    type: "PLAYER_GUESS",
    category: "Futbolcuyu Bul",
    text: "Kariyeri: Sampdoria, Inter, Paris Saint-Germain, Galatasaray. 'Aşkın Olayım' şarkısıyla özdeşleşen Arjantinli süper santrfor kimdir?",
    metadata: {
      options: ["Mauro Icardi", "Lautaro Martinez", "Gonzalo Higuain", "Sergio Agüero"],
      aliases: ["Icardi", "Mauro Icardi"],
      clues: ["Inter kaptanlığı yaptı", "Galatasaray ile Süper Lig şampiyonlukları yaşadı"],
      imageUrl: "https://assets.footquiz.local/players/icardi.webp"
    },
    correctAnswer: "Mauro Icardi"
  },
  {
    code: "q_pg_lewandowski",
    type: "PLAYER_GUESS",
    category: "Futbolcuyu Bul",
    text: "Kariyeri: Lech Poznan, Borussia Dortmund, Bayern Münih, Barcelona. Wolfsburg karşısında 9 dakikada 5 gol atan Polonyalı gol makinesi kimdir?",
    metadata: {
      options: ["Robert Lewandowski", "Erling Haaland", "Krzysztof Piatek", "Arkadiusz Milik"],
      aliases: ["Lewandowski", "Robert Lewandowski"],
      clues: ["Bundesliga'da bir sezonda 41 gol attı", "2020 FIFA En İyi Erkek Futbolcu ödülü"],
      imageUrl: "https://assets.footquiz.local/players/lewandowski.webp"
    },
    correctAnswer: "Robert Lewandowski"
  },
  {
    code: "q_pg_drogba",
    type: "PLAYER_GUESS",
    category: "Futbolcuyu Bul",
    text: "Kariyeri: Marsilya, Chelsea, Şanghay Shenhua, Galatasaray, Montreal Impact. 2012 Münih Şampiyonlar Ligi finalinde zafer penaltısını atan Fildişi Sahilli efsane kimdir?",
    metadata: {
      options: ["Didier Drogba", "Samuel Eto'o", "Yaya Toure", "Emmanuel Adebayor"],
      aliases: ["Drogba", "Didier Drogba"],
      clues: ["Chelsea tarihinin en büyük golcülerinden biri", "Galatasaray ile Real Madrid ve Juventus zaferleri yaşadı"],
      imageUrl: "https://assets.footquiz.local/players/drogba.webp"
    },
    correctAnswer: "Didier Drogba"
  },
  {
    code: "q_pg_modric",
    type: "PLAYER_GUESS",
    category: "Futbolcuyu Bul",
    text: "Kariyeri: Dinamo Zagreb, Tottenham Hotspur, Real Madrid. 2018 Dünya Kupası En Değerli Oyuncusu seçilen ve Ballon d'Or kazanan Hırvat orta saha virtüözü kimdir?",
    metadata: {
      options: ["Luka Modric", "Ivan Rakitic", "Mateo Kovacic", "Marcelo Brozovic"],
      aliases: ["Modric", "Luka Modric"],
      clues: ["Real Madrid ile 6 Şampiyonlar Ligi zaferi kazandı", "2018 Dünya Kupası finalisti"],
      imageUrl: "https://assets.footquiz.local/players/modric.webp"
    },
    correctAnswer: "Luka Modric"
  },
  {
    code: "q_pg_haaland",
    type: "PLAYER_GUESS",
    category: "Futbolcuyu Bul",
    text: "Kariyeri: Molde, RB Salzburg, Borussia Dortmund, Manchester City. Premier League'de ilk sezonunda 36 gol atarak tüm zamanların rekorunu kıran Norveçli santrfor kimdir?",
    metadata: {
      options: ["Erling Haaland", "Alexander Isak", "Rasmus Hojlund", "Martin Odegaard"],
      aliases: ["Haaland", "Erling Haaland", "Erling Braut Haaland"],
      clues: ["Manchester City ile Treble kazandı", "U20 Dünya Kupası'nda tek maçta 9 gol attı"],
      imageUrl: "https://assets.footquiz.local/players/haaland.webp"
    },
    correctAnswer: "Erling Haaland"
  },
  {
    code: "q_pg_zidane",
    type: "PLAYER_GUESS",
    category: "Futbolcuyu Bul",
    text: "Kariyeri: Cannes, Bordeaux, Juventus, Real Madrid. 2002 Şampiyonlar Ligi finalinde Bayer Leverkusen'e unutulmaz vole golünü atan Fransız 10 numara kimdir?",
    metadata: {
      options: ["Zinedine Zidane", "Michel Platini", "Thierry Henry", "Didier Deschamps"],
      aliases: ["Zidane", "Zinedine Zidane", "Zizou"],
      clues: ["1998 Dünya Kupası şampiyonu", "Real Madrid ile hoca olarak 3 Şampiyonlar Ligi kazandı"],
      imageUrl: "https://assets.footquiz.local/players/zidane.webp"
    },
    correctAnswer: "Zinedine Zidane"
  },
  {
    code: "q_pg_de_bruyne",
    type: "PLAYER_GUESS",
    category: "Futbolcuyu Bul",
    text: "Kariyeri: Genk, Chelsea, Werder Bremen, Wolfsburg, Manchester City. Premier League'de tek sezonda 20 asist rekorunu egale eden Belçikalı pas ustası kimdir?",
    metadata: {
      options: ["Kevin De Bruyne", "Eden Hazard", "Romelu Lukaku", "Christian Eriksen"],
      aliases: ["Kevin De Bruyne", "De Bruyne", "KDB"],
      clues: ["Manchester City maestrosu", "2 kez Premier League Yılın Oyuncusu seçildi"],
      imageUrl: "https://assets.footquiz.local/players/debruyne.webp"
    },
    correctAnswer: "Kevin De Bruyne"
  },
  {
    code: "q_pg_iniesta",
    type: "PLAYER_GUESS",
    category: "Futbolcuyu Bul",
    text: "Kariyeri: Albacete altyapısı, Barcelona, Vissel Kobe, Emirates Club. 2010 Dünya Kupası finalinin 116. dakikasında şampiyonluk golünü atan İspanyol sihirbaz kimdir?",
    metadata: {
      options: ["Andres Iniesta", "Xavi Hernandez", "David Silva", "Cesc Fabregas"],
      aliases: ["Andres Iniesta", "Iniesta"],
      clues: ["Barcelona'nın unutulmaz tiki-taka orta sahası", "Stamford Bridge'de Chelsea'ye son dakika golü attı"],
      imageUrl: "https://assets.footquiz.local/players/iniesta.webp"
    },
    correctAnswer: "Andres Iniesta"
  },
  {
    code: "q_pg_buffon",
    type: "PLAYER_GUESS",
    category: "Futbolcuyu Bul",
    text: "Kariyeri: Parma, Juventus, Paris Saint-Germain. 2006 Dünya Kupası şampiyonu, Serie A tarihinin en çok maça çıkan efsanevi İtalyan eldiveni kimdir?",
    metadata: {
      options: ["Gianluigi Buffon", "Iker Casillas", "Manuel Neuer", "Dino Zoff"],
      aliases: ["Buffon", "Gianluigi Buffon", "Gigi Buffon"],
      clues: ["Serie A'da 657 maça çıktı", "Parma'da başlayıp Parma'da jübile yaptı"],
      imageUrl: "https://assets.footquiz.local/players/buffon.webp"
    },
    correctAnswer: "Gianluigi Buffon"
  },

  // 10 ZOR SORU (HARD_QUESTION) - Tur 9, 1500 Puan
  {
    code: "q_hq_ucl_first_winner",
    type: "HARD_QUESTION",
    category: "Zor Sorular",
    text: "1955-56 sezonunda düzenlenen tarihteki ilk Şampiyon Kulüpler Kupası finalinde Real Madrid kimi 4-3 yenerek kupayı müzesine götürmüştür?",
    metadata: {
      options: ["Stade de Reims", "Fiorentina", "AC Milan", "Benfica"]
    },
    correctAnswer: "Stade de Reims"
  },
  {
    code: "q_hq_world_cup_most_goals_match",
    type: "HARD_QUESTION",
    category: "Zor Sorular",
    text: "Dünya Kupası tarihinin 12 golle en çok gole sahne olan 1954 yılındaki meşhur maçı (7-5) hangi iki ülke arasında oynanmıştır?",
    metadata: {
      options: ["Avusturya - İsviçre", "Macaristan - Batı Almanya", "Brezilya - Polonya", "Uruguay - İngiltere"]
    },
    correctAnswer: "Avusturya - İsviçre"
  },
  {
    code: "q_hq_fastest_red_card",
    type: "HARD_QUESTION",
    category: "Zor Sorular",
    text: "1986 Dünya Kupası'nda İskoçya maçının henüz 56. saniyesinde kırmızı kart görerek Dünya Kupası tarihinin en hızlı ihraç edilen futbolcusu olan Uruguaylı kimdir?",
    metadata: {
      options: ["Jose Batista", "Enzo Francescoli", "Paolo Montero", "Ruben Sosa"]
    },
    correctAnswer: "Jose Batista"
  },
  {
    code: "q_hq_euro_1992_replacement",
    type: "HARD_QUESTION",
    category: "Zor Sorular",
    text: "EURO 1992'ye ambargo nedeniyle katılamayan Yugoslavya'nın yerine tatilden çağrılıp turnuvada Avrupa Şampiyonu olan ülke hangisidir?",
    metadata: {
      options: ["Danimarka", "İsveç", "Yunanistan", "Çekoslovakya"]
    },
    correctAnswer: "Danimarka"
  },
  {
    code: "q_hq_super_lig_undefeated",
    type: "HARD_QUESTION",
    category: "Zor Sorular",
    text: "Süper Lig tarihinde bir sezonu tek bir mağlubiyet dahi almadan 'Yenilgisiz Şampiyon' olarak tamamlayan tek takım hangisidir?",
    metadata: {
      options: ["Beşiktaş (1991-92)", "Galatasaray (1999-00)", "Fenerbahçe (1988-89)", "Trabzonspor (1978-79)"]
    },
    correctAnswer: "Beşiktaş (1991-92)"
  },
  {
    code: "q_hq_golden_ball_goalkeeper",
    type: "HARD_QUESTION",
    category: "Zor Sorular",
    text: "Tarihte Ballon d'Or (Yılın Futbolcusu) ödülünü kazanmayı başaran İLK VE TEK kaleci kimdir?",
    metadata: {
      options: ["Lev Yashin", "Dino Zoff", "Gianluigi Buffon", "Oliver Kahn"]
    },
    correctAnswer: "Lev Yashin"
  },
  {
    code: "q_hq_pele_1000_penalty",
    type: "HARD_QUESTION",
    category: "Zor Sorular",
    text: "Futbol kralı Pelé, kariyerinin efsanevi 1000. golünü (O Milésimo) 1969'da Maracana'da hangi kulübe karşı atmıştır?",
    metadata: {
      options: ["Vasco da Gama", "Flamengo", "Corinthians", "Palmeiras"]
    },
    correctAnswer: "Vasco da Gama"
  },
  {
    code: "q_hq_afcon_most_titles",
    type: "HARD_QUESTION",
    category: "Zor Sorular",
    text: "Afrika Uluslar Kupası (AFCON) tarihinde toplam 7 şampiyonlukla en çok kupa kazanan milli takım hangisidir?",
    metadata: {
      options: ["Mısır", "Kamerun", "Gana", "Nijerya"]
    },
    correctAnswer: "Mısır"
  },
  {
    code: "q_hq_champions_league_three_clubs",
    type: "HARD_QUESTION",
    category: "Zor Sorular",
    text: "UEFA Şampiyonlar Ligi'ni ÜÇ FARKLI kulüple (Ajax, Real Madrid, Milan) kazanmış tarihteki tek futbolcu kimdir?",
    metadata: {
      options: ["Clarence Seedorf", "Cristiano Ronaldo", "Samuel Eto'o", "Zlatan Ibrahimovic"]
    },
    correctAnswer: "Clarence Seedorf"
  },
  {
    code: "q_hq_world_cup_highest_attendance",
    type: "HARD_QUESTION",
    category: "Zor Sorular",
    text: "Dünya Kupası tarihinin yaklaşık 200.000 seyirciyle resmi olarak en kalabalık maçı olan 1950 Maracanazo hangi iki takım arasında oynanmıştır?",
    metadata: {
      options: ["Uruguay - Brezilya", "Brezilya - İsveç", "İtalya - Macaristan", "Almanya - Arjantin"]
    },
    correctAnswer: "Uruguay - Brezilya"
  },

  // 10 FINAL SORUSU (FINAL) - Tur 10, 2000 Puan
  {
    code: "q_fn_world_cup_most_scored_player",
    type: "FINAL",
    category: "Büyük Final",
    text: "FİNAL SORUSU: FIFA Dünya Kupaları tarihinin toplam 16 golle EN ÇOK GOL ATAN oyuncusu kimdir?",
    metadata: {
      options: ["Miroslav Klose", "Ronaldo Nazário", "Gerd Müller", "Just Fontaine"]
    },
    correctAnswer: "Miroslav Klose"
  },
  {
    code: "q_fn_uefa_cup_first_turkish_winner",
    type: "FINAL",
    category: "Büyük Final",
    text: "FİNAL SORUSU: 17 Mayıs 2000 tarihinde Kopenhag'da Arsenal'i penaltılarda yenerek UEFA Kupası'nı kazanan Türk kulübü hangisidir?",
    metadata: {
      options: ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"]
    },
    correctAnswer: "Galatasaray"
  },
  {
    code: "q_fn_champions_league_all_time_top_scorer",
    type: "FINAL",
    category: "Büyük Final",
    text: "FİNAL SORUSU: UEFA Şampiyonlar Ligi tarihinin 140 golle tüm zamanların en çok gol atan futbolcusu kimdir?",
    metadata: {
      options: ["Cristiano Ronaldo", "Lionel Messi", "Robert Lewandowski", "Karim Benzema"]
    },
    correctAnswer: "Cristiano Ronaldo"
  },
  {
    code: "q_fn_first_world_cup_host_winner",
    type: "FINAL",
    category: "Büyük Final",
    text: "FİNAL SORUSU: 1930 yılında düzenlenen ilk FIFA Dünya Kupası'na ev sahipliği yapan ve finalde Arjantin'i 4-2 yenerek kupayı kaldıran ilk şampiyon kimdir?",
    metadata: {
      options: ["Uruguay", "Brezilya", "İtalya", "Arjantin"]
    },
    correctAnswer: "Uruguay"
  },
  {
    code: "q_fn_treble_winner_manager_two_clubs",
    type: "FINAL",
    category: "Büyük Final",
    text: "FİNAL SORUSU: Hem Barcelona (2009) hem de Manchester City (2023) ile 'Treble' (Lig, Kupa, Şampiyonlar Ligi) yapmayı başaran teknik adam kimdir?",
    metadata: {
      options: ["Pep Guardiola", "Jose Mourinho", "Carlo Ancelotti", "Alex Ferguson"]
    },
    correctAnswer: "Pep Guardiola"
  },
  {
    code: "q_fn_golden_boy_first_winner",
    type: "FINAL",
    category: "Büyük Final",
    text: "FİNAL SORUSU: Tuttosport tarafından 2003 yılında ilk kez dağıtılan Avrupa'nın en iyi genç oyuncusu ödülü 'Golden Boy'un ilk kazananı kimdir?",
    metadata: {
      options: ["Rafael van der Vaart", "Wayne Rooney", "Lionel Messi", "Cesc Fabregas"]
    },
    correctAnswer: "Rafael van der Vaart"
  },
  {
    code: "q_fn_single_tournament_world_cup_record",
    type: "FINAL",
    category: "Büyük Final",
    text: "FİNAL SORUSU: 1958 Dünya Kupası'nda tek bir turnuvada attığı 13 golle kırılamaz bir rekora imza atan Fransız forvet kimdir?",
    metadata: {
      options: ["Just Fontaine", "Kylian Mbappe", "Thierry Henry", "Michel Platini"]
    },
    correctAnswer: "Just Fontaine"
  },
  {
    code: "q_fn_copa_america_most_titles",
    type: "FINAL",
    category: "Büyük Final",
    text: "FİNAL SORUSU: 2024 yılında 16. şampiyonluğunu kazanarak Copa America tarihinin en çok şampiyon olan ülkesi unvanını elde eden ülke hangisidir?",
    metadata: {
      options: ["Arjantin", "Uruguay", "Brezilya", "Şili"]
    },
    correctAnswer: "Arjantin"
  },
  {
    code: "q_fn_turkey_world_cup_third_place_year",
    type: "FINAL",
    category: "Büyük Final",
    text: "FİNAL SORUSU: Türkiye A Milli Futbol Takımı'nın Şenol Güneş yönetiminde Dünya Üçüncüsü olduğu tarihi Dünya Kupası hangi yıldır?",
    metadata: {
      options: ["2002", "1998", "2006", "1954"]
    },
    correctAnswer: "2002"
  },
  {
    code: "q_fn_fastest_goal_world_cup",
    type: "FINAL",
    category: "Büyük Final",
    text: "FİNAL SORUSU: 2002 Dünya Kupası üçüncülük maçında Güney Kore'ye henüz 10.8. saniyede gol atarak Dünya Kupası tarihinin en hızlı golünü atan futbolcu kimdir?",
    metadata: {
      options: ["Hakan Şükür", "İlhan Mansız", "Nihat Kahveci", "Hasan Şaş"]
    },
    correctAnswer: "Hakan Şükür"
  }
];

// Mevcut soruların kodlarını al
const existingCodes = new Set(currentQuestions.map(q => q.code));
const added = [];

for (const q of newQuestions) {
  if (!existingCodes.has(q.code)) {
    currentQuestions.push(q);
    existingCodes.add(q.code);
    added.push(q.code);
  }
}

fs.writeFileSync(questionsPath, JSON.stringify(currentQuestions, null, 2), 'utf8');
console.log(`Eklendi: ${added.length} soru. Toplam soru sayısı: ${currentQuestions.length}`);
