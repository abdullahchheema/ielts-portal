import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@ielts/db';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Prisma's interactive-transaction defaults (5s timeout, 2s maxWait to acquire a connection)
    // assume the app and database are in the same region. This deployment talks to Supabase's
    // pooler across regions (Vercel's function region vs. the pooler's), so every round trip inside
    // a transaction costs real network latency — several multi-step transactions (grading a finished
    // attempt, bulk question-bank operations) were hitting the default timeout in production and
    // surfacing as "Transaction not found... already closed" instead of completing. Raised globally
    // rather than patched per call site, since any transaction with more than a couple of round
    // trips is exposed to the same risk.
    super({ transactionOptions: { timeout: 20_000, maxWait: 10_000 } });
  }

  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
