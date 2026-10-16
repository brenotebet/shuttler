// __tests__/utils.csv.test.ts
// CSV cell escaping for admin exports (also mirrored in backend/samlServer.ts).

import { csvCell, csvRow } from '../src/utils/csv';

describe('csvCell', () => {
  it('passes plain values through unchanged', () => {
    expect(csvCell('Library Stop')).toBe('Library Stop');
    expect(csvCell(42)).toBe('42');
    expect(csvCell('2026-10-16T12:00:00.000Z')).toBe('2026-10-16T12:00:00.000Z');
  });

  it('renders null and undefined as empty cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes cells containing commas, quotes or newlines', () => {
    expect(csvCell('Main St, North Gate')).toBe('"Main St, North Gate"');
    expect(csvCell('The "Quad"')).toBe('"The ""Quad"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralizes formula-leading text (CSV injection)', () => {
    expect(csvCell('=HYPERLINK("http://evil.example","click")')).toBe(
      '"\'=HYPERLINK(""http://evil.example"",""click"")"',
    );
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
  });

  it('leaves negative numbers alone — only text is neutralized', () => {
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('csvRow', () => {
  it('joins escaped cells with commas', () => {
    expect(csvRow(['abc', 'Main St, North', 3, null])).toBe('abc,"Main St, North",3,');
  });
});
