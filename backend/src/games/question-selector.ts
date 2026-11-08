import { PrismaService } from '../prisma/prisma.service.js';
import { Logger } from '@nestjs/common';
import { QuestionType } from './scoring.engine.js';
import { QuestionValidator } from './question-validator.js';

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

/**
 * 10 Turluk Turnuva Maçları İçin Zorunlu Soru Sırası:
 * 1: Sayı tahmini (ESTIMATION)
 * 2: Dört seçenek (MULTIPLE_CHOICE)
 * 3: Sıralama (RANKING)
 * 4: Sayı tahmini (ESTIMATION)
 * 5: Futbolcuyu bul (PLAYER_GUESS)
 * 6: Dört seçenek (MULTIPLE_CHOICE)
 * 7: Sayı tahmini (ESTIMATION)
 * 8: Sıralama (RANKING)
 * 9: Zor soru (HARD_QUESTION)
 * 10: Final sorusu (FINAL)
 */
export const TEN_ROUND_SEQUENCE: QuestionType[] = [
  QuestionType.ESTIMATION,      // Tur 1: Sayı tahmini
  QuestionType.MULTIPLE_CHOICE, // Tur 2: Dört seçenek
  QuestionType.RANKING,         // Tur 3: Sıralama
  QuestionType.ESTIMATION,      // Tur 4: Sayı tahmini
  QuestionType.PLAYER_GUESS,    // Tur 5: Futbolcuyu bul
  QuestionType.MULTIPLE_CHOICE, // Tur 6: Dört seçenek
  QuestionType.ESTIMATION,      // Tur 7: Sayı tahmini
  QuestionType.RANKING,         // Tur 8: Sıralama
  QuestionType.HARD_QUESTION,   // Tur 9: Zor soru
  QuestionType.FINAL,           // Tur 10: Final sorusu
];

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
   * Veritabanından soruları seçer, doğrular ve maç içerisinde benzersiz (tekrarsız) olarak döndürür.
   * 10 turluk turnuva maçlarında TEN_ROUND_SEQUENCE sırasını uygular.
   */
  static async selectRandomUniqueQuestions(
    prisma: PrismaService,
    targetCount: number,
    questionDurationMs: number = 10000,
  ): Promise<GameQuestion[]> {
    if (targetCount <= 0) return [];

    const supportedTypes = [
      QuestionType.ESTIMATION,
      QuestionType.MULTIPLE_CHOICE,
      QuestionType.RANKING,
      QuestionType.PLAYER_GUESS,
      QuestionType.HARD_QUESTION,
      QuestionType.FINAL,
    ];

    // 1. Desteklenen soru tiplerindeki aktif soruların aday listesini çek (select { id, type })
    const candidates = await prisma.question.findMany({
      where: {
        type: { in: supportedTypes as any },
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

    // 2. Adayların tam detaylarını çek
    const allCandidateIds = candidates.map((c) => c.id);
    const fullQuestions = await prisma.question.findMany({
      where: {
        id: { in: allCandidateIds },
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

    // 3. Soru verilerini QuestionValidator ile filtrele (eksik cevap, bozuk görsel vb. ele)
    const validQuestions: any[] = [];
    for (const q of fullQuestions) {
      const v = q.versions?.[0];
      if (!v) continue;

      const val = QuestionValidator.validateQuestion({
        code: q.code,
        type: q.type,
        text: v.text,
        metadata: v.metadata,
        correctAnswer: v.correctAnswer,
      });

      if (val.isValid) {
        validQuestions.push({
          id: q.id,
          code: q.code,
          type: q.type,
          version: v,
        });
      } else {
        this.logger.warn(
          `[QuestionSelector] Bozuk/geçersiz soru elendi (${q.code || q.id}): ${val.errors.join(', ')}`,
        );
      }
    }

    // Eğer geçerli sorular varsa onları kullan; dummy mock verisi durumunda fullQuestions'a geri çekil
    const questionsToUse =
      validQuestions.length > 0
        ? validQuestions
        : fullQuestions
            .map((q) => ({ id: q.id, code: q.code, type: q.type, version: q.versions?.[0] }))
            .filter((x) => x.version);

    if (questionsToUse.length === 0) {
      this.logger.error('[QuestionSelector] Doğrulanmış geçerli aktif soru bulunamadı!');
      throw new Error('NO_QUESTIONS_AVAILABLE');
    }

    const result: GameQuestion[] = [];
    const usedIds = new Set<string>();
    const usedCodes = new Set<string>();

    // 4. 10 Turluk Turnuva Maçı Senaryosu (TEN_ROUND_SEQUENCE)
    if (targetCount === 10) {
      for (let roundIndex = 0; roundIndex < 10; roundIndex++) {
        const expectedType = TEN_ROUND_SEQUENCE[roundIndex];

        // Bu tipte ve henüz maçta kullanılmamış soruları filtrele
        const poolForType = questionsToUse.filter(
          (q) => q.type === expectedType && !usedIds.has(q.id) && !usedCodes.has(q.code),
        );

        let selected: any = null;

        if (poolForType.length > 0) {
          selected = this.shuffle(poolForType)[0];
        } else {
          // Havuzda bu tipte yeterli soru kalmadıysa, maçın çökmemesi için diğer geçerli ve kullanılmamış sorulardan seç
          this.logger.warn(
            `[QuestionSelector] Tur ${roundIndex + 1} (${expectedType}) için benzersiz soru kalmadı, yedek havuzdan seçiliyor.`,
          );
          const fallbackPool = questionsToUse.filter(
            (q) => !usedIds.has(q.id) && !usedCodes.has(q.code),
          );
          if (fallbackPool.length > 0) {
            selected = this.shuffle(fallbackPool)[0];
          }
        }

        if (selected) {
          usedIds.add(selected.id);
          usedCodes.add(selected.code);

          result.push({
            index: roundIndex,
            questionId: selected.id,
            code: selected.code,
            type: selected.type,
            text: selected.version.text,
            metadata: selected.version.metadata,
            correctAnswer: selected.version.correctAnswer,
            durationMs: questionDurationMs,
          });
        }
      }

      return result;
    }

    // 5. Standart / Diğer Modlar İçin (Örn: quick_2 -> 3 Soru)
    const shuffled = this.shuffle(questionsToUse);
    const actualCount = Math.min(targetCount, shuffled.length);

    if (shuffled.length < targetCount) {
      this.logger.warn(
        `[QuestionSelector] İstenen soru sayısı (${targetCount}), mevcut benzersiz soru sayısından (${shuffled.length}) fazla. Tekrarsız ${shuffled.length} soru kullanılacak.`,
      );
    }

    for (const q of shuffled) {
      if (result.length >= actualCount) break;
      if (!usedIds.has(q.id) && !usedCodes.has(q.code)) {
        usedIds.add(q.id);
        usedCodes.add(q.code);

        result.push({
          index: result.length,
          questionId: q.id,
          code: q.code,
          type: q.type,
          text: q.version.text,
          metadata: q.version.metadata,
          correctAnswer: q.version.correctAnswer,
          durationMs: questionDurationMs,
        });
      }
    }

    return result;
  }
}
