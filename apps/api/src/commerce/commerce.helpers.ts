import { Prisma } from '@ielts/db';

type Tx = Prisma.TransactionClient;

/** Releases a coupon reservation exactly once (idempotent) and gives the redemption back to the coupon. */
export async function releaseCouponForOrder(tx: Tx, orderId: string) {
  const reserved = await tx.couponRedemption.findMany({ where: { orderId, status: 'RESERVED' } });
  for (const r of reserved) {
    const claimed = await tx.couponRedemption.updateMany({ where: { id: r.id, status: 'RESERVED' }, data: { status: 'RELEASED' } });
    if (claimed.count === 1) {
      await tx.$executeRaw`UPDATE coupons SET redeemed_count = GREATEST(redeemed_count - 1, 0) WHERE id = ${r.couponId}::uuid`;
    }
  }
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid transcription mistakes
export function newOrderReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'IEL-' + Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

export const money = (d: Prisma.Decimal | number | string) => new Prisma.Decimal(d).toDecimalPlaces(2);
