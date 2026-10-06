import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Veritabanı temizleniyor...');
  await prisma.questionVersion.deleteMany({});
  await prisma.question.deleteMany({});
  
  // Bot Kullanıcılarını oluştur
  for (let i = 1; i <= 10; i++) {
    await prisma.user.upsert({
      where: { email: `bot${i}@footquiz.local` },
      update: {},
      create: {
        email: `bot${i}@footquiz.local`,
        isGuest: false,
        isBot: true,
        profile: {
          create: {
            rating: 1000,
            balance: 100000, // Botların bol parası olsun
          }
        }
      }
    });
  }
  console.log('Bot kullanıcıları eklendi...');

  console.log('GameMode ekleniyor...');
  const gameMode = await prisma.gameMode.upsert({
    where: { name: 'quick_2' },
    update: {},
    create: {
      name: 'quick_2',
      maxPlayers: 2,
      questionCount: 3, // MVP test için kısa
      questionDuration: 10,
      entryFee: 100, // Giriş ücreti
      rewardMultiplier: 1.0,
      ratingEnabled: false,
    },
  });

  console.log('Futbol Soruları ekleniyor...');

  // Soru 1: Çoktan Seçmeli
  const q1 = await prisma.question.create({
    data: {
      code: 'q_messi_birth',
      type: 'MULTIPLE_CHOICE',
      versions: {
        create: {
          text: 'Messi hangi ülkede doğmuştur?',
          metadata: {
            options: ['Arjantin', 'İspanya', 'Brezilya', 'Uruguay']
          },
          correctAnswer: 'Arjantin',
          versionNumber: 1,
        }
      }
    }
  });

  // Soru 2: Çoktan Seçmeli
  const q2 = await prisma.question.create({
    data: {
      code: 'q_ucl_most_wins',
      type: 'MULTIPLE_CHOICE',
      versions: {
        create: {
          text: 'Şampiyonlar Ligi kupasını en çok kazanan takım hangisidir?',
          metadata: {
            options: ['Barcelona', 'AC Milan', 'Real Madrid', 'Bayern Münih']
          },
          correctAnswer: 'Real Madrid',
          versionNumber: 1,
        }
      }
    }
  });

  // Soru 3: Çoktan Seçmeli
  const q3 = await prisma.question.create({
    data: {
      code: 'q_uefa_2000_turkish',
      type: 'MULTIPLE_CHOICE',
      versions: {
        create: {
          text: '2000 yılında UEFA Kupasını kazanan Türk takımı hangisidir?',
          metadata: {
            options: ['Fenerbahçe', 'Galatasaray', 'Beşiktaş', 'Trabzonspor']
          },
          correctAnswer: 'Galatasaray',
          versionNumber: 1,
        }
      }
    }
  });

  // Soru 4: Tahmin (ESTIMATION)
  const q4 = await prisma.question.create({
    data: {
      code: 'q_ronaldo_total_goals',
      type: 'ESTIMATION',
      versions: {
        create: {
          text: 'Cristiano Ronaldo profesyonel kariyerinde toplam kaç gol atmıştır? (Yaklaşık - 2024 itibariyle)',
          metadata: {
            min: 500,
            max: 1200
          },
          correctAnswer: 900,
          versionNumber: 1,
        }
      }
    }
  });

  // Soru 5: Sıralama (RANKING)
  const q5 = await prisma.question.create({
    data: {
      code: 'q_world_cup_winners_order',
      type: 'RANKING',
      versions: {
        create: {
          text: 'Aşağıdaki takımları Dünya Kupası kazanma sayılarına göre ÇOKTAN AZA doğru sıralayın.',
          metadata: {
            items: ['Brezilya', 'İtalya', 'Arjantin', 'İngiltere'] // Sadece şıklar, karışık sırayla verilebilir
          },
          correctAnswer: ['Brezilya', 'İtalya', 'Arjantin', 'İngiltere'], // Doğru sıralama
          versionNumber: 1,
        }
      }
    }
  });

  console.log('Tohumlama (Seeding) tamamlandı!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
