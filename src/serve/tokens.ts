import { randomUUID } from "node:crypto";

export class TokenStore {
  private tokens = new Map<string, number>();
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  create(): string {
    const token = randomUUID();
    this.tokens.set(token, Date.now() + this.ttlMs);
    return token;
  }

  validate(token: string): boolean {
    const expiry = this.tokens.get(token);
    if (expiry === undefined) {
      return false;
    }
    if (Date.now() > expiry) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  consume(token: string): boolean {
    if (!this.validate(token)) {
      return false;
    }
    this.tokens.delete(token);
    return true;
  }
}
