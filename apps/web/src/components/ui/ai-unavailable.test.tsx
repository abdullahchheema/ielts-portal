import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiUnavailable, AI_UNAVAILABLE_TEXT } from './ai';

/** When AI is off or failing, the page says the work was saved, so a student never thinks their essay was lost. */
describe('AiUnavailable', () => {
  it('tells the student their submission is saved', () => {
    render(<AiUnavailable />);
    expect(screen.getByText(AI_UNAVAILABLE_TEXT)).toBeTruthy();
    expect(AI_UNAVAILABLE_TEXT).toMatch(/Your submission has been saved/);
  });
});
