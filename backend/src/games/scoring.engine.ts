export enum QuestionType {
  ESTIMATION = 'ESTIMATION',
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
  RANKING = 'RANKING',
  PLAYER_GUESS = 'PLAYER_GUESS',
  HARD_QUESTION = 'HARD_QUESTION',
  FINAL = 'FINAL',
}

export interface ScoreResult {
  scoreGained: number;
  isCorrect: boolean;
}

export class ScoringEngine {
  /**
   * Metinleri eşleştirirken Türkçe karakter, aksan ve boşluk farklılıklarını normalize eder.
   * "Arda Güler" === "arda guler", "Pelé" === "pele", "Hakan Çalhanoğlu" === "hakan calhanoglu"
   */
  static normalizeText(text: any): string {
    if (text === null || text === undefined) return '';
    return String(text)
      .trim()
      .toLowerCase()
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Aksanları kaldır (é, è, á vb.)
      .replace(/[^a-z0-9]/g, ' ')      // Noktalama ve tireleri boşluğa çevir
      .replace(/\s+/g, ' ')            // Çoklu boşlukları teke indir
      .trim();
  }

  static calculateScore(
    type: string,
    givenAnswer: any,
    correctAnswer: any,
    metadata?: any,
    allGivenAnswers?: Record<string, any>,
  ): ScoreResult {
    if (givenAnswer === null || givenAnswer === undefined) {
      return { scoreGained: 0, isCorrect: false };
    }
    if (correctAnswer === null || correctAnswer === undefined) {
      return { scoreGained: 0, isCorrect: false };
    }

    switch (type) {
      case QuestionType.MULTIPLE_CHOICE:
        return this.scoreMultipleChoice(givenAnswer, correctAnswer, metadata);

      case QuestionType.ESTIMATION:
        return this.scoreEstimation(givenAnswer, correctAnswer, metadata);

      case QuestionType.RANKING:
        return this.scoreRanking(givenAnswer, correctAnswer);

      case QuestionType.PLAYER_GUESS:
        return this.scorePlayerGuess(givenAnswer, correctAnswer, metadata);

      case QuestionType.HARD_QUESTION:
        return this.scoreHardQuestion(givenAnswer, correctAnswer, metadata);

      case QuestionType.FINAL:
        return this.scoreFinalQuestion(givenAnswer, correctAnswer, metadata);

      default:
        return { scoreGained: 0, isCorrect: false };
    }
  }

  /**
   * Dört Seçenek Puanlaması (Multiple Choice)
   * Doğru seçenek: 1000 puan, Yanlış: 0 puan.
   */
  private static scoreMultipleChoice(given: any, correct: any, metadata?: any): ScoreResult {
    if (given === null || given === undefined || correct === null || correct === undefined) {
      return { scoreGained: 0, isCorrect: false };
    }

    const givenStr = String(given).trim();
    const correctStr = String(correct).trim();

    const isCorrect = givenStr === correctStr || this.normalizeText(givenStr) === this.normalizeText(correctStr);
    return {
      scoreGained: isCorrect ? 1000 : 0,
      isCorrect,
    };
  }

  /**
   * Sayı Tahmini Puanlaması (Estimation)
   * Tam isabet: 1000 Puan.
   * Tolerans marjı: Varsayılan %10 veya metadata.tolerancePercent.
   * Marj içi: Lineer azalan puan (Tam isabet 1000 -> Sınır 0 puan).
   * Marj dışı: 0 Puan.
   */
  private static scoreEstimation(given: any, correct: any, metadata?: any): ScoreResult {
    const givenNum = Number(given);
    const correctNum = Number(correct);

    if (isNaN(givenNum) || !Number.isFinite(givenNum) || isNaN(correctNum) || !Number.isFinite(correctNum)) {
      return { scoreGained: 0, isCorrect: false };
    }

    const diff = Math.abs(givenNum - correctNum);
    if (diff === 0) {
      return { scoreGained: 1000, isCorrect: true };
    }

    const tolerancePercent =
      typeof metadata?.tolerancePercent === 'number' && metadata.tolerancePercent > 0
        ? metadata.tolerancePercent
        : 0.10;

    const margin = Math.abs(correctNum) * tolerancePercent || 1;
    if (diff <= margin) {
      const ratio = 1 - diff / margin;
      const score = Math.max(0, Math.round(ratio * 1000));
      return { scoreGained: score, isCorrect: true };
    }

    return { scoreGained: 0, isCorrect: false };
  }

