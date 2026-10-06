export enum QuestionType {
  ESTIMATION = 'ESTIMATION',
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
  RANKING = 'RANKING',
  PLAYER_GUESS = 'PLAYER_GUESS',
  HARD_QUESTION = 'HARD_QUESTION',
  FINAL = 'FINAL'
}

export interface ScoreResult {
  scoreGained: number;
  isCorrect: boolean;
}

export class ScoringEngine {
  static calculateScore(
    type: string, 
    givenAnswer: any, 
    correctAnswer: any, 
    metadata?: any, 
    allGivenAnswers?: Record<string, any>
  ): ScoreResult {
    
    if (givenAnswer === null || givenAnswer === undefined) {
      return { scoreGained: 0, isCorrect: false };
    }

    switch (type) {
      case QuestionType.MULTIPLE_CHOICE:
        return this.scoreMultipleChoice(givenAnswer, correctAnswer);
      
      case QuestionType.ESTIMATION:
        return this.scoreEstimation(givenAnswer, correctAnswer);
        
      case QuestionType.RANKING:
        return this.scoreRanking(givenAnswer, correctAnswer);
        
      default:
        return { scoreGained: 0, isCorrect: false };
    }
  }

  private static scoreMultipleChoice(given: string, correct: string): ScoreResult {
    const isCorrect = given === correct;
    return {
      scoreGained: isCorrect ? 1000 : 0,
      isCorrect
    };
  }

  private static scoreEstimation(given: number, correct: number): ScoreResult {
    // Örnek Puanlama:
    // Tam isabet: 1000 Puan
    // Yakınlık oranına göre düşen puan (Örn: %10 yanılma payı = 0 puan)
    
    const diff = Math.abs(given - correct);
    if (diff === 0) {
      return { scoreGained: 1000, isCorrect: true };
    }

    // %10 sapma marjı verelim (örneğin doğru cevap 100 ise 90 ile 110 arası puan alır)
    const margin = correct * 0.10 || 1; // Eğer correct 0 ise margin 1 olsun
    if (diff <= margin) {
      // Lineer olarak puanı düşür (En uzak sınır 0 puan, tam isabet 1000)
      const ratio = 1 - (diff / margin);
      const score = Math.floor(ratio * 1000);
      return { scoreGained: score, isCorrect: true }; // Kısmî doğru
    }

    return { scoreGained: 0, isCorrect: false };
  }

  private static scoreRanking(given: string[], correct: string[]): ScoreResult {
    // Array içeriğini kıyasla
    if (!Array.isArray(given) || !Array.isArray(correct)) {
      return { scoreGained: 0, isCorrect: false };
    }
    
    let isCorrect = true;
    for (let i = 0; i < correct.length; i++) {
      if (given[i] !== correct[i]) {
        isCorrect = false;
        break;
      }
    }

    return {
      scoreGained: isCorrect ? 1000 : 0,
      isCorrect
    };
  }
}
