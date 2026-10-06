/**
 * Speech metrics from a transcript and a duration. Pure. These are supporting indicators only:
 * they are not IELTS scoring criteria and each one says whether it is reliable for this answer length.
 */
import { wordsOf } from '../writing/text-stats';

export const FILLERS = ['um', 'uh', 'er', 'erm', 'like', 'hmm', 'mm'];
const MIN_WORDS_FOR_DIVERSITY = 50;

export interface Fluency {
  words: number;
  durationSec: number | null;
  wordsPerMinute: number | null;
  fillerCount: number;
  repeatedWords: number;
  /** Average words per answer across the answers given; the caller passes the list. */
  averageAnswerWords: number | null;
  vocabularyDiversity: { value: number | null; reliable: boolean };
  note: string;
}

export function fluencyOf(transcript: string, durationSec: number | null): Fluency {
  const words = wordsOf(transcript);
  const fillers = FILLERS.reduce((n, f) => n + words.filter((w) => w === f).length, 0);
  const repeats = words.reduce((n, w, i) => n + (i > 0 && words[i - 1] === w ? 1 : 0), 0);
  const wpm = durationSec && durationSec > 0 ? Math.round((words.length / (durationSec / 60)) * 10) / 10 : null;
  const diversityReliable = words.length >= MIN_WORDS_FOR_DIVERSITY;
  const diversity = words.length === 0 ? null : Math.round((new Set(words).size / words.length) * 100) / 100;
  return {
    words: words.length,
    durationSec,
    wordsPerMinute: wpm,
    fillerCount: fillers,
    repeatedWords: repeats,
    averageAnswerWords: words.length || null,
    vocabularyDiversity: { value: diversity, reliable: diversityReliable },
    note: 'Supporting indicators only. They are not IELTS scoring criteria.',
  };
}

/** Average across several answers, for the fluency profile on the dashboard. */
export function profileOf(items: Fluency[]) {
  const withTime = items.filter((i) => i.wordsPerMinute !== null);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return {
    answers: items.length,
    wordsPerMinute: avg(withTime.map((i) => i.wordsPerMinute as number)),
    fillersPerAnswer: avg(items.map((i) => i.fillerCount)),
    averageAnswerWords: avg(items.map((i) => i.words)),
    note: 'Supporting indicators only. They are not IELTS scoring criteria.',
  };
}
