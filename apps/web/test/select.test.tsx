// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select } from '../src/components/ui/select';

afterEach(cleanup);

describe('Select', () => {
  it('renders a native select with its options', () => {
    render(
      <Select aria-label="Type" defaultValue="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );

    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Type' });
    expect(select.tagName).toBe('SELECT');
    expect(select.options).toHaveLength(2);
    expect(select.value).toBe('b');
  });

  it('forwards value changes, required, disabled and aria props', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select aria-label="Type" aria-invalid="true" required defaultValue="a" onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );

    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Type' });
    expect(select.required).toBe(true);
    expect(select.getAttribute('aria-invalid')).toBe('true');

    await user.selectOptions(select, 'b');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(select.value).toBe('b');
  });

  it('forwards disabled', () => {
    render(
      <Select aria-label="Type" disabled>
        <option value="a">A</option>
      </Select>,
    );

    expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true);
  });
});
