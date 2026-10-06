import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { FeedbackPrompt } from './FeedbackPrompt';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
const apiMock = vi.mocked(api);

const PENDING = [{
  id: 'req-1', title: 'After your mock exam', trigger: 'MOCK_EXAM',
  questions: [{ key: 'overall', label: 'How useful was the mock exam?' }, { key: 'technical', label: 'Did anything go wrong?' }],
}];

function renderPrompt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><FeedbackPrompt /></QueryClientProvider>);
}

describe('FeedbackPrompt', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string) => (path === '/me/feedback/pending' ? PENDING : {}));
  });

  it('shows nothing when no survey is open', async () => {
    apiMock.mockResolvedValue([]);
    const { container } = renderPrompt();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me/feedback/pending'));
    expect(container.textContent).toBe('');
  });

  it('asks for a score before anything can be sent, then sends it anonymously when chosen', async () => {
    renderPrompt();
    const send = await screen.findByRole('button', { name: 'Send feedback' });
    expect((send as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Score 9' }));
    expect((screen.getByRole('button', { name: 'Send feedback' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/How useful was the mock exam/), { target: { value: 'Very useful' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me/feedback/req-1/respond', expect.objectContaining({
      method: 'POST', body: { score: 9, anonymous: true, comments: { overall: 'Very useful' } },
    })));
  });

  it('can be dismissed without answering', async () => {
    renderPrompt();
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me/feedback/req-1/dismiss', expect.objectContaining({ method: 'POST' })));
  });
});
