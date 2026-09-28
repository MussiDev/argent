// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { readField } from '../src/features/auth/read-field';

function formWith(html: string): HTMLFormElement {
  const form = document.createElement('form');
  form.innerHTML = html;
  document.body.append(form);
  return form;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('readField', () => {
  it('reads the text of a named input as typed', () => {
    const form = formWith('<input name="email" value="  ana@example.com ">');

    expect(readField(form, 'email')).toBe('  ana@example.com ');
  });

  it('reads a missing field as empty', () => {
    const form = formWith('<input name="email" value="ana@example.com">');

    expect(readField(form, 'password')).toBe('');
  });

  it('reads a file input as empty instead of a File', () => {
    const form = formWith('<input type="file" name="email">');

    expect(readField(form, 'email')).toBe('');
  });
});
