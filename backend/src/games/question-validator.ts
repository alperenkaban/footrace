import { QuestionType } from './scoring.engine.js';

export interface QuestionValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface QuestionListValidationResult {
  isValid: boolean;
  duplicateIds: string[];
  duplicateCodes: string[];
  invalidQuestions: { index: number; code?: string; errors: string[] }[];
}

export class QuestionValidator {
  private static readonly VALID_TYPES = new Set<string>([
    QuestionType.ESTIMATION,
    QuestionType.MULTIPLE_CHOICE,
    QuestionType.RANKING,
    QuestionType.PLAYER_GUESS,
    QuestionType.HARD_QUESTION,
    QuestionType.FINAL,
  ]);

  /**
   * Görsel URL'sinin güvenli ve geçerli formatta olup olmadığını denetler.
   * "javascript:", "vbscript:", bozuk/boş string veya güvensiz şemaları reddeder.
   */
  static isImageUrlValid(url: any): boolean {
    if (typeof url !== 'string' || !url.trim()) return false;
    const trimmed = url.trim().toLowerCase();

    // Tehlikeli şemalar (XSS / protocol injection)
    if (
      trimmed.startsWith('javascript:') ||
      trimmed.startsWith('vbscript:') ||
      trimmed.startsWith('data:text/html')
    ) {
      return false;
    }

    // Geçerli URL veya relative asset path olmalı
    const isValidProtocol =
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('/');

    if (!isValidProtocol) return false;

    // Basit uzantı veya path kontrolü
    return trimmed.length >= 4;
  }

