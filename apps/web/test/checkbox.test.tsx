// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../src/components/ui/checkbox';

afterEach(cleanup);

describe('Checkbox', () => {
  it('renders a native checkbox in its checked and unchecked states', () => {
    render(
      <>
        <Checkbox aria-label="on" checked readOnly />
        <Checkbox aria-label="off" checked={false} readOnly />
      </>,
    );

    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'on' }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'off' }).checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'on' }).getAttribute('type')).toBe('checkbox');
  });

  it('forwards the change event, by click and by keyboard', async () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="setting" checked={false} onChange={onChange} />);
    const user = userEvent.setup();
    const box = screen.getByRole('checkbox', { name: 'setting' });

    await user.click(box);
    box.focus();
    await user.keyboard(' ');

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('is operable through an associated label', async () => {
    const onChange = vi.fn();
    render(
      <label>
        Include
        <Checkbox checked={false} onChange={onChange} />
      </label>,
    );

    await userEvent.setup().click(screen.getByText('Include'));

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('does not change while disabled (pending request, double submit)', async () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="setting" disabled checked={false} onChange={onChange} />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'setting' }));

    expect(screen.getByRole('checkbox', { name: 'setting' }).hasAttribute('disabled')).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards the ref and extra props, and merges the class name', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} aria-label="x" name="flag" className="extra" />);

    expect(ref.current).toBe(screen.getByRole('checkbox', { name: 'x' }));
    expect(ref.current?.getAttribute('name')).toBe('flag');
    expect(ref.current?.classList.contains('extra')).toBe(true);
  });

  it('styles only with theme tokens, no hardcoded colour', () => {
    render(<Checkbox aria-label="x" />);

    const classes = screen.getByRole('checkbox', { name: 'x' }).className;
    expect(classes).toMatch(/border-input/);
    expect(classes).not.toMatch(
      /#[0-9a-f]{3,8}|\[(?:rgb|hsl|oklch)|-(?:red|blue|gray|slate|zinc)-/i,
    );
  });
});
