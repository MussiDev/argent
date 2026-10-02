// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PriceForm } from '../src/features/investments/components/price-form';
import { CATALOGS, renderApp, type TestLocale } from './support/render-app';

const { es, en } = CATALOGS;

function renderForm(
  locale: TestLocale = 'es',
  props: Partial<Parameters<typeof PriceForm>[0]> = {},
) {
  const onSubmit = vi.fn();
  renderApp(<PriceForm language={locale} pending={false} onSubmit={onSubmit} {...props} />, {
    locale,
  });
  return { onSubmit };
}

describe('PriceForm', () => {
  it('sends 1850000 minor units for 18500.00 in English (AC-07)', async () => {
    const { onSubmit } = renderForm('en');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(en.investments.forms.price.unitPrice), '18500.00');
    await user.click(screen.getByRole('button', { name: en.investments.forms.price.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ unitPrice: '1850000' });
  });

  it('reads the Spanish decimal comma (AC-07)', async () => {
    const { onSubmit } = renderForm('es');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(es.investments.forms.price.unitPrice), '18500,00');
    await user.click(screen.getByRole('button', { name: es.investments.forms.price.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ unitPrice: '1850000' });
  });

  it('shows a field error and sends nothing for a price of 0 (AC-08)', async () => {
    const { onSubmit } = renderForm('es');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(es.investments.forms.price.unitPrice), '0');
    await user.click(screen.getByRole('button', { name: es.investments.forms.price.submit }));

    const input = screen.getByLabelText(es.investments.forms.price.unitPrice);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.notPositive)).toBeDefined();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
  });

  it('shows the ambiguity message for 1.000 in Spanish', async () => {
    const { onSubmit } = renderForm('es');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(es.investments.forms.price.unitPrice), '1.000');
    await user.click(screen.getByRole('button', { name: es.investments.forms.price.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.ambiguousSeparator)).toBeDefined();
  });

  it('shows an empty-field error', async () => {
    const { onSubmit } = renderForm('es');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: es.investments.forms.price.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.empty)).toBeDefined();
  });

  it('rejects a price above the allowed maximum without sending it', async () => {
    const { onSubmit } = renderForm('en');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(en.investments.forms.price.unitPrice), '99999999999999');
    await user.click(screen.getByRole('button', { name: en.investments.forms.price.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(en.investments.errors.amountInvalid)).toBeDefined();
  });

  it('keeps submit disabled while pending', () => {
    renderForm('es', { pending: true });

    expect(
      screen
        .getByRole('button', { name: es.investments.forms.price.pending })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('shows API field errors next to the field', () => {
    renderForm('es', { errors: { fields: { unitPrice: 'amountInvalid' } } });

    const input = screen.getByLabelText(es.investments.forms.price.unitPrice);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(es.investments.errors.amountInvalid)).toBeDefined();
  });

  it('focuses the field with an API error and, after a valid resubmit, does not pull focus back', async () => {
    const { onSubmit } = renderForm('es', { errors: { fields: { unitPrice: 'amountInvalid' } } });
    const user = userEvent.setup();
    const t = es.investments.forms.price;
    const input = screen.getByLabelText(t.unitPrice);
    expect(document.activeElement).toBe(input);

    await user.type(input, '10');
    const submit = screen.getByRole('button', { name: t.submit });
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ unitPrice: '1000' });
    expect(document.activeElement).toBe(submit);
  });

  it('focuses the field again on every failed submit', async () => {
    renderForm('es');
    const user = userEvent.setup();
    const t = es.investments.forms.price;
    const input = screen.getByLabelText(t.unitPrice);

    await user.click(screen.getByRole('button', { name: t.submit }));
    expect(document.activeElement).toBe(input);
    await user.click(screen.getByRole('button', { name: t.submit }));
    expect(document.activeElement).toBe(input);
  });

  it('does not call onSubmit when submitted while pending', () => {
    const { onSubmit } = renderForm('es', { pending: true });
    const input = screen.getByLabelText(es.investments.forms.price.unitPrice);

    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
