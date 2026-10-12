import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { WalletService } from './wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn(),
            playerProfile: {
              findUnique: vi.fn(),
              update: vi.fn(),
            },
            match: {
              findUnique: vi.fn(),
              update: vi.fn(),
            },
            coinTransaction: {
              create: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
