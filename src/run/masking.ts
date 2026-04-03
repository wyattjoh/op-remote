function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createMasker(secrets: string[]): (input: string) => string {
  // Filter out empty strings to avoid a regex that matches every position.
  const filtered = secrets.filter((s) => s.length > 0);

  if (filtered.length === 0) {
    return (input) => input;
  }

  const pattern = new RegExp(filtered.map(escapeRegExp).join("|"), "g");

  return (input: string) => input.replace(pattern, "<redacted>");
}
