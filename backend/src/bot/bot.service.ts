import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamesService } from '../games/games.service.js';

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // GamesService modüller arası döngüsel bağımlılık (circular dependency) yaratmamak için
  // GamesService'i direkt inject etmek yerine parametre olarak alabilir veya 
  // forwardRef kullanabiliriz. Şimdilik fonksiyon üzerinden alalım.

  async getAvailableBots(count: number): Promise<string[]> {
    const bots = await this.prisma.user.findMany({
      where: { isBot: true },
      take: 20, // Tüm botları al (zaten 10 tane var)
    });

    // Shuffle and pick `count`
    const shuffled = bots.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count).map(b => b.id);
  }

  async simulateAnswer(
    roomId: string, 
    botId: string, 
    question: any, 
    submitAnswerFn: (roomId: string, userId: string, questionIndex: number, answerData: any) => Promise<any>
  ) {
    // Botların anında cevap vermemesi için 2000-6000ms arası rastgele bir gecikme ekle
    const delay = Math.floor(Math.random() * 4000) + 2000;
    
    setTimeout(async () => {
      let simulatedAnswer: any = null;

      // Basit bir zorluk katsayısı: %60 ihtimalle doğru cevap versin
      const isSmart = Math.random() < 0.6;

      if (question.type === 'MULTIPLE_CHOICE') {
        if (isSmart) {
          simulatedAnswer = question.correctAnswer;
        } else {
          const options = question.metadata?.options || [];
          const wrongOptions = options.filter((o: string) => o !== question.correctAnswer);
          simulatedAnswer = wrongOptions.length > 0 ? wrongOptions[Math.floor(Math.random() * wrongOptions.length)] : options[0];
        }
      } 
      else if (question.type === 'ESTIMATION') {
        const correct = question.correctAnswer as number;
        if (isSmart) {
          // Çok yakın bir cevap (max %5 sapma)
          const variance = correct * 0.05;
          simulatedAnswer = Math.floor(correct + (Math.random() * variance * 2) - variance);
        } else {
          // Uzak bir cevap (max %30 sapma)
          const variance = correct * 0.3;
          simulatedAnswer = Math.floor(correct + (Math.random() * variance * 2) - variance);
        }
      }
      else if (question.type === 'RANKING') {
        const correctArr = question.correctAnswer as string[];
        if (isSmart) {
          simulatedAnswer = [...correctArr];
        } else {
          simulatedAnswer = [...correctArr].sort(() => 0.5 - Math.random());
        }
      }

      this.logger.log(`Bot ${botId} answering question ${question.index} in room ${roomId} after ${delay}ms`);
      await submitAnswerFn(roomId, botId, question.index, simulatedAnswer);
    }, delay);
  }
}
