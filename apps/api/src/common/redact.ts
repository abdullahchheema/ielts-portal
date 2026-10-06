/**
 * Log redaction. Pure. Any value under a key that names a credential, a session, a signature or a storage key is
 * replaced before it reaches a log line. Bearer tokens and API-key shapes are masked inside strings too.
 */
const SENSITIVE_KEY = /password|passwd|secret|token|authorization|cookie|signature|^sig$|api[_-]?key|storage[_-]?key|filekey|sha256|session/i;
const MASK = '[redacted]';

export function redactString(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, `Bearer ${MASK}`)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, MASK);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return MASK;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? MASK : redact(v, depth + 1);
    return out;
  }
  return value;
}
