import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamesService } from '../games/games.service.js';

export type BotSkillLevel = 'ACEMI' | 'NORMAL' | 'USTA';

export interface BotSkillProfile {
  level: BotSkillLevel;
  accuracy: number; // 0.60, 0.75, 0.90
}

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Bot beceri dağılımı:
   * %25 Acemi  (%60 doğruluk)
   * %50 Normal (%75 doğruluk)
   * %25 Usta   (%90 doğruluk)
   * Ağırlıklı Ortalama: 0.25*0.60 + 0.50*0.75 + 0.25*0.90 = 0.75 (%75)
   */
  getBotSkillProfile(botId: string): BotSkillProfile {
    // Deterministik bot skill ataması (bot ID'sinin sayısal özeti üzerinden)
    let hash = 0;
    for (let i = 0; i < botId.length; i++) {
      hash = (hash * 31 + botId.charCodeAt(i)) >>> 0;
    }
    const bucket = hash % 100;

    if (bucket < 25) {
      return { level: 'ACEMI', accuracy: 0.60 };
    } else if (bucket < 75) {
      return { level: 'NORMAL', accuracy: 0.75 };
    } else {
      return { level: 'USTA', accuracy: 0.90 };
    }
  }

  async getAvailableBots(count: number, excludeIds: string[] = []): Promise<string[]> {
    const bots = await this.prisma.user.findMany({
      where: {
        isBot: true,
        ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      },
      take: 50,
    });

    const shuffled = [...bots].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count).map((b) => b.id);

    // DB'de yeterli bot yoksa anında dinamik bot profilleri oluşturarak sayıyı tamamla
    if (selected.length < count) {
      const neededMore = count - selected.length;
      for (let i = 1; i <= neededMore; i++) {
        const dynIndex = selected.length + i;
        const dynEmail = `bot_dyn_${Date.now()}_${dynIndex}@footquiz.local`;
        try {
          const newBot = await this.prisma.user.create({
            data: {
              email: dynEmail,
              isGuest: false,
              isBot: true,
              profile: {
                create: {
                  rating: 1000,
                  balance: 100000,
                },
              },
            },
          });
          selected.push(newBot.id);
        } catch (err) {
          this.logger.warn(`Failed to dynamically create bot: ${(err as Error).message}`);
        }
      }
    }

    return selected;
  }

  /**
   * Soru tipine göre botun cevabını üretir.
   * ScoringEngine kurallarıyla %100 uyumludur.
   */
  generateBotAnswer(botId: string, question: any): any {
    const profile = this.getBotSkillProfile(botId);
    const shouldBeCorrect = Math.random() < profile.accuracy;

    if (question.type === 'MULTIPLE_CHOICE') {
      if (shouldBeCorrect) {
        return question.correctAnswer;
      }
      const options: string[] = question.metadata?.options || [];
      const wrongOptions = options.filter((o) => o !== question.correctAnswer);
      if (wrongOptions.length > 0) {
        return wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
      }
      return question.correctAnswer;
    }

    if (question.type === 'ESTIMATION') {
      const correct = Number(question.correctAnswer);
      const margin = correct * 0.10 || 1; // ScoringEngine %10 sapma marjı tanır
      
      if (shouldBeCorrect) {
        // Marj dahilinde (%10'un altında sapma, örn: %1 ila %7 sapma)
        const maxOffset = Math.max(1, Math.floor(margin * 0.7));
        const sign = Math.random() < 0.5 ? -1 : 1;
        const offset = Math.floor(Math.random() * maxOffset) * sign;
        return correct + offset;
      } else {
        // Marj dışında (%15 ila %40 sapma) -> kesinlikle puan alamaz (isCorrect: false)
        const minOffset = Math.ceil(margin * 1.5);
        const extraOffset = Math.floor(Math.random() * (margin * 2));
        const sign = Math.random() < 0.5 ? -1 : 1;
        const offset = (minOffset + extraOffset) * sign;
        return correct + offset;
      }
    }

    if (question.type === 'RANKING') {
      const correctArr: string[] = Array.isArray(question.correctAnswer)
        ? [...question.correctAnswer]
        : [];

      if (shouldBeCorrect || correctArr.length < 2) {
        return [...correctArr];
      }

      // Yanlış cevap için en az iki elemanın yerini garanti değiştir
      const wrongArr = [...correctArr];
      const temp = wrongArr[0];
      wrongArr[0] = wrongArr[1];
      wrongArr[1] = temp;
      return wrongArr;
    }

    // PLAYER_GUESS, HARD_QUESTION, FINAL desteği
    if (question.type === 'PLAYER_GUESS' || question.type === 'HARD_QUESTION' || question.type === 'FINAL') {
      if (shouldBeCorrect) {
        return question.correctAnswer;
      }
      const options: string[] = question.metadata?.options || [];
      const wrongOptions = options.filter((o) => o !== question.correctAnswer);
      if (wrongOptions.length > 0) {
        return wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
      }
      return typeof question.correctAnswer === 'string' ? `${question.correctAnswer}_wrong` : 'wrong_answer';
    }

    return null;
  }

  async simulateAnswer(
    roomId: string, 
    botId: string, 
    question: any, 
    submitAnswerFn: (roomId: string, userId: string, questionIndex: number, answerData: any) => Promise<any>
  ) {
    // Botların doğal hissettirmesi için 1500-5000ms arası gecikme
    const delay = Math.floor(Math.random() * 3500) + 1500;
    
    setTimeout(async () => {
      const simulatedAnswer = this.generateBotAnswer(botId, question);
      this.logger.log(`Bot ${botId} answering question ${question.index ?? question.questionIndex} in room ${roomId} after ${delay}ms`);
      await submitAnswerFn(roomId, botId, question.index ?? question.questionIndex ?? 0, simulatedAnswer);
    }, delay);
  }
}
