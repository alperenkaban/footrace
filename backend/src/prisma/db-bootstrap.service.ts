import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

@Injectable()
export class DbBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DbBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    this.logger.log('Starting automated database bootstrap and self-healing verification...');
    try {
      await this.ensureSchema();
      await this.ensureGameModes();
      await this.ensureBots();
      await this.ensureQuestions();
      this.logger.log('Database bootstrap and self-healing successfully completed.');
    } catch (err) {
      this.logger.error(`Database bootstrap failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }

  /**
   * MatchHold tablosu ve tekil indekslerin veritabanında varlığını garanti eder.
   */
  private async ensureSchema(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "MatchHold" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "matchId" TEXT,
            "gameModeId" TEXT,
            "amount" INTEGER NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'HELD',
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "refundedAt" TIMESTAMP(3),
            "settledAt" TIMESTAMP(3),
            CONSTRAINT "MatchHold_pkey" PRIMARY KEY ("id")
        );
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "MatchHold_userId_status_idx" ON "MatchHold"("userId", "status");
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "MatchHold_matchId_status_idx" ON "MatchHold"("matchId", "status");
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "CoinTransaction_userId_type_referenceId_key" 
        ON "CoinTransaction"("userId", "type", "referenceId");
      `);

      this.logger.log('Schema tables and indexes verified.');
    } catch (err) {
      this.logger.warn(`ensureSchema warning: ${(err as Error).message}`);
    }
  }

  /**
   * quick_2 ve classic_10 oyun modlarının veritabanında varlığını garanti eder.
   */
  private async ensureGameModes(): Promise<void> {
    await this.prisma.gameMode.upsert({
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

    await this.prisma.gameMode.upsert({
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

    this.logger.log("GameModes 'quick_2' and 'classic_10' verified.");
  }

  /**
   * 10 kişilik maçlar için en az 20 bot kullanıcısının hazır olmasını sağlar.
   */
  private async ensureBots(): Promise<void> {
    const existingBotCount = await this.prisma.user.count({ where: { isBot: true } });
    if (existingBotCount >= 20) {
      this.logger.log(`Bots already verified (${existingBotCount} bots present).`);
      return;
    }

    this.logger.log(`Seeding bots (currently ${existingBotCount})...`);
    for (let i = 1; i <= 20; i++) {
      const email = `bot${i}@footquiz.local`;
      await this.prisma.user.upsert({
        where: { email },
        update: {
          profile: {
            upsert: {
              create: { rating: 1000, balance: 100000 },
              update: {},
            },
          },
        },
        create: {
          email,
          isGuest: false,
          isBot: true,
          profile: {
            create: { rating: 1000, balance: 100000 },
          },
        },
      });
    }
    this.logger.log('20 bot users verified and ready.');
  }

  /**
   * Veritabanında hiç soru yoksa questions.json dosyasından tohumlama yapar.
   */
  private async ensureQuestions(): Promise<void> {
    const questionCount = await this.prisma.question.count();
    if (questionCount >= 10) {
      this.logger.log(`Questions verified (${questionCount} questions in DB).`);
      return;
    }

    const possiblePaths = [
      path.join(__dirname, '..', '..', 'prisma', 'questions.json'),
      path.join(process.cwd(), 'prisma', 'questions.json'),
      path.join(process.cwd(), 'dist', 'prisma', 'questions.json'),
    ];

    let questionsPath = '';
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        questionsPath = p;
        break;
      }
    }

    if (!questionsPath) {
      this.logger.warn('questions.json not found in paths, skipping automatic question seed.');
      return;
    }

    this.logger.log(`Loading questions from ${questionsPath}...`);
    try {
      const raw = fs.readFileSync(questionsPath, 'utf-8');
      const questionsData = JSON.parse(raw);

      for (const q of questionsData) {
        const question = await this.prisma.question.upsert({
          where: { code: q.code },
          update: { type: q.type },
          create: { code: q.code, type: q.type },
        });

        await this.prisma.questionVersion.upsert({
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
      }
      this.logger.log(`Successfully seeded ${questionsData.length} questions.`);
    } catch (err) {
      this.logger.error(`Error loading questions: ${(err as Error).message}`);
    }
  }
}
