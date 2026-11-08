import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScoringEngine, QuestionType } from '../src/games/scoring.engine.js';
import { QuestionValidator } from '../src/games/question-validator.js';
import { QuestionSelector, TEN_ROUND_SEQUENCE } from '../src/games/question-selector.js';
import { GamesService } from '../src/games/games.service.js';

describe('[Faz 4] 10 Turluk Soru Motoru ve Oyun Kuralları', () => {
  // =========================================================================
  // BÖLÜM 1: 10 TURLUK OYUN AKIŞI VE TASARLANAN SIRALAMA DENETİMİ
  // =========================================================================
  describe('1. 10 Turluk Sıralama ve Akış Kuralı (TEN_ROUND_SEQUENCE)', () => {
    it('tasarlanan 10 turun sırası eksiksiz ve doğru QuestionType sıralamasında olmalıdır', () => {
      // 1 Sayı tahmini, 2 Dört seçenek, 3 Sıralama, 4 Sayı tahmini, 5 Futbolcuyu bul,
      // 6 Dört seçenek, 7 Sayı tahmini, 8 Sıralama, 9 Zor soru, 10 Final sorusu.
      expect(TEN_ROUND_SEQUENCE).toHaveLength(10);
      expect(TEN_ROUND_SEQUENCE[0]).toBe(QuestionType.ESTIMATION);       // Tur 1: Sayı tahmini
      expect(TEN_ROUND_SEQUENCE[1]).toBe(QuestionType.MULTIPLE_CHOICE);  // Tur 2: Dört seçenek
      expect(TEN_ROUND_SEQUENCE[2]).toBe(QuestionType.RANKING);          // Tur 3: Sıralama
      expect(TEN_ROUND_SEQUENCE[3]).toBe(QuestionType.ESTIMATION);       // Tur 4: Sayı tahmini
      expect(TEN_ROUND_SEQUENCE[4]).toBe(QuestionType.PLAYER_GUESS);     // Tur 5: Futbolcuyu bul
      expect(TEN_ROUND_SEQUENCE[5]).toBe(QuestionType.MULTIPLE_CHOICE);  // Tur 6: Dört seçenek
      expect(TEN_ROUND_SEQUENCE[6]).toBe(QuestionType.ESTIMATION);       // Tur 7: Sayı tahmini
      expect(TEN_ROUND_SEQUENCE[7]).toBe(QuestionType.RANKING);          // Tur 8: Sıralama
      expect(TEN_ROUND_SEQUENCE[8]).toBe(QuestionType.HARD_QUESTION);    // Tur 9: Zor soru
      expect(TEN_ROUND_SEQUENCE[9]).toBe(QuestionType.FINAL);            // Tur 10: Final sorusu
    });

    it('QuestionSelector 10 turluk bir maç için her turda doğru soru tipini seçmelidir', async () => {
      // Zengin soru havuzu mocku (her tip için birden fazla geçerli soru)
      const mockPool = [
        // ESTIMATION (En az 3 adet)
        { id: 'est_1', code: 'q_est_1', type: QuestionType.ESTIMATION, text: 'Ronaldo kaç gol attı?', correctAnswer: 450, metadata: {} },
        { id: 'est_2', code: 'q_est_2', type: QuestionType.ESTIMATION, text: 'Messi kaç asist yaptı?', correctAnswer: 350, metadata: {} },
        { id: 'est_3', code: 'q_est_3', type: QuestionType.ESTIMATION, text: 'Pele kaç maç oynadı?', correctAnswer: 1200, metadata: {} },
        
        // MULTIPLE_CHOICE (En az 2 adet)
        { id: 'mc_1', code: 'q_mc_1', type: QuestionType.MULTIPLE_CHOICE, text: 'Hangi kulüp en çok UCL kazandı?', correctAnswer: 'Real Madrid', metadata: { options: ['Real Madrid', 'Milan', 'Bayern', 'Liverpool'] } },
        { id: 'mc_2', code: 'q_mc_2', type: QuestionType.MULTIPLE_CHOICE, text: '2010 Dünya Kupasını kim kazandı?', correctAnswer: 'İspanya', metadata: { options: ['İspanya', 'Hollanda', 'Almanya', 'Uruguay'] } },

        // RANKING (En az 2 adet)
        { id: 'rnk_1', code: 'q_rnk_1', type: QuestionType.RANKING, text: 'Kulüpleri kuruluş yılına göre sıralayın.', correctAnswer: ['A', 'B', 'C', 'D'], metadata: { items: ['A', 'B', 'C', 'D'] } },
        { id: 'rnk_2', code: 'q_rnk_2', type: QuestionType.RANKING, text: 'Oyuncuları gol sayısına göre sıralayın.', correctAnswer: ['W', 'X', 'Y', 'Z'], metadata: { items: ['W', 'X', 'Y', 'Z'] } },

        // PLAYER_GUESS (En az 1 adet)
        { id: 'pg_1', code: 'q_pg_1', type: QuestionType.PLAYER_GUESS, text: 'Fenerbahçe altyapısından Real Madride giden 10 numara kimdir?', correctAnswer: 'Arda Güler', metadata: { options: ['Arda Güler', 'Emre Mor', 'Kenan Yıldız', 'Cengiz Ünder'] } },

        // HARD_QUESTION (En az 1 adet)
        { id: 'hq_1', code: 'q_hq_1', type: QuestionType.HARD_QUESTION, text: '1954 Dünya Kupasında 7-5 biten maç kimler arasındaydı?', correctAnswer: 'Avusturya - İsviçre', metadata: { options: ['Avusturya - İsviçre', 'Almanya - Macaristan', 'Brezilya - Polonya', 'Uruguay - İngiltere'] } },

        // FINAL (En az 1 adet)
        { id: 'fn_1', code: 'q_fn_1', type: QuestionType.FINAL, text: 'Dünya Kupası tarihinin en çok gol atan oyuncusu kimdir?', correctAnswer: 'Miroslav Klose', metadata: { options: ['Miroslav Klose', 'Ronaldo Nazario', 'Gerd Müller', 'Just Fontaine'] } },
      ];

      const mockPrisma = {
        question: {
          findMany: vi.fn().mockImplementation((args: any) => {
            if (args.select) {
              return Promise.resolve(mockPool.map((q) => ({ id: q.id, type: q.type })));
            }
            if (args.where?.id?.in) {
              const ids: string[] = args.where.id.in;
              return Promise.resolve(
                mockPool
                  .filter((q) => ids.includes(q.id))
                  .map((q) => ({
                    id: q.id,
                    code: q.code,
                    type: q.type,
                    versions: [
                      {
                        versionNumber: 1,
                        text: q.text,
                        metadata: q.metadata,
                        correctAnswer: q.correctAnswer,
                        isActive: true,
                      },
                    ],
                  })),
              );
            }
            return Promise.resolve([]);
          }),
        },
      } as any;

      const selectedQuestions = await QuestionSelector.selectRandomUniqueQuestions(mockPrisma, 10, 10000);

      expect(selectedQuestions).toHaveLength(10);

      // Her turun tipini doğrula
      for (let i = 0; i < 10; i++) {
        expect(selectedQuestions[i].index).toBe(i);
        expect(selectedQuestions[i].type).toBe(TEN_ROUND_SEQUENCE[i]);
      }

      // Maç içi benzersizlik (tekrarsızlık) garantisi
      const ids = selectedQuestions.map((q) => q.questionId);
      const codes = selectedQuestions.map((q) => q.code);
      expect(new Set(ids).size).toBe(10);
      expect(new Set(codes).size).toBe(10);
    });
  });

  // =========================================================================
  // BÖLÜM 2: SUNUCU OTORİTESİ, ZAMANLAMA VE HİLE KORUMASI (SERVER-AUTHORITY)
  // =========================================================================
  describe('2. Sunucu Otoritesi ve İstemciye Güvenmeme (Server Authority)', () => {
    let gamesService: GamesService;
    let redisMock: any;
    let prismaMock: any;
    let walletMock: any;
    let botMock: any;
    let serverMock: any;

    beforeEach(() => {
      const redisStore: Record<string, string> = {};
      redisMock = {
        get: vi.fn().mockImplementation((k: string) => Promise.resolve(redisStore[k] || null)),
        set: vi.fn().mockImplementation((k: string, v: string) => {
          redisStore[k] = v;
          return Promise.resolve('OK');
        }),
        del: vi.fn().mockImplementation((k: string) => {
          delete redisStore[k];
          return Promise.resolve(1);
        }),
        setNX: vi.fn().mockResolvedValue(true),
      };

      prismaMock = {
        gameMode: { findUnique: vi.fn() },
        matchHold: { updateMany: vi.fn() },
        playerProfile: { findUnique: vi.fn() },
      };

      walletMock = {
        settleMatch: vi.fn().mockResolvedValue({ success: true }),
      };

      botMock = {
        simulateAnswer: vi.fn(),
      };

      serverMock = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      gamesService = new GamesService(redisMock, prismaMock, walletMock, botMock);
      gamesService.setServer(serverMock as any);
    });

    it('question_started paketinde correctAnswer ASLA istemciye gönderilmemelidir', async () => {
      const roomId = 'room-auth-test';
      const sampleQuestion = {
        index: 0,
        questionId: 'q-secret-1',
        code: 'secret_code',
        type: 'MULTIPLE_CHOICE',
        text: 'Gizli soru metni',
        metadata: { options: ['A', 'B', 'C', 'D'] },
        correctAnswer: 'C', // Bu değer gizli kalmalı!
        durationMs: 10000,
      };

      await redisMock.set(
        `room:${roomId}`,
        JSON.stringify({
          status: 'COUNTDOWN',
          currentQuestionIndex: 0,
          questions: [sampleQuestion],
          players: [{ userId: 'user-1', isBot: false }],
        }),
      );

      await gamesService.startQuestionPhase(roomId, 0);

      // question_started yayınını yakala
      expect(serverMock.to).toHaveBeenCalledWith(roomId);
      const questionStartedCall = serverMock.emit.mock.calls.find(
        (call: any[]) => call[0] === 'question_started',
      );
      expect(questionStartedCall).toBeDefined();

      const emittedPayload = questionStartedCall[1];
      expect(emittedPayload.text).toBe('Gizli soru metni');
      expect(emittedPayload.type).toBe('MULTIPLE_CHOICE');
      expect(emittedPayload.durationMs).toBe(10000);
      expect(emittedPayload.questionEndsAt).toBeDefined();
      expect(emittedPayload.serverTime).toBeDefined();

      // KRİTİK GÜVENLİK KANITI: correctAnswer kesinlikle undefined olmalı
      expect(emittedPayload.correctAnswer).toBeUndefined();
    });

    it('room_sync aktif soruda doğru cevabı sızdırmamalıdır', async () => {
      const roomId = 'room-sync-leak-test';
      const sampleQuestion = {
        index: 1,
        questionId: 'q-secret-2',
        type: 'PLAYER_GUESS',
        text: 'Kim bu futbolcu?',
        metadata: { options: ['Arda', 'Icardi', 'Messi', 'Ronaldo'] },
        correctAnswer: 'Arda',
        durationMs: 10000,
      };

      await redisMock.set(
        `room:${roomId}`,
        JSON.stringify({
          status: 'QUESTION_ACTIVE',
          currentQuestionIndex: 1,
          currentQuestion: sampleQuestion,
          questionEndsAt: Date.now() + 8000,
          questions: [{}, sampleQuestion],
          players: [{ userId: 'user-1', score: 0 }],
          givenAnswers: {},
        }),
      );

      const syncState = await gamesService.getRoomSyncState(roomId, 'user-1');

      expect(syncState).toBeDefined();
      expect(syncState.question).toBeDefined();
      expect(syncState.question.type).toBe('PLAYER_GUESS');
      expect(syncState.question.text).toBe('Kim bu futbolcu?');
      // KRİTİK GÜVENLİK KANITI: room_sync soru nesnesinde correctAnswer sızdırılmamalı
      expect(syncState.question.correctAnswer).toBeUndefined();
    });

    it('süre dolduktan sonra (Grace period aşımı) gelen cevaplar sunucu tarafından kesinlikle reddedilmelidir', async () => {
      const roomId = 'room-timeout-test';
      const questionIndex = 0;
      const expiredEndsAt = Date.now() - 2500; // 2.5 saniye önce süre dolmuş

      await redisMock.set(
        `room:${roomId}`,
        JSON.stringify({
          status: 'QUESTION_ACTIVE',
          currentQuestionIndex: questionIndex,
          questionEndsAt: expiredEndsAt,
          players: [{ userId: 'late-user', score: 0 }],
          givenAnswers: {},
        }),
      );

      const result = await gamesService.submitAnswer(roomId, 'late-user', questionIndex, 'Geç Cevap');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Time is up');
    });

    it('aynı soruya aynı oyuncudan gelen mükerrer cevaplar reddedilmelidir', async () => {
      const roomId = 'room-dup-ans-test';
      const questionIndex = 0;

      await redisMock.set(
        `room:${roomId}`,
        JSON.stringify({
          status: 'QUESTION_ACTIVE',
          currentQuestionIndex: questionIndex,
          questionEndsAt: Date.now() + 5000,
          players: [{ userId: 'user-dup', score: 0 }],
          givenAnswers: {},
        }),
      );

      // İlk cevap: Kabul edilmeli
      const firstRes = await gamesService.submitAnswer(roomId, 'user-dup', questionIndex, 'Cevap 1');
      expect(firstRes.success).toBe(true);

      // İkinci cevap: Reddedilmeli
      const secondRes = await gamesService.submitAnswer(roomId, 'user-dup', questionIndex, 'Cevap 2');
      expect(secondRes.success).toBe(false);
      expect(secondRes.error).toBe('Already answered');
    });

    it('odanın üyesi olmayan yabancı kullanıcıların cevap göndermesi engellenmelidir', async () => {
      const roomId = 'room-outsider-test';
      await redisMock.set(
        `room:${roomId}`,
        JSON.stringify({
          status: 'QUESTION_ACTIVE',
          currentQuestionIndex: 0,
          questionEndsAt: Date.now() + 5000,
          players: [{ userId: 'member-user', score: 0 }],
          givenAnswers: {},
        }),
      );

      const res = await gamesService.submitAnswer(roomId, 'intruder-user', 0, 'Hack');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Player not member of room');
    });

    it('odadan ayrılmış (hasLeft) kullanıcının cevap göndermesi engellenmelidir', async () => {
      const roomId = 'room-left-test';
      await redisMock.set(
        `room:${roomId}`,
        JSON.stringify({
          status: 'QUESTION_ACTIVE',
          currentQuestionIndex: 0,
          questionEndsAt: Date.now() + 5000,
          players: [{ userId: 'left-user', score: 0, hasLeft: true }],
          givenAnswers: {},
        }),
      );

      const res = await gamesService.submitAnswer(roomId, 'left-user', 0, 'Cevap');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Player has left the match');
    });
  });

  // =========================================================================
  // BÖLÜM 3: 5 SORU TİPİNİN PUANLAMA VE EŞLEŞTİRME KURALLARI
  // =========================================================================
  describe('3. Soru Tipleri Matematiksel Puanlama ve Tolerans Kuralları', () => {
    describe('a) Sayı Tahmini (ESTIMATION) Tolerans ve Puanlama', () => {
      it('tam isabette 1000 puan vermelidir', () => {
        const res = ScoringEngine.calculateScore(QuestionType.ESTIMATION, 450, 450);
        expect(res.isCorrect).toBe(true);
        expect(res.scoreGained).toBe(1000);
      });

      it('%10 tolerans marjı içinde lineer orantılı puan hesaplamalıdır', () => {
        // Doğru cevap: 100, Marj: 10 (%10)
        // Tahmin: 105 -> Sapma: 5, Kalan oran: 1 - 5/10 = 0.50 -> 500 Puan
        const res = ScoringEngine.calculateScore(QuestionType.ESTIMATION, 105, 100);
        expect(res.isCorrect).toBe(true);
        expect(res.scoreGained).toBe(500);

        // Tahmin: 92 -> Sapma: 8, Kalan oran: 1 - 8/10 = 0.20 -> 200 Puan
        const res2 = ScoringEngine.calculateScore(QuestionType.ESTIMATION, 92, 100);
        expect(res2.isCorrect).toBe(true);
        expect(res2.scoreGained).toBe(200);
      });

      it('%10 marj sınırının dışında kesinlikle 0 puan ve isCorrect=false vermelidir', () => {
        // Doğru cevap: 100, Marj: 10. Tahmin: 111 (Sapma: 11 > 10)
        const res = ScoringEngine.calculateScore(QuestionType.ESTIMATION, 111, 100);
        expect(res.isCorrect).toBe(false);
        expect(res.scoreGained).toBe(0);
      });

      it('özel metadata.tolerancePercent parametresini desteklemelidir', () => {
        // Doğru cevap: 200, Özel tolerans: %20 (margin = 40)
        // Tahmin: 220 (Sapma: 20, 1 - 20/40 = 0.5 -> 500 Puan)
        const res = ScoringEngine.calculateScore(QuestionType.ESTIMATION, 220, 200, {
          tolerancePercent: 0.20,
        });
        expect(res.isCorrect).toBe(true);
        expect(res.scoreGained).toBe(500);
      });

      it('geçersiz sayı, NaN veya null değerlerde çökmeden güvenle 0 puan vermelidir', () => {
        expect(ScoringEngine.calculateScore(QuestionType.ESTIMATION, 'gecersiz', 100).scoreGained).toBe(0);
        expect(ScoringEngine.calculateScore(QuestionType.ESTIMATION, NaN, 100).scoreGained).toBe(0);
        expect(ScoringEngine.calculateScore(QuestionType.ESTIMATION, null, 100).scoreGained).toBe(0);
        expect(ScoringEngine.calculateScore(QuestionType.ESTIMATION, Infinity, 100).scoreGained).toBe(0);
      });
    });

    describe('b) Dört Seçenek (MULTIPLE_CHOICE) Doğrulama', () => {
      it('doğru seçenekte 1000 puan, yanlış seçenekte 0 puan vermelidir', () => {
        const correctRes = ScoringEngine.calculateScore(QuestionType.MULTIPLE_CHOICE, 'Real Madrid', 'Real Madrid');
        expect(correctRes.isCorrect).toBe(true);
        expect(correctRes.scoreGained).toBe(1000);

        const wrongRes = ScoringEngine.calculateScore(QuestionType.MULTIPLE_CHOICE, 'Barcelona', 'Real Madrid');
        expect(wrongRes.isCorrect).toBe(false);
        expect(wrongRes.scoreGained).toBe(0);
      });

      it('boşluk ve harf büyüklüğü farklılıklarında toleranslı olmalıdır', () => {
        const res = ScoringEngine.calculateScore(QuestionType.MULTIPLE_CHOICE, '  Real Madrid  ', 'Real Madrid');
        expect(res.isCorrect).toBe(true);
        expect(res.scoreGained).toBe(1000);
      });
    });

    describe('c) Sıralama (RANKING) Doğruluğu', () => {
      const correctOrder = ['Brezilya', 'İtalya', 'Arjantin', 'Fransa'];

      it('tam ve eksiksiz doğru sıralamada 1000 puan vermelidir', () => {
        const res = ScoringEngine.calculateScore(QuestionType.RANKING, ['Brezilya', 'İtalya', 'Arjantin', 'Fransa'], correctOrder);
        expect(res.isCorrect).toBe(true);
        expect(res.scoreGained).toBe(1000);
      });

      it('herhangi bir sıranın yanlış olması durumunda 0 puan vermelidir', () => {
        const swappedOrder = ['İtalya', 'Brezilya', 'Arjantin', 'Fransa'];
        const res = ScoringEngine.calculateScore(QuestionType.RANKING, swappedOrder, correctOrder);
        expect(res.isCorrect).toBe(false);
        expect(res.scoreGained).toBe(0);
      });

      it('eksik elemanlı dizide veya dizi olmayan cevapta 0 puan vermelidir', () => {
        const incomplete = ['Brezilya', 'İtalya'];
        expect(ScoringEngine.calculateScore(QuestionType.RANKING, incomplete, correctOrder).scoreGained).toBe(0);
        expect(ScoringEngine.calculateScore(QuestionType.RANKING, 'Brezilya', correctOrder).scoreGained).toBe(0);
        expect(ScoringEngine.calculateScore(QuestionType.RANKING, null, correctOrder).scoreGained).toBe(0);
      });
    });

    describe('d) Futbolcuyu Bul (PLAYER_GUESS) Cevap Eşleştirme', () => {
      const correctAnswer = 'Arda Güler';
      const metadata = {
        aliases: ['Arda Guler', 'Guler', 'Arda'],
      };

      it('birebir isim eşleşmesinde 1000 puan vermelidir', () => {
        const res = ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'Arda Güler', correctAnswer, metadata);
        expect(res.isCorrect).toBe(true);
        expect(res.scoreGained).toBe(1000);
      });

      it('Türkçe karakter, küçük harf ve aksan duyarsız eşleşmede 1000 puan vermelidir', () => {
        // "arda guler" -> "Arda Güler"
        const res1 = ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'arda guler', correctAnswer, metadata);
        expect(res1.isCorrect).toBe(true);
        expect(res1.scoreGained).toBe(1000);

        // "Pelé" -> "pele"
        const res2 = ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'pele', 'Pelé');
        expect(res2.isCorrect).toBe(true);
        expect(res2.scoreGained).toBe(1000);

        // "Hakan Çalhanoğlu" -> "hakan calhanoglu"
        const res3 = ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'hakan calhanoglu', 'Hakan Çalhanoğlu');
        expect(res3.isCorrect).toBe(true);
        expect(res3.scoreGained).toBe(1000);
      });

      it('metadata.aliases içindeki geçerli takma adları kabul etmelidir', () => {
        const res = ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'Guler', correctAnswer, metadata);
        expect(res.isCorrect).toBe(true);
        expect(res.scoreGained).toBe(1000);
      });

      it('farklı futbolcu yazıldığında 0 puan vermelidir', () => {
        const res = ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'Kenan Yıldız', correctAnswer, metadata);
        expect(res.isCorrect).toBe(false);
        expect(res.scoreGained).toBe(0);
      });
    });

    describe('e) Zor Soru (HARD_QUESTION) ve Final Sorusu (FINAL) Puan Baremleri', () => {
      it('Zor Soru (Tur 9) doğru cevapta tam 1500 puan vermelidir', () => {
        const resCorrect = ScoringEngine.calculateScore(QuestionType.HARD_QUESTION, 'Avusturya - İsviçre', 'Avusturya - İsviçre');
        expect(resCorrect.isCorrect).toBe(true);
        expect(resCorrect.scoreGained).toBe(1500);

        const resWrong = ScoringEngine.calculateScore(QuestionType.HARD_QUESTION, 'Brezilya - Polonya', 'Avusturya - İsviçre');
        expect(resWrong.isCorrect).toBe(false);
        expect(resWrong.scoreGained).toBe(0);
      });

      it('Final Sorusu (Tur 10) doğru cevapta tam 2000 puan vermelidir', () => {
        const resCorrect = ScoringEngine.calculateScore(QuestionType.FINAL, 'Miroslav Klose', 'Miroslav Klose');
        expect(resCorrect.isCorrect).toBe(true);
        expect(resCorrect.scoreGained).toBe(2000);

        const resWrong = ScoringEngine.calculateScore(QuestionType.FINAL, 'Ronaldo Nazario', 'Miroslav Klose');
        expect(resWrong.isCorrect).toBe(false);
        expect(resWrong.scoreGained).toBe(0);
      });
    });
  });

  // =========================================================================
  // BÖLÜM 4: SORU VERİSİ DOĞRULAMA VE HATA SENARYOLARI (ANTI-CORRUPTION)
  // =========================================================================
  describe('4. Soru Verisi Bütünlüğü ve Hata Senaryoları (QuestionValidator)', () => {
    it('eksik doğru cevap (null, undefined, boş string) tespit edilip elenmelidir', () => {
      const qNull = {
        code: 'q_test_null',
        type: QuestionType.MULTIPLE_CHOICE,
        text: 'Soru metni',
        correctAnswer: null,
        metadata: { options: ['A', 'B', 'C', 'D'] },
      };
      const valNull = QuestionValidator.validateQuestion(qNull);
      expect(valNull.isValid).toBe(false);
      expect(valNull.errors.some((e) => e.includes('correctAnswer'))).toBe(true);

      const qEmpty = {
        code: 'q_test_empty',
        type: QuestionType.PLAYER_GUESS,
        text: 'Kimdir?',
        correctAnswer: '',
      };
      const valEmpty = QuestionValidator.validateQuestion(qEmpty);
      expect(valEmpty.isValid).toBe(false);
    });

    it('bozuk görsel (javascript: URI, boşluk veya geçersiz URL) tespit edilip elenmelidir', () => {
      const qMalicious = {
        code: 'q_test_xss',
        type: QuestionType.MULTIPLE_CHOICE,
        text: 'Görsel sorusu',
        correctAnswer: 'A',
        metadata: {
          options: ['A', 'B', 'C', 'D'],
          imageUrl: 'javascript:alert(1)',
        },
      };
      const valMalicious = QuestionValidator.validateQuestion(qMalicious);
      expect(valMalicious.isValid).toBe(false);
      expect(valMalicious.errors.some((e) => e.includes('görsel'))).toBe(true);

      const qInvalidProtocol = {
        code: 'q_test_proto',
        type: QuestionType.MULTIPLE_CHOICE,
        text: 'Görsel sorusu',
        correctAnswer: 'A',
        metadata: {
          options: ['A', 'B', 'C', 'D'],
          imageUrl: 'ftp://bad-server/pic.png',
        },
      };
      const valInvalidProto = QuestionValidator.validateQuestion(qInvalidProtocol);
      expect(valInvalidProto.isValid).toBe(false);

      // Geçerli HTTPS görsel
      const qValidImg = {
        code: 'q_test_valid_img',
        type: QuestionType.MULTIPLE_CHOICE,
        text: 'Görsel sorusu',
        correctAnswer: 'A',
        metadata: {
          options: ['A', 'B', 'C', 'D'],
          imageUrl: 'https://cdn.footquiz.com/players/arda.webp',
        },
      };
      expect(QuestionValidator.validateQuestion(qValidImg).isValid).toBe(true);
    });

    it('geçersiz seçenek (4 seçenek olmaması, mükerrer şıklar, doğru cevabın şıklarda olmaması) elenmelidir', () => {
      // 1. 4 seçenek yerine 3 seçenek
      const qThreeOpts = {
        code: 'q_three_opts',
        type: QuestionType.MULTIPLE_CHOICE,
        text: 'Soru',
        correctAnswer: 'A',
        metadata: { options: ['A', 'B', 'C'] },
      };
      const valThree = QuestionValidator.validateQuestion(qThreeOpts, { strictFourOptions: true });
      expect(valThree.isValid).toBe(false);

      // 2. Mükerrer seçenekler (Duplicate choices)
      const qDuplicateOpts = {
        code: 'q_dup_opts',
        type: QuestionType.MULTIPLE_CHOICE,
        text: 'Soru',
        correctAnswer: 'Messi',
        metadata: { options: ['Messi', 'Messi', 'Ronaldo', 'Neymar'] },
      };
      const valDup = QuestionValidator.validateQuestion(qDuplicateOpts);
      expect(valDup.isValid).toBe(false);
      expect(valDup.errors.some((e) => e.includes('mükerrer'))).toBe(true);

      // 3. Doğru cevap şıklarda yok
      const qAnswerNotInOptions = {
        code: 'q_missing_in_opts',
        type: QuestionType.MULTIPLE_CHOICE,
        text: 'Soru',
        correctAnswer: 'Mbappe',
        metadata: { options: ['Messi', 'Ronaldo', 'Neymar', 'Haaland'] },
      };
      const valMissing = QuestionValidator.validateQuestion(qAnswerNotInOptions);
      expect(valMissing.isValid).toBe(false);
      expect(valMissing.errors.some((e) => e.includes('seçenekler arasında bulunamadı'))).toBe(true);
    });

    it('tekrarlanan soru (aynı id veya aynı code) tespit edilmelidir', () => {
      const matchQuestions = [
        { id: 'q1', code: 'messi_goals', type: QuestionType.ESTIMATION, text: 'T1', correctAnswer: 800 },
        { id: 'q2', code: 'ronaldo_goals', type: QuestionType.ESTIMATION, text: 'T2', correctAnswer: 850 },
        { id: 'q1', code: 'messi_goals_duplicate', type: QuestionType.ESTIMATION, text: 'T3', correctAnswer: 800 }, // Duplicate ID
      ];

      const check = QuestionValidator.validateQuestionList(matchQuestions);
      expect(check.isValid).toBe(false);
      expect(check.duplicateIds).toContain('q1');
    });
  });

  // =========================================================================
  // BÖLÜM 5: 10 OYUNCULU VE 10 TURLUK UÇTAN UCA MAÇ SİMÜLASYONU
  // =========================================================================
  describe('5. 10 Oyunculu ve 10 Turluk Uçtan Uca Maç Akışı', () => {
    it('10 oyuncu tüm 10 tur boyunca yarışmalı, skorlar doğru toplanmalı ve maç adil sonuçlanmalıdır', async () => {
      // 10 turluk tam bir maç simülasyonu
      const playerScores: Record<string, number> = {};
      const players = Array.from({ length: 10 }, (_, i) => `player_${i + 1}`);
      players.forEach((p) => (playerScores[p] = 0));

      // 10 turun her biri için doğru ve yanlış cevapları simüle et
      for (let roundIndex = 0; roundIndex < 10; roundIndex++) {
        const roundType = TEN_ROUND_SEQUENCE[roundIndex];

        for (let playerIndex = 0; playerIndex < 10; playerIndex++) {
          const playerId = players[playerIndex];

          // Oyuncuların farklı başarı profilleri olsun:
          // Player 1: Her soruyu tam doğru bilsin (Şampiyon adayı)
          // Player 10: Her soruyu yanlış yapsın
          // Diğerleri: Kısmi başarılı olsun
          let scoreResult: any;

          if (playerIndex === 0) {
            // Player 1 -> %100 Doğru
            if (roundType === QuestionType.ESTIMATION) {
              scoreResult = ScoringEngine.calculateScore(roundType, 100, 100);
            } else if (roundType === QuestionType.RANKING) {
              scoreResult = ScoringEngine.calculateScore(roundType, ['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D']);
            } else if (roundType === QuestionType.PLAYER_GUESS) {
              scoreResult = ScoringEngine.calculateScore(roundType, 'Arda Güler', 'Arda Güler');
            } else if (roundType === QuestionType.HARD_QUESTION) {
              scoreResult = ScoringEngine.calculateScore(roundType, 'Zor Cevap', 'Zor Cevap');
            } else if (roundType === QuestionType.FINAL) {
              scoreResult = ScoringEngine.calculateScore(roundType, 'Final Cevap', 'Final Cevap');
            } else {
              scoreResult = ScoringEngine.calculateScore(roundType, 'A', 'A');
            }
          } else if (playerIndex === 9) {
            // Player 10 -> %100 Yanlış
            scoreResult = ScoringEngine.calculateScore(roundType, 'Yanlis', 'Dogru');
          } else {
            // Diğer oyuncular: Tek sayılı turlarda doğru, çift sayılı turlarda yanlış
            const isCorrectRound = (roundIndex + playerIndex) % 2 === 0;
            if (isCorrectRound) {
              if (roundType === QuestionType.ESTIMATION) {
                scoreResult = ScoringEngine.calculateScore(roundType, 100, 100);
              } else if (roundType === QuestionType.HARD_QUESTION) {
                scoreResult = ScoringEngine.calculateScore(roundType, 'Zor Cevap', 'Zor Cevap');
              } else if (roundType === QuestionType.FINAL) {
                scoreResult = ScoringEngine.calculateScore(roundType, 'Final Cevap', 'Final Cevap');
              } else {
                scoreResult = ScoringEngine.calculateScore(roundType, 'A', 'A');
              }
            } else {
              scoreResult = ScoringEngine.calculateScore(roundType, 'Yanlis', 'Dogru');
            }
          }

          playerScores[playerId] += scoreResult.scoreGained;
        }
      }

      // 10 tur sonundaki skorları kontrol et:
      // Player 1:
      // - 3 Estimation (3 * 1000 = 3000)
      // - 2 Multiple Choice (2 * 1000 = 2000)
      // - 2 Ranking (2 * 1000 = 2000)
      // - 1 Player Guess (1 * 1000 = 1000)
      // - 1 Hard Question (1 * 1500 = 1500)
      // - 1 Final Question (1 * 2000 = 2000)
      // Toplam maksimum puan: 3000 + 2000 + 2000 + 1000 + 1500 + 2000 = 11500 Puan!
      expect(playerScores['player_1']).toBe(11500);

      // Player 10: 0 Puan
      expect(playerScores['player_10']).toBe(0);

      // Kazanan liderlik tablosu sıralaması
      const leaderboard = Object.entries(playerScores)
        .map(([id, score]) => ({ userId: id, score }))
        .sort((a, b) => b.score - a.score);

      expect(leaderboard[0].userId).toBe('player_1');
      expect(leaderboard[0].score).toBe(11500);
      expect(leaderboard[9].userId).toBe('player_10');
      expect(leaderboard[9].score).toBe(0);
    });
  });
});
