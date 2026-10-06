import { describe, expect, it } from 'vitest';
import { redact, redactString } from '../src/common/redact';

/** Log redaction. Pure. Credentials, signatures and storage keys never reach a log line. */
describe('redaction', () => {
  it('masks values under credential, session, signature and storage keys', () => {
    const out = redact({ email: 'a@b.test', password: 'hunter2', accessToken: 'x', fileKey: 'proofs/1.png', sig: 'abc', nested: { apiKey: 'k' } }) as Record<string, unknown>;
    expect(out.email).toBe('a@b.test');
    expect(out.password).toBe('[redacted]');
    expect(out.accessToken).toBe('[redacted]');
    expect(out.fileKey).toBe('[redacted]');
    expect(out.sig).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).apiKey).toBe('[redacted]');
  });
  it('masks bearer tokens and key-shaped strings inside text', () => {
    expect(redactString('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer [redacted]');
    expect(redactString('key sk-proj-abcdefghijklmnop used')).toBe('key [redacted] used');
  });
  it('keeps errors readable without their stack of secrets', () => {
    const e = redact(new Error('failed for Bearer xyz')) as { message: string; name: string };
    expect(e.name).toBe('Error');
    expect(e.message).toBe('failed for Bearer [redacted]');
  });
  it('handles cycles-free deep objects without throwing', () => {
    let o: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 10; i++) o = { next: o };
    expect(() => redact(o)).not.toThrow();
  });
});
