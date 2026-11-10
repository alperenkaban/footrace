import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('WalletService Unit Tests', () => {
  let service: WalletService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      $transaction: vi.fn(async (cb) => cb(prismaMock)),
      $queryRaw: vi.fn(async () => []),
      $queryRawUnsafe: vi.fn(async () => []),
      playerProfile: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      matchHold: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      coinTransaction: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      match: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      user: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
    };

    service = new WalletService(prismaMock as unknown as PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('holdEntryFee', () => {
    it('should return null when amount <= 0', async () => {
      const res = await service.holdEntryFee('user-1', 0);
      expect(res).toBeNull();
    });

    it('should throw BadRequestException if balance is insufficient', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce({
        balance: 50,
        heldBalance: 0,
      });

      await expect(service.holdEntryFee('user-1', 100)).rejects.toThrow(BadRequestException);
    });

    it('should hold fee and create MatchHold record when balance is sufficient', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce({
        balance: 200,
        heldBalance: 0,
      });
      prismaMock.matchHold.create.mockResolvedValueOnce({ id: 'hold-123' });

      const res = await service.holdEntryFee('user-1', 100);
      expect(res).toEqual({ holdId: 'hold-123' });
      expect(prismaMock.playerProfile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { balance: 100, heldBalance: 100 },
      });
    });

    it('should return existing holdId if matchId provided and hold already exists (idempotency)', async () => {
      prismaMock.matchHold.findFirst.mockResolvedValueOnce({
        id: 'hold-existing',
        status: 'HELD',
      });

      const res = await service.holdEntryFee('user-1', 100, { matchId: 'm-1' });
      expect(res).toEqual({ holdId: 'hold-existing' });
      expect(prismaMock.playerProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('releaseHold', () => {
    it('should do nothing if amount <= 0', async () => {
      await service.releaseHold('user-1', 0);
      expect(prismaMock.playerProfile.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if heldBalance < amount', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce({
        balance: 100,
        heldBalance: 50,
      });

      await expect(service.releaseHold('user-1', 100)).rejects.toThrow(BadRequestException);
    });

    it('should refund hold and restore balance if heldBalance is sufficient', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce({
        balance: 100,
        heldBalance: 100,
      });
      prismaMock.matchHold.findFirst.mockResolvedValueOnce({
        id: 'hold-to-release',
        status: 'HELD',
      });

      await service.releaseHold('user-1', 100);
      expect(prismaMock.matchHold.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'hold-to-release' },
          data: expect.objectContaining({ status: 'REFUNDED' }),
        }),
      );
      expect(prismaMock.playerProfile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { balance: 200, heldBalance: 0 },
      });
    });
  });

  describe('refundHoldRecord', () => {
    it('should return false if hold not found or status not HELD', async () => {
      prismaMock.matchHold.findUnique.mockResolvedValueOnce(null);
      const res = await service.refundHoldRecord('invalid-hold');
      expect(res).toBe(false);
    });

    it('should safely refund hold, restore balance and create ledger entry', async () => {
      prismaMock.matchHold.findUnique
        .mockResolvedValueOnce({ id: 'h1', userId: 'u1', amount: 100, status: 'HELD' })
        .mockResolvedValueOnce({ id: 'h1', userId: 'u1', amount: 100, status: 'HELD' });
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce({ balance: 400, heldBalance: 100 });
      prismaMock.playerProfile.update.mockResolvedValueOnce({ balance: 500, heldBalance: 0 });

      const res = await service.refundHoldRecord('h1');
      expect(res).toBe(true);
      expect(prismaMock.matchHold.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'h1' },
          data: expect.objectContaining({ status: 'REFUNDED' }),
        }),
      );
    });
  });

  describe('creditCoins', () => {
    it('should throw BadRequestException if amount <= 0', async () => {
      await expect(service.creditCoins('u1', 0, 'ref-1')).rejects.toThrow(BadRequestException);
    });

    it('should credit coins and write ledger transaction', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce({ balance: 100, heldBalance: 0 });
      prismaMock.playerProfile.update.mockResolvedValueOnce({ balance: 300, heldBalance: 0 });

      const res = await service.creditCoins('u1', 200, 'ref-shop');
      expect(res.balance).toBe(300);
      expect(prismaMock.coinTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            amount: 200,
            referenceId: 'ref-shop',
            type: 'SHOP_PURCHASE',
          }),
        }),
      );
    });
  });

  describe('spendCoins & debitCoins', () => {
    it('should throw BadRequestException if amount <= 0', async () => {
      await expect(service.spendCoins('u1', 0, 'ref-1')).rejects.toThrow(BadRequestException);
      await expect(service.debitCoins('u1', -10, 'ref-2')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user profile not found', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce(null);
      await expect(service.spendCoins('u1', 50, 'ref-spend-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if balance is insufficient', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce({ balance: 30, heldBalance: 0 });
      await expect(service.spendCoins('u1', 50, 'ref-spend-2')).rejects.toThrow('Bakiye yetersiz');
    });

    it('should deduct balance and create negative CoinTransaction', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce({ balance: 200, heldBalance: 0 });
      prismaMock.playerProfile.update.mockResolvedValueOnce({ balance: 150, heldBalance: 0 });

      const res = await service.spendCoins('u1', 50, 'item_hat_1', 'ITEM_PURCHASE');
      expect(res.balance).toBe(150);
      expect(prismaMock.playerProfile.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { balance: 150 },
      });
      expect(prismaMock.coinTransaction.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          amount: -50,
          type: 'ITEM_PURCHASE',
          referenceId: 'item_hat_1',
          balanceBefore: 200,
          balanceAfter: 150,
        },
      });
    });

    it('should skip double deduction if transaction already exists (idempotency)', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce({ balance: 200, heldBalance: 0 });
      prismaMock.coinTransaction.findUnique.mockResolvedValueOnce({ id: 'existing-tx' });

      const res = await service.spendCoins('u1', 50, 'item_hat_1', 'ITEM_PURCHASE');
      expect(res.balance).toBe(200);
      expect(prismaMock.playerProfile.update).not.toHaveBeenCalled();
      expect(prismaMock.coinTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    it('should throw BadRequestException if profile not found', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce(null);
      await expect(service.getBalance('u-missing')).rejects.toThrow(BadRequestException);
    });

    it('should return balance and heldBalance', async () => {
      prismaMock.playerProfile.findUnique.mockResolvedValueOnce({ balance: 350, heldBalance: 100 });
      const res = await service.getBalance('u1');
      expect(res).toEqual({ balance: 350, heldBalance: 100 });
    });
  });
});
