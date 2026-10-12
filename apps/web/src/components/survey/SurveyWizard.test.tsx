import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { SurveyWizard } from './SurveyWizard';

vi.mock('@/lib/api', () => ({ api: vi.fn(), ApiError: class ApiError extends Error { code = ''; } }));
const apiMock = vi.mocked(api);

const EMPTY_DOC = { status: 'DRAFT', revision: 0, submittedAt: null };

describe('SurveyWizard', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/me/enrollment-survey') return EMPTY_DOC;
      return { ...EMPTY_DOC, revision: 1 };
    });
  });

  it('shows a progress indicator and blocks Next until the question is answered', async () => {
    render(<SurveyWizard onComplete={vi.fn()} />);
    await screen.findByText('Have you taken IELTS before?');
    expect(screen.getByText('Question 1 of 10')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('No, this is my first time'));
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('advances past the conditional prior-band slide when the student has never taken it, and Back preserves the first answer', async () => {
    render(<SurveyWizard onComplete={vi.fn()} />);
    await screen.findByText('Have you taken IELTS before?');
    fireEvent.click(screen.getByText('No, this is my first time'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.queryByText('Question 2 of 10')).toBeTruthy());
    expect(screen.getByText(/only applies if you have taken IELTS before/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByText('Question 1 of 10')).toBeTruthy());
    expect(screen.getByText('No, this is my first time').closest('button')?.getAttribute('aria-checked')).toBe('true');
  });

  it('resumes a previously submitted survey with a summary instead of the first question', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/me/enrollment-survey') return { status: 'SUBMITTED', revision: 3, submittedAt: '2026-01-01', takenBefore: 'NO' };
      return {};
    });
    render(<SurveyWizard onComplete={vi.fn()} />);
    await screen.findByText(/already completed this survey/);
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeTruthy();
  });
});
