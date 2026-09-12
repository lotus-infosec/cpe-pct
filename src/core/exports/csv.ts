// RFC 4180 CSV writer. CRLF line endings, BOM for spreadsheet friendliness, every field quoted when needed.
export function csv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export const hours = (minutes: number | null | undefined) =>
  minutes == null ? '' : (minutes / 60).toFixed(2).replace(/\.?0+$/, '');
export const credits = (x100: number) => (x100 / 100).toFixed(2).replace(/\.?0+$/, '');
export const safeName = (s: string) =>
  s
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'file';
