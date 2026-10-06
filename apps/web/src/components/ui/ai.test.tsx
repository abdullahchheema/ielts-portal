import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AIInsightCard, AI_DISCLAIMER, AI_ESTIMATE_LABEL } from './ai';

describe('AIInsightCard', () => {
  it('labels an estimate as AI, never as an official result', () => {
    render(<AIInsightCard title="Writing feedback" estimate={6.5}>Your coherence is improving.</AIInsightCard>);
    expect(screen.getByText(new RegExp(AI_ESTIMATE_LABEL))).toBeTruthy();
    expect(screen.getByText(AI_DISCLAIMER)).toBeTruthy();
    expect(screen.queryByText(/official band/i)).toBeNull();
  });

  it('omits the estimate line when there is no estimate', () => {
    render(<AIInsightCard title="Tutor">No estimate here.</AIInsightCard>);
    expect(screen.queryByText(new RegExp(AI_ESTIMATE_LABEL))).toBeNull();
  });
});