  /**
   * Tekil bir sorunun şemasını, cevabını, seçeneklerini ve görsellerini denetler.
   * Eksik cevap, geçersiz seçenek veya bozuk görsel tespit edilirse isValid=false döner.
   */
  static validateQuestion(
    q: any,
    options: { strictFourOptions?: boolean } = {},
  ): QuestionValidationResult {
    const errors: string[] = [];

    if (!q || typeof q !== 'object') {
      return { isValid: false, errors: ['Soru verisi geçerli bir nesne değil.'] };
    }

    // 1. Soru kodu kontrolü
    if (!q.code || typeof q.code !== 'string' || !q.code.trim()) {
      errors.push('Soru kodu (code) eksik veya geçersiz.');
    }

    // 2. Soru tipi kontrolü
    if (!q.type || !this.VALID_TYPES.has(q.type)) {
      errors.push(`Geçersiz soru tipi: ${q.type}`);
    }

    // 3. Soru metni kontrolü
    if (!q.text || typeof q.text !== 'string' || !q.text.trim()) {
      errors.push('Soru metni (text) boş veya eksik.');
    }

    // 4. Doğru cevap (correctAnswer) kontrolü - Eksik cevap engeli
    if (q.correctAnswer === null || q.correctAnswer === undefined || q.correctAnswer === '') {
      errors.push('Doğru cevap (correctAnswer) eksik veya boş.');
    }

    // 5. Görsel kontrolü (Metadata imageUrl) - Bozuk görsel engeli
    const imageUrl = q.metadata?.imageUrl || q.metadata?.image;
    if (imageUrl !== undefined && imageUrl !== null) {
      if (!this.isImageUrlValid(imageUrl)) {
        errors.push(`Bozuk veya güvensiz görsel URL'si: ${imageUrl}`);
      }
    }

    // 6. Tip bazlı seçenek ve cevap kontrolleri - Geçersiz seçenek engeli
    if (q.type === QuestionType.MULTIPLE_CHOICE) {
      const opts = q.metadata?.options;
      const minCount = options.strictFourOptions ? 4 : 2;
      const maxCount = options.strictFourOptions ? 4 : 10;

      if (!Array.isArray(opts) || opts.length < minCount || (options.strictFourOptions && opts.length !== 4)) {
        errors.push(
          options.strictFourOptions
            ? 'MULTIPLE_CHOICE tipi tam olarak 4 seçenek içermelidir.'
            : `MULTIPLE_CHOICE seçenekleri en az ${minCount} eleman içermelidir.`,
        );
      } else {
        const hasEmptyOption = opts.some(
          (opt: any) => typeof opt !== 'string' || !opt.trim(),
        );
        if (hasEmptyOption) {
          errors.push('MULTIPLE_CHOICE seçenekleri boş string veya geçersiz tip içeremez.');
        }

        const uniqueOptions = new Set(opts.map((opt: any) => String(opt).trim()));
        if (uniqueOptions.size !== opts.length) {
          errors.push('MULTIPLE_CHOICE seçenekleri arasında mükerrer (tekrarlanan) seçenek olamaz.');
        }

        if (q.correctAnswer !== null && q.correctAnswer !== undefined) {
          const correctStr = String(q.correctAnswer).trim();
          if (!uniqueOptions.has(correctStr)) {
            errors.push(`Doğru cevap (${correctStr}) seçenekler arasında bulunamadı!`);
          }
        }
      }
    } else if (q.type === QuestionType.ESTIMATION) {
      const numAnswer = Number(q.correctAnswer);
      if (isNaN(numAnswer) || !Number.isFinite(numAnswer)) {
        errors.push('ESTIMATION tipi doğru cevabı geçerli ve sonlu bir sayı olmalıdır.');
      }
    } else if (q.type === QuestionType.RANKING) {
      const items = q.metadata?.items;
      const correct = q.correctAnswer;

      if (items !== undefined && (!Array.isArray(items) || items.length < 2)) {
        errors.push('RANKING tipi metadata.items en az 2 eleman içermelidir.');
      }

      if (!Array.isArray(correct)) {
        errors.push('RANKING tipi doğru cevabı bir dizi olmalıdır.');
      } else if (Array.isArray(items)) {
        if (correct.length !== items.length) {
          errors.push('RANKING doğru cevap uzunluğu ile metadata.items uzunluğu eşleşmiyor.');
        } else {
          const itemSet = new Set(items.map((i: any) => String(i).trim()));
          if (itemSet.size !== items.length) {
            errors.push('RANKING öğeleri arasında mükerrer (tekrarlı) eleman olamaz.');
          }
          for (const c of correct) {
            if (!itemSet.has(String(c).trim())) {
              errors.push(`RANKING doğru cevabındaki '${c}' öğesi items listesinde yok.`);
            }
          }
        }
      }
    } else if (q.type === QuestionType.PLAYER_GUESS) {
      if (typeof q.correctAnswer !== 'string' || !q.correctAnswer.trim()) {
        errors.push('PLAYER_GUESS doğru cevabı geçerli bir futbolcu ismi olmalıdır.');
      }
      if (q.metadata?.options && Array.isArray(q.metadata.options)) {
        const opts = q.metadata.options.map((o: any) => String(o).trim());
        if (!opts.includes(String(q.correctAnswer).trim())) {
          errors.push('PLAYER_GUESS doğru cevabı verilen seçenekler arasında yer almıyor.');
        }
      }
    } else if (q.type === QuestionType.HARD_QUESTION || q.type === QuestionType.FINAL) {
      if (q.metadata?.options && Array.isArray(q.metadata.options)) {
        if (options.strictFourOptions && q.metadata.options.length !== 4) {
          errors.push(`${q.type} tipi seçenekli ise tam olarak 4 seçenek içermelidir.`);
        } else {
          const opts = q.metadata.options.map((o: any) => String(o).trim());
          if (!opts.includes(String(q.correctAnswer).trim())) {
            errors.push(`${q.type} doğru cevabı seçenekler arasında yer almıyor.`);
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Bir maç için seçilen veya soru havuzundaki bir soru listesini denetler.
   * Maç içi tekrarlanan soru (aynı id veya aynı code) senaryolarını yakalar.
   */
  static validateQuestionList(
    questions: any[],
    options: { strictFourOptions?: boolean } = {},
  ): QuestionListValidationResult {
    const seenIds = new Set<string>();
    const seenCodes = new Set<string>();
    const duplicateIds: string[] = [];
    const duplicateCodes: string[] = [];
    const invalidQuestions: { index: number; code?: string; errors: string[] }[] = [];

    questions.forEach((q, index) => {
      const qId = q.id || q.questionId;
      if (qId) {
        if (seenIds.has(qId)) {
          duplicateIds.push(qId);
        } else {
          seenIds.add(qId);
        }
      }

      if (q.code) {
        if (seenCodes.has(q.code)) {
          duplicateCodes.push(q.code);
        } else {
          seenCodes.add(q.code);
        }
      }

      const val = this.validateQuestion(q, options);
      if (!val.isValid) {
        invalidQuestions.push({
          index,
          code: q.code,
          errors: val.errors,
        });
      }
    });

    const isUnique = duplicateIds.length === 0 && duplicateCodes.length === 0;
    const isValid = isUnique && invalidQuestions.length === 0;

    return {
      isValid,
      duplicateIds,
      duplicateCodes,
      invalidQuestions,
    };
  }
}
