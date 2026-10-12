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
              displayName: `Bot ${i}`,
              rating: 1000,
              balance: 100000,
            },
            update: {
              displayName: `Bot ${i}`,
            },
          },
        },
      },
      create: {
        email: `bot${i}@footquiz.local`,
        isGuest: false,
        isBot: true,
        profile: {
          create: {
            displayName: `Bot ${i}`,
            rating: 1000,
            balance: 100000, // Botların maç girişleri için yeterli bakiyesi olsun
          },
        },
      },
    });
  }
  console.log('20 Bot kullanıcısı hazır.');

  // 2. GameMode ekle / güncelle (Idempotent upsert)
  // quick_2 (2 Kişilik Hızlı Maç - 3 Soru)
  await prisma.gameMode.upsert({
    where: { name: 'quick_2' },
    update: {
      maxPlayers: 2,
      questionCount: 3,
      questionDuration: 10,
      entryFee: 100,
      rewardMultiplier: 1.0,
      ratingEnabled: false,
    },
    create: {
      name: 'quick_2',
      maxPlayers: 2,
      questionCount: 3,
      questionDuration: 10,
      entryFee: 100,
      rewardMultiplier: 1.0,
      ratingEnabled: false,
    },
  });
  console.log("GameMode 'quick_2' hazır.");

  // classic_10 (10 Kişilik Büyük Turnuva - 10 Soru)
  await prisma.gameMode.upsert({
    where: { name: 'classic_10' },
    update: {
      maxPlayers: 10,
      questionCount: 10,
      questionDuration: 10,
      entryFee: 100,
      rewardMultiplier: 1.0,
      ratingEnabled: true,
    },
    create: {
      name: 'classic_10',
      maxPlayers: 10,
      questionCount: 10,
      questionDuration: 10,
      entryFee: 100,
      rewardMultiplier: 1.0,
      ratingEnabled: true,
    },
  });
  console.log("GameMode 'classic_10' hazır.");

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
