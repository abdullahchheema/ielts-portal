import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/config.module';

/** Fixed-window counter. Redis when REDIS_URL is set, otherwise in-process (single instance only). */
@Injectable()
export class RateLimiter implements OnModuleDestroy {
  private readonly redis?: Redis;
  private readonly memory = new Map<string, { count: number; resetAt: number }>();
  private readonly logger = new Logger(RateLimiter.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.REDIS_URL) {
      this.redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
      this.redis.on('error', (e) => this.logger.warn(`Redis error: ${e.message}`));
    } else {
      this.logger.warn('REDIS_URL not set — using in-memory rate limiting (dev only).');
    }
  }

  async hit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; count: number }> {
    if (this.redis) {
      try {
        const k = `rl:${key}`;
        const count = await this.redis.incr(k);
        if (count === 1) await this.redis.expire(k, windowSec);
        return { allowed: count <= limit, count };
      } catch { /* fall through to memory so a Redis outage doesn't lock everyone out */ }
    }
    const now = Date.now();
    const cur = this.memory.get(key);
    if (!cur || cur.resetAt <= now) {
      this.memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
      return { allowed: true, count: 1 };
    }
    cur.count += 1;
    return { allowed: cur.count <= limit, count: cur.count };
  }

  async reset(key: string) {
    this.memory.delete(key);
    try { await this.redis?.del(`rl:${key}`); } catch { /* ignore */ }
  }

  async onModuleDestroy() { await this.redis?.quit().catch(() => undefined); }
}
