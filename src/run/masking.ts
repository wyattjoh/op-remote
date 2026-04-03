function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createMasker(secrets: string[]): (input: string) => string {
  if (secrets.length === 0) {
    return (input) => input;
  }

  const pattern = new RegExp(secrets.map(escapeRegExp).join("|"), "g");

  return (input: string) => input.replace(pattern, "<redacted>");
}
