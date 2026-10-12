import { PrismaService } from '../prisma/prisma.service.js';
import { Logger } from '@nestjs/common';

export interface GameQuestion {
  index: number;
  questionId: string;
  code: string;
  type: string;
  text: string;
  metadata: any;
  correctAnswer: any;
  durationMs: number;
}

export class QuestionSelector {
  private static readonly logger = new Logger(QuestionSelector.name);

  /**
   * Fisher-Yates algoritması ile diziyi homojen rastgele karıştırır.
   */
  static shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Veritabanından istenen sayıda rastgele ve maç içerisinde benzersiz (tekrarsız) soru seçer.
   * Yeterli aktif soru yoksa aynı soruları sessizce çoğaltmaz, mevcut benzersiz soruları kullanır.
   * Hiç soru yoksa açıkça 'NO_QUESTIONS_AVAILABLE' hatası fırlatır.
   */
  static async selectRandomUniqueQuestions(
    prisma: PrismaService,
    targetCount: number,
    questionDurationMs: number = 10000,
  ): Promise<GameQuestion[]> {
    if (targetCount <= 0) return [];

    // 1. Desteklenen soru tiplerindeki aktif soruların listesini çek
    const candidates = await prisma.question.findMany({
      where: {
        type: { in: ['MULTIPLE_CHOICE', 'ESTIMATION', 'RANKING'] },
        versions: {
          some: {
            versionNumber: 1,
            isActive: true,
          },
        },
      },
      select: {
        id: true,
        type: true,
      },
    });

    if (!candidates || candidates.length === 0) {
      this.logger.error('[QuestionSelector] Veritabanında hiç aktif soru bulunamadı!');
      throw new Error('NO_QUESTIONS_AVAILABLE');
    }

    // 2. Yeterli soru olmaması durumu: Asla aynı soruyu tekrarlama.
    const actualCount = Math.min(targetCount, candidates.length);
    if (candidates.length < targetCount) {
      this.logger.warn(
        `[QuestionSelector] İstenen soru sayısı (${targetCount}), mevcut aktif soru sayısından (${candidates.length}) fazla. Tekrarsız ${candidates.length} benzersiz soru kullanılacak.`,
      );
    }

    // 3. Fisher-Yates ile karıştır ve ilk actualCount kadarını seç (Set/Unique garantisi)
    const shuffledCandidates = this.shuffle(candidates);
    const selectedIds = shuffledCandidates.slice(0, actualCount).map((c) => c.id);

    // 4. Seçilen soruların sürüm detaylarını çek
    const fullQuestions = await prisma.question.findMany({
      where: {
        id: { in: selectedIds },
      },
      include: {
        versions: {
          where: {
            versionNumber: 1,
            isActive: true,
          },
        },
      },
    });

    // 5. Karışık sırayı koruyarak oyun formatına dönüştür
    const questionMap = new Map(fullQuestions.map((q) => [q.id, q]));
    const result: GameQuestion[] = [];

    for (const id of selectedIds) {
      const q = questionMap.get(id);
      if (q && q.versions && q.versions.length > 0 && q.versions[0]) {
        const v = q.versions[0];
        result.push({
          index: result.length,
          questionId: q.id,
          code: q.code,
          type: q.type,
          text: v.text,
          metadata: v.metadata,
          correctAnswer: v.correctAnswer,
          durationMs: questionDurationMs,
        });
      }
    }

    return result;
  }
}