  /**
   * Sıralama Puanlaması (Ranking)
   * Tüm öğelerin doğru sırada dizilmesi durumunda: 1000 Puan.
   * Herhangi bir sıra sapmasında veya eksik eleman verildiğinde: 0 Puan.
   */
  private static scoreRanking(given: any, correct: any): ScoreResult {
    if (!Array.isArray(given) || !Array.isArray(correct)) {
      return { scoreGained: 0, isCorrect: false };
    }

    if (given.length === 0 || given.length !== correct.length) {
      return { scoreGained: 0, isCorrect: false };
    }

    let isCorrect = true;
    for (let i = 0; i < correct.length; i++) {
      const g = String(given[i]).trim();
      const c = String(correct[i]).trim();
      if (g !== c && this.normalizeText(g) !== this.normalizeText(c)) {
        isCorrect = false;
        break;
      }
    }

    return {
      scoreGained: isCorrect ? 1000 : 0,
      isCorrect,
    };
  }

  /**
   * Futbolcuyu Bul Puanlaması (Player Guess)
   * Cevap eşleştirme kuralları:
   * - Harf büyüklüğü / küçüklüğü duyarsız (case-insensitive)
   * - Türkçe karakter ve aksan normalizasyonu ("Arda Güler" === "arda guler", "Pelé" === "pele")
   * - Metadata aliases desteği ("Messi" kabul edilebilir)
   * Doğru: 1000 Puan, Yanlış: 0 Puan.
   */
  private static scorePlayerGuess(given: any, correct: any, metadata?: any): ScoreResult {
    const normGiven = this.normalizeText(given);
    const normCorrect = this.normalizeText(correct);

    if (!normGiven || !normCorrect) {
      return { scoreGained: 0, isCorrect: false };
    }

    // 1. Doğrudan veya normalize eşleşme
    if (normGiven === normCorrect) {
      return { scoreGained: 1000, isCorrect: true };
    }

    // 2. Metadata takma adlar (aliases) eşleşmesi
    if (metadata?.aliases && Array.isArray(metadata.aliases)) {
      const aliasMatch = metadata.aliases.some(
        (alias: any) => this.normalizeText(alias) === normGiven,
      );
      if (aliasMatch) {
        return { scoreGained: 1000, isCorrect: true };
      }
    }

    return { scoreGained: 0, isCorrect: false };
  }

  /**
   * Zor Soru Puanlaması (Hard Question - Tur 9)
   * Yüksek zorluk derecesi: Doğru cevap 1500 Puan!
   */
  private static scoreHardQuestion(given: any, correct: any, metadata?: any): ScoreResult {
    const normGiven = this.normalizeText(given);
    const normCorrect = this.normalizeText(correct);

    if (!normGiven || !normCorrect) {
      return { scoreGained: 0, isCorrect: false };
    }

    const isMatch =
      normGiven === normCorrect ||
      String(given).trim() === String(correct).trim() ||
      (metadata?.aliases &&
        Array.isArray(metadata.aliases) &&
        metadata.aliases.some((a: any) => this.normalizeText(a) === normGiven));

    return {
      scoreGained: isMatch ? 1500 : 0,
      isCorrect: Boolean(isMatch),
    };
  }

  /**
   * Final Sorusu Puanlaması (Final - Tur 10)
   * Zirve turu / geri dönüş turu: Doğru cevap 2000 Puan!
   */
  private static scoreFinalQuestion(given: any, correct: any, metadata?: any): ScoreResult {
    const normGiven = this.normalizeText(given);
    const normCorrect = this.normalizeText(correct);

    if (!normGiven || !normCorrect) {
      return { scoreGained: 0, isCorrect: false };
    }

    const isMatch =
      normGiven === normCorrect ||
      String(given).trim() === String(correct).trim() ||
      (metadata?.aliases &&
        Array.isArray(metadata.aliases) &&
        metadata.aliases.some((a: any) => this.normalizeText(a) === normGiven));

    return {
      scoreGained: isMatch ? 2000 : 0,
      isCorrect: Boolean(isMatch),
    };
  }
}
