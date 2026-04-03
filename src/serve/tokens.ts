import { randomUUID } from "node:crypto";

export class TokenStore {
  private tokens = new Map<string, { expiry: number; reserved: boolean }>();
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  create(): string {
    const token = randomUUID();
    this.tokens.set(token, { expiry: Date.now() + this.ttlMs, reserved: false });
    return token;
  }

  validate(token: string): boolean {
    const entry = this.tokens.get(token);
    if (!entry) {
      return false;
    }
    if (Date.now() > entry.expiry) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  /**
   * Atomically validate and reserve a token. Returns true if the token was
   * valid and not already reserved. A reserved token cannot be reserved again,
   * preventing concurrent use of the same token.
   */
  reserve(token: string): boolean {
    const entry = this.tokens.get(token);
    if (!entry) {
      return false;
    }
    if (Date.now() > entry.expiry) {
      this.tokens.delete(token);
      return false;
    }
    if (entry.reserved) {
      return false;
    }
    entry.reserved = true;
    return true;
  }

  /** Release a previously reserved token so it can be reserved again. */
  release(token: string): void {
    const entry = this.tokens.get(token);
    if (entry) {
      entry.reserved = false;
    }
  }

  consume(token: string): boolean {
    if (!this.validate(token)) {
      return false;
    }
    this.tokens.delete(token);
    return true;
  }
}
