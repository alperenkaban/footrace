import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding başlatılıyor...');

  // 1. Bot Kullanıcılarını oluştur (Idempotent upsert - 20 Bot)
  for (let i = 1; i <= 20; i++) {
    await prisma.user.upsert({
      where: { email: `bot${i}@footquiz.local` },
      update: {
        profile: {
          upsert: {
            create: {
              rating: 1000,
              balance: 100000,
            },
            update: {},
          },
        },
      },
      create: {
        email: `bot${i}@footquiz.local`,
        isGuest: false,
        isBot: true,
        profile: {
          create: {
            rating: 1000,
            balance: 100000, // Botların maç girişleri için yeterli bakiyesi olsun
          },
        },
      },
    });
  }
  console.log('20 Bot kullanıcısı hazır.');

  // 2. GameMode ekle / güncelle (Idempotent upsert)
  const gameModesList = [
    // 10 Kişilik Turnuva Modları
    { name: 'classic_10', maxPlayers: 10, questionCount: 10, questionDuration: 10, entryFee: 100, ratingEnabled: true },
    { name: 'classic_10_silver', maxPlayers: 10, questionCount: 10, questionDuration: 10, entryFee: 250, ratingEnabled: true },
    { name: 'classic_10_gold', maxPlayers: 10, questionCount: 10, questionDuration: 10, entryFee: 500, ratingEnabled: true },
    { name: 'classic_10_diamond', maxPlayers: 10, questionCount: 10, questionDuration: 10, entryFee: 1000, ratingEnabled: true },

    // 2 Kişilik Hızlı Düello Modları
    { name: 'quick_2', maxPlayers: 2, questionCount: 3, questionDuration: 10, entryFee: 100, ratingEnabled: false },
    { name: 'quick_2_silver', maxPlayers: 2, questionCount: 3, questionDuration: 10, entryFee: 250, ratingEnabled: false },
    { name: 'quick_2_gold', maxPlayers: 2, questionCount: 3, questionDuration: 10, entryFee: 500, ratingEnabled: false },
    { name: 'quick_2_diamond', maxPlayers: 2, questionCount: 3, questionDuration: 10, entryFee: 1000, ratingEnabled: false },
  ];

  for (const m of gameModesList) {
    await prisma.gameMode.upsert({
      where: { name: m.name },
      update: {
        maxPlayers: m.maxPlayers,
        questionCount: m.questionCount,
        questionDuration: m.questionDuration,
        entryFee: m.entryFee,
        rewardMultiplier: 1.0,
        ratingEnabled: m.ratingEnabled,
      },
      create: {
        name: m.name,
        maxPlayers: m.maxPlayers,
        questionCount: m.questionCount,
        questionDuration: m.questionDuration,
        entryFee: m.entryFee,
        rewardMultiplier: 1.0,
        ratingEnabled: m.ratingEnabled,
      },
    });
  }
  console.log(`${gameModesList.length} GameMode (Bronz, Gümüş, Altın, Elmas) hazır.`);

  // 3. Harici questions.json dosyasından soruları yükle (Idempotent upsert)
  const questionsPath = path.join(__dirname, 'questions.json');
  if (!fs.existsSync(questionsPath)) {
    throw new Error(`questions.json dosyası bulunamadı: ${questionsPath}`);
  }

  const questionsData = JSON.parse(fs.readFileSync(questionsPath, 'utf-8'));
  console.log(`${questionsData.length} soru veritabanına aktarılıyor / senkronize ediliyor...`);

  let count = 0;
  for (const q of questionsData) {
    const question = await prisma.question.upsert({
      where: { code: q.code },
      update: {
        type: q.type,
      },
      create: {
        code: q.code,
        type: q.type,
      },
    });

    await prisma.questionVersion.upsert({
      where: {
        questionId_versionNumber: {
          questionId: question.id,
          versionNumber: 1,
        },
      },
      update: {
        text: q.text,
        metadata: q.metadata,
        correctAnswer: q.correctAnswer,
        isActive: true,
      },
      create: {
        questionId: question.id,
        versionNumber: 1,
        text: q.text,
        metadata: q.metadata,
        correctAnswer: q.correctAnswer,
        isActive: true,
      },
    });
    count++;
  }

  console.log(`Tohumlama (Seeding) tamamlandı! Toplam ${count} soru hazır.`);
}

main()
  .catch((e) => {
    console.error('Seeding hatası:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
