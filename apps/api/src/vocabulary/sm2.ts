/**
 * Spaced review for vocabulary, a light version of SM-2. Pure: `now` is passed in.
 */

export interface Card { ease: number; intervalDays: number; reviewCount: number; correctCount: number }
export type CardStatus = 'SAVED' | 'REVIEW' | 'NEED_PRACTICE' | 'MASTERED';

export interface Next { ease: number; intervalDays: number; nextReviewAt: Date; status: CardStatus }

const DAY = 86_400_000;
const MIN_EASE = 1.3;

/** One review. A miss brings the card back tomorrow and lowers its ease; a hit lengthens the gap. */
export function reviewCard(card: Card, correct: boolean, now: Date): Next {
  let ease = card.ease;
  let interval: number;
  if (!correct) {
    ease = Math.max(MIN_EASE, ease - 0.2);
    interval = 1;
  } else {
    interval = card.reviewCount === 0 ? 1 : card.reviewCount === 1 ? 3 : Math.max(1, Math.round(card.intervalDays * ease));
    ease = Math.round((ease + 0.1) * 100) / 100;
  }
  const streakRight = correct && card.correctCount + 1 >= 3;
  const status: CardStatus = !correct ? 'NEED_PRACTICE' : interval >= 21 && streakRight ? 'MASTERED' : 'REVIEW';
  return { ease, intervalDays: interval, nextReviewAt: new Date(now.getTime() + interval * DAY), status };
}

/** The share of reviews answered correctly, 0–1. Null before any review. */
export function correctRate(reviewCount: number, correctCount: number): number | null {
  return reviewCount === 0 ? null : Math.round((correctCount / reviewCount) * 100) / 100;
}
