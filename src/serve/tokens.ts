import { randomUUID } from "node:crypto";

interface TokenEntry {
  expiry: number;
  reserved: boolean;
}

export class TokenStore {
  private tokens = new Map<string, TokenEntry>();

  constructor(private readonly ttlMs: number) {}

  /** Fetch a live entry, evicting expired ones. Returns undefined if missing or expired. */
  private live(token: string): TokenEntry | undefined {
    const entry = this.tokens.get(token);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.tokens.delete(token);
      return undefined;
    }
    return entry;
  }

  create(): string {
    const token = randomUUID();
    this.tokens.set(token, { expiry: Date.now() + this.ttlMs, reserved: false });
    return token;
  }

  validate(token: string): boolean {
    return this.live(token) !== undefined;
  }

  /**
   * Atomically validate and reserve a token. Returns true if the token was
   * valid and not already reserved. A reserved token cannot be reserved again,
   * preventing concurrent use of the same token.
   */
  reserve(token: string): boolean {
    const entry = this.live(token);
    if (!entry || entry.reserved) return false;
    entry.reserved = true;
    return true;
  }

  /** Release a previously reserved token so it can be reserved again. */
  release(token: string): void {
    const entry = this.tokens.get(token);
    if (entry) entry.reserved = false;
  }

  consume(token: string): boolean {
    if (!this.live(token)) return false;
    this.tokens.delete(token);
    return true;
  }
}
