import { describe, it, expect, vi } from 'vitest';
import { QuestionSelector } from './question-selector.js';

describe('QuestionSelector', () => {
  it('shuffle: should preserve all elements and length', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = QuestionSelector.shuffle(input);

    expect(shuffled).toHaveLength(input.length);
    expect(shuffled.sort((a, b) => a - b)).toEqual(input);
  });

  it('selectRandomUniqueQuestions: should return requested count of unique questions', async () => {
    // Mock prisma
    const mockCandidates = [
      { id: 'q1', type: 'MULTIPLE_CHOICE' },
      { id: 'q2', type: 'MULTIPLE_CHOICE' },
      { id: 'q3', type: 'ESTIMATION' },
      { id: 'q4', type: 'RANKING' },
      { id: 'q5', type: 'MULTIPLE_CHOICE' },
    ];

    const mockFullQuestions = mockCandidates.map((c, i) => ({
      id: c.id,
      code: `code_${c.id}`,
      type: c.type,
      versions: [
        {
          text: `Soru ${i + 1}`,
          metadata: { options: ['A', 'B'] },
          correctAnswer: 'A',
          isActive: true,
          versionNumber: 1,
        },
      ],
    }));

    const mockPrisma = {
      question: {
        findMany: vi.fn().mockImplementation((args: any) => {
          if (args.select) {
            return Promise.resolve(mockCandidates);
          }
          if (args.where?.id?.in) {
            const ids: string[] = args.where.id.in;
            return Promise.resolve(mockFullQuestions.filter((q) => ids.includes(q.id)));
          }
          return Promise.resolve([]);
        }),
      },
    } as any;

    const result = await QuestionSelector.selectRandomUniqueQuestions(mockPrisma, 3, 10000);

    expect(result).toHaveLength(3);
    // Maç içi benzersizlik (tekrarsızlık) kontrolü:
    const ids = result.map((q) => q.questionId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
  });

  it('selectRandomUniqueQuestions: should not duplicate when requested count exceeds available pool', async () => {
    const mockCandidates = [
      { id: 'q1', type: 'MULTIPLE_CHOICE' },
      { id: 'q2', type: 'ESTIMATION' },
    ];

    const mockFullQuestions = mockCandidates.map((c, i) => ({
      id: c.id,
      code: `code_${c.id}`,
      type: c.type,
      versions: [
        {
          text: `Soru ${i + 1}`,
          metadata: {},
          correctAnswer: 'A',
          isActive: true,
          versionNumber: 1,
        },
      ],
    }));

    const mockPrisma = {
      question: {
        findMany: vi.fn().mockImplementation((args: any) => {
          if (args.select) return Promise.resolve(mockCandidates);
          if (args.where?.id?.in) {
            const ids: string[] = args.where.id.in;
            return Promise.resolve(mockFullQuestions.filter((q) => ids.includes(q.id)));
          }
          return Promise.resolve([]);
        }),
      },
    } as any;

    // 5 soru istendi ama havuzda sadece 2 soru var
    const result = await QuestionSelector.selectRandomUniqueQuestions(mockPrisma, 5, 10000);

    // Asla sessizce çoğaltılmamalı, mevcut benzersiz 2 soru dönmeli
    expect(result).toHaveLength(2);
    const ids = result.map((q) => q.questionId);
    expect(new Set(ids).size).toBe(2);
  });

  it('selectRandomUniqueQuestions: should throw error when no active questions exist', async () => {
    const mockPrisma = {
      question: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as any;

    await expect(QuestionSelector.selectRandomUniqueQuestions(mockPrisma, 3)).rejects.toThrow(
      'NO_QUESTIONS_AVAILABLE',
    );
  });
});
