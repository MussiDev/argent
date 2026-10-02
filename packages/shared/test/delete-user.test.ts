import { describe, expect, it } from 'vitest';
import {
  deleteUserRequestSchema,
  startDeletionReauthResponseSchema,
} from '../src/profile/delete-user';

describe('deleteUserRequestSchema', () => {
  it('accepts a password, a code, both, or neither, and trims the code (FR-02)', () => {
    expect(deleteUserRequestSchema.parse({ password: 'hunter2' })).toEqual({ password: 'hunter2' });
    expect(deleteUserRequestSchema.parse({ secondFactorCode: ' 123456 ' })).toEqual({
      secondFactorCode: '123456',
    });
    expect(deleteUserRequestSchema.parse({ secondFactorCode: 'ABCDE-FGH2J' })).toEqual({
      secondFactorCode: 'ABCDE-FGH2J',
    });
    expect(
      deleteUserRequestSchema.parse({ password: 'hunter2', secondFactorCode: '123456' }),
    ).toEqual({ password: 'hunter2', secondFactorCode: '123456' });
    expect(deleteUserRequestSchema.parse({})).toEqual({});
  });

  it('rejects a 129-character password and a malformed second-factor code (FR-02, sad path)', () => {
    expect(deleteUserRequestSchema.safeParse({ password: 'a'.repeat(129) }).success).toBe(false);
    expect(deleteUserRequestSchema.safeParse({ password: '' }).success).toBe(false);
    expect(deleteUserRequestSchema.safeParse({ password: 12345 }).success).toBe(false);
    expect(deleteUserRequestSchema.safeParse({ secondFactorCode: '12345' }).success).toBe(false);
    expect(deleteUserRequestSchema.safeParse({ secondFactorCode: 'not a code!' }).success).toBe(
      false,
    );
    expect(deleteUserRequestSchema.safeParse({ secondFactorCode: '1'.repeat(17) }).success).toBe(
      false,
    );
    expect(deleteUserRequestSchema.safeParse({ password: 'a'.repeat(128) }).success).toBe(true);
  });

  it('strips unknown keys (FR-02)', () => {
    expect(
      deleteUserRequestSchema.parse({ password: 'hunter2', userId: 'x', confirm: true }),
    ).toEqual({ password: 'hunter2' });
  });
});

describe('startDeletionReauthResponseSchema', () => {
  it('carries the authorization URL as a string (FR-03)', () => {
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=s';
    expect(startDeletionReauthResponseSchema.parse({ authorizationUrl: url })).toEqual({
      authorizationUrl: url,
    });
    expect(startDeletionReauthResponseSchema.safeParse({}).success).toBe(false);
    expect(startDeletionReauthResponseSchema.safeParse({ authorizationUrl: 3 }).success).toBe(
      false,
    );
  });
});
