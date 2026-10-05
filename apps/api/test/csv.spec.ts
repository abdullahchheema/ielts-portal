import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/analytics/csv';

describe('csvCell', () => {
  it('quotes values containing commas, quotes or newlines, and doubles embedded quotes', () => {
    expect(csvCell('Khan, Ahmed')).toBe('"Khan, Ahmed"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('blocks spreadsheet formula injection by prefixing an apostrophe', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toMatch(/^"?'=/);
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('renders null and undefined as empty, and dates as ISO strings', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(new Date('2026-10-05T00:00:00Z'))).toBe('2026-10-05T00:00:00.000Z');
  });

  it('leaves ordinary values alone', () => {
    expect(csvCell('Ahmed Khan')).toBe('Ahmed Khan');
    expect(csvCell(6.5)).toBe('6.5');
  });
});

describe('toCsv', () => {
  it('starts with a UTF-8 byte-order mark so Excel reads non-ASCII names', () => {
    expect(toCsv([{ name: 'Zubair' }], ['name']).charCodeAt(0)).toBe(0xfeff);
  });

  it('writes the header then one line per row, in the requested column order', () => {
    const out = toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y,z' }], ['b', 'a']);
    expect(out.replace('\uFEFF', '').split('\r\n').filter(Boolean)).toEqual(['b,a', 'x,1', '"y,z",2']);
  });
});
