/** One-time recovery codes for a lost authenticator (FR-03). */
export interface RecoveryCodeGenerator {
  /** `count` distinct random codes in their display form (see `domain/recovery-code`). */
  generate(count: number): string[];
}
