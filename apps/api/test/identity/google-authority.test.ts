import { describe, expect, it } from 'vitest';
import { isGoogleAuthoritative } from '../../src/identity/domain/google-authority';

describe('isGoogleAuthoritative (FR-07)', () => {
  it('is true for a gmail.com address without a hosted domain', () => {
    expect(isGoogleAuthoritative('ana@gmail.com', null)).toBe(true);
  });

  it('is true for any email carrying a hosted domain (Google Workspace)', () => {
    expect(isGoogleAuthoritative('ana@empresa.com.ar', 'empresa.com.ar')).toBe(true);
    expect(isGoogleAuthoritative('ana@other.example', 'workspace.example')).toBe(true);
  });

  it('is false for another domain without a hosted domain', () => {
    expect(isGoogleAuthoritative('ana@outlook.com', null)).toBe(false);
  });

  it('does not accept look-alikes of gmail.com', () => {
    expect(isGoogleAuthoritative('ana@notgmail.com', null)).toBe(false);
    expect(isGoogleAuthoritative('ana@gmail.com.ar', null)).toBe(false);
    expect(isGoogleAuthoritative('ana@mail.gmail.com', null)).toBe(false);
    expect(isGoogleAuthoritative('gmail.com@evil.example', null)).toBe(false);
  });

  it('compares the domain case-insensitively', () => {
    expect(isGoogleAuthoritative('Ana@GMail.COM', null)).toBe(true);
  });

  it('treats an empty hosted domain as absent', () => {
    expect(isGoogleAuthoritative('ana@outlook.com', '')).toBe(false);
  });
});
