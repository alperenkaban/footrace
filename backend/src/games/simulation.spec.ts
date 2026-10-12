import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BotService } from '../bot/bot.service.js';
import { ScoringEngine, QuestionType } from './scoring.engine.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('Scenario 9 & 10: Bot Accuracy Simulation (10,000+ rounds) & Scoring Compatibility', () => {
  let botService: BotService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      user: {
        findMany: vi.fn(),
      },
    };
    botService = new BotService(prismaMock as unknown as PrismaService);
  });

  describe('Scenario 9: Bot Accuracy over 10,000+ simulations', () => {
    it('should assign deterministic skill profiles: Acemi (25%), Normal (50%), Usta (25%)', () => {
      const skills = {
        ACEMI: 0,
        NORMAL: 0,
        USTA: 0,
      };

      // Test across 1,000 distinct bot IDs
      for (let i = 1; i <= 1000; i++) {
        const profile = botService.getBotSkillProfile(`bot-uuid-${i}`);
        skills[profile.level]++;
      }

      // Expected distribution: ~25% Acemi, ~50% Normal, ~25% Usta
      const acemiPct = skills.ACEMI / 1000;
      const normalPct = skills.NORMAL / 1000;
      const ustaPct = skills.USTA / 1000;

      expect(acemiPct).toBeGreaterThanOrEqual(0.20);
      expect(acemiPct).toBeLessThanOrEqual(0.30);

      expect(normalPct).toBeGreaterThanOrEqual(0.44);
      expect(normalPct).toBeLessThanOrEqual(0.56);

      expect(ustaPct).toBeGreaterThanOrEqual(0.20);
      expect(ustaPct).toBeLessThanOrEqual(0.30);
    });

    it('should measure bot accuracy over at least 10,000 simulations and achieve ~75% weighted average', () => {
      const TOTAL_SIMULATIONS = 12000;
      const sampleQuestion = {
        type: 'MULTIPLE_CHOICE',
        correctAnswer: 'B',
        metadata: {
          options: ['A', 'B', 'C', 'D'],
        },
        durationMs: 10000,
      };

      let acemiAttempts = 0;
      let acemiCorrect = 0;

      let normalAttempts = 0;
      let normalCorrect = 0;

      let ustaAttempts = 0;
      let ustaCorrect = 0;

      for (let i = 0; i < TOTAL_SIMULATIONS; i++) {
        const botId = `bot-sim-${i}`;
        const profile = botService.getBotSkillProfile(botId);
        const answer = botService.generateBotAnswer(botId, sampleQuestion);

        const scoreResult = ScoringEngine.calculateScore(sampleQuestion.type, answer, sampleQuestion.correctAnswer);
        const isCorrect = scoreResult.isCorrect;

        if (profile.level === 'ACEMI') {
          acemiAttempts++;
          if (isCorrect) acemiCorrect++;
        } else if (profile.level === 'NORMAL') {
          normalAttempts++;
          if (isCorrect) normalCorrect++;
        } else if (profile.level === 'USTA') {
          ustaAttempts++;
          if (isCorrect) ustaCorrect++;
        }
      }

      const acemiAccuracy = acemiCorrect / acemiAttempts;
      const normalAccuracy = normalCorrect / normalAttempts;
      const ustaAccuracy = ustaCorrect / ustaAttempts;

      const totalCorrect = acemiCorrect + normalCorrect + ustaCorrect;
      const overallAccuracy = totalCorrect / TOTAL_SIMULATIONS;

      console.log(`[Bot Simulation 12,000 rounds results]:
        - Total Simulations: ${TOTAL_SIMULATIONS}
        - Acemi: ${(acemiAccuracy * 100).toFixed(2)}% (${acemiCorrect}/${acemiAttempts}, target ~60%)
        - Normal: ${(normalAccuracy * 100).toFixed(2)}% (${normalCorrect}/${normalAttempts}, target ~75%)
        - Usta: ${(ustaAccuracy * 100).toFixed(2)}% (${ustaCorrect}/${ustaAttempts}, target ~90%)
        - Overall Weighted Accuracy: ${(overallAccuracy * 100).toFixed(2)}% (target ~75%)`);

      // Acemi accuracy target is 60% (tolerance ±2.5%)
      expect(acemiAccuracy).toBeGreaterThanOrEqual(0.575);
      expect(acemiAccuracy).toBeLessThanOrEqual(0.625);

      // Normal accuracy target is 75% (tolerance ±2.5%)
      expect(normalAccuracy).toBeGreaterThanOrEqual(0.725);
      expect(normalAccuracy).toBeLessThanOrEqual(0.775);

      // Usta accuracy target is 90% (tolerance ±2.5%)
      expect(ustaAccuracy).toBeGreaterThanOrEqual(0.875);
      expect(ustaAccuracy).toBeLessThanOrEqual(0.925);

      // Overall weighted accuracy should be tightly centered around 75% (tolerance ±1.5%)
      expect(overallAccuracy).toBeGreaterThanOrEqual(0.735);
      expect(overallAccuracy).toBeLessThanOrEqual(0.765);
    });

    it('should generate valid bot answers for ESTIMATION and RANKING questions', () => {
      // 1. Estimation
      const estimationQuestion = {
        type: 'ESTIMATION',
        correctAnswer: 100,
        metadata: { margin: 10 },
      };

      for (let i = 0; i < 50; i++) {
        const answer = botService.generateBotAnswer(`bot-est-${i}`, estimationQuestion);
        expect(typeof answer === 'number').toBe(true);
        expect(Number.isFinite(answer)).toBe(true);
        expect(answer).toBeGreaterThan(0);
      }

      // 2. Ranking
      const rankingQuestion = {
        type: 'RANKING',
        correctAnswer: ['Real Madrid', 'Barcelona', 'Bayern Munich', 'Arsenal'],
        metadata: { items: ['Arsenal', 'Barcelona', 'Real Madrid', 'Bayern Munich'] },
      };

      for (let i = 0; i < 50; i++) {
        const answer = botService.generateBotAnswer(`bot-rank-${i}`, rankingQuestion);
        expect(Array.isArray(answer)).toBe(true);
        expect(answer.length).toBe(4);
        expect(new Set(answer).size).toBe(4);
      }
    });
  });

  describe('Scenario 10: Scoring and Question Type Compatibility', () => {
    it('MULTIPLE_CHOICE: correct gives 1000 points, wrong gives 0', () => {
      const correctRes = ScoringEngine.calculateScore('MULTIPLE_CHOICE', 'C', 'C');
      expect(correctRes.isCorrect).toBe(true);
      expect(correctRes.scoreGained).toBe(1000);

      const wrongRes = ScoringEngine.calculateScore('MULTIPLE_CHOICE', 'A', 'C');
      expect(wrongRes.isCorrect).toBe(false);
      expect(wrongRes.scoreGained).toBe(0);
    });

    it('ESTIMATION: exact match gives 1000, within margin gives proportional score, outside gives 0', () => {
      // Exact match (100)
      const exactRes = ScoringEngine.calculateScore('ESTIMATION', 100, 100);
      expect(exactRes.isCorrect).toBe(true);
      expect(exactRes.scoreGained).toBe(1000);

      // Within margin (105 when correct is 100, margin is 10)
      const withinMarginRes = ScoringEngine.calculateScore('ESTIMATION', 105, 100);
      expect(withinMarginRes.isCorrect).toBe(true);
      expect(withinMarginRes.scoreGained).toBe(500); // 50% ratio

      // Outside margin (120 when correct is 100, margin is 10)
      const outsideMarginRes = ScoringEngine.calculateScore('ESTIMATION', 120, 100);
      expect(outsideMarginRes.isCorrect).toBe(false);
      expect(outsideMarginRes.scoreGained).toBe(0);
    });

    it('RANKING: exact order gives 1000 points, altered order gives 0', () => {
      const correct = ['Real Madrid', 'Barcelona', 'Bayern Munich', 'Arsenal'];

      const perfectRes = ScoringEngine.calculateScore('RANKING', ['Real Madrid', 'Barcelona', 'Bayern Munich', 'Arsenal'], correct);
      expect(perfectRes.isCorrect).toBe(true);
      expect(perfectRes.scoreGained).toBe(1000);

      const wrongRes = ScoringEngine.calculateScore('RANKING', ['Barcelona', 'Real Madrid', 'Bayern Munich', 'Arsenal'], correct);
      expect(wrongRes.isCorrect).toBe(false);
      expect(wrongRes.scoreGained).toBe(0);
    });

    it('PLAYER_GUESS: case-insensitive match gives 1000 points', () => {
      const matchRes = ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'Lionel Messi', 'lionel messi');
      expect(matchRes.isCorrect).toBe(true);
      expect(matchRes.scoreGained).toBe(1000);

      const wrongRes = ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'Cristiano Ronaldo', 'Lionel Messi');
      expect(wrongRes.isCorrect).toBe(false);
      expect(wrongRes.scoreGained).toBe(0);
    });

    it('HARD_QUESTION: correct gives 1500 points', () => {
      const matchRes = ScoringEngine.calculateScore(QuestionType.HARD_QUESTION, '1954', '1954');
      expect(matchRes.isCorrect).toBe(true);
      expect(matchRes.scoreGained).toBe(1500);
    });

    it('FINAL: correct gives 2000 points (double stakes)', () => {
      const matchRes = ScoringEngine.calculateScore(QuestionType.FINAL, 'B', 'B');
      expect(matchRes.isCorrect).toBe(true);
      expect(matchRes.scoreGained).toBe(2000);
    });
  });
});
