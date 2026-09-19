const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeContactDetails(value: string): string {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const emailLines = lines.filter((line) => EMAIL_PATTERN.test(line) || (/email/i.test(line) && /@/.test(line)));
  const nonEmailLines = lines.filter((line) => !emailLines.includes(line));
  return [...nonEmailLines, ...emailLines].join('\n');
}
