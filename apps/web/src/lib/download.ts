import { ApiError } from './api';

/**
 * Downloads a CSV from the API. Goes through the same-origin /api proxy so the session cookie is sent.
 * A refused export (403, or too large) surfaces as an ApiError with the server's message, never as a
 * JSON page saved to disk.
 */
export async function downloadCsv(path: string): Promise<void> {
  const res = await fetch(`/api${path}`, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) {
    let code = 'INTERNAL_ERROR';
    let message = 'The export could not be created.';
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch { /* not JSON: keep the generic message */ }
    throw new ApiError(code, message, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export.csv';
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
