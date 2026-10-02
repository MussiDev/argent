// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreatePortfolioForm } from '../src/features/investments/components/create-portfolio-form';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

function renderForm(props: Partial<Parameters<typeof CreatePortfolioForm>[0]> = {}) {
  const onSubmit = vi.fn();
  renderApp(<CreatePortfolioForm pending={false} onSubmit={onSubmit} {...props} />);
  return { onSubmit };
}

describe('CreatePortfolioForm', () => {
  it('submits the typed name (AC-01)', async () => {
    const { onSubmit } = renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(es.investments.forms.createPortfolio.name), ' Balanz ');
    await user.click(
      screen.getByRole('button', { name: es.investments.forms.createPortfolio.submit }),
    );

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: 'Balanz' });
  });

  it('shows the name-required error and sends nothing for an empty name', async () => {
    const { onSubmit } = renderForm();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: es.investments.forms.createPortfolio.submit }),
    );

    const input = screen.getByLabelText(es.investments.forms.createPortfolio.name);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.nameRequired)).toBeDefined();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
  });

  it('rejects a name over 60 characters', async () => {
    const { onSubmit } = renderForm();
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(es.investments.forms.createPortfolio.name),
      'a'.repeat(61),
    );
    await user.click(
      screen.getByRole('button', { name: es.investments.forms.createPortfolio.submit }),
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.nameTooLong)).toBeDefined();
  });

  it('disables submit while pending and shows the pending label', () => {
    renderForm({ pending: true });

    const button = screen.getByRole('button', {
      name: es.investments.forms.createPortfolio.pending,
    });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('shows the API form-level error', () => {
    renderForm({ errors: { form: 'network' } });

    expect(screen.getByRole('alert').textContent).toContain(es.investments.errors.network);
  });

  it('renders in English and calls onCancel', async () => {
    const onCancel = vi.fn();
    renderApp(<CreatePortfolioForm pending={false} onSubmit={vi.fn()} onCancel={onCancel} />, {
      locale: 'en',
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: en.investments.forms.cancel }));

    expect(screen.getByLabelText(en.investments.forms.createPortfolio.name)).toBeDefined();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('focuses the name again on every failed submit', async () => {
    renderForm();
    const user = userEvent.setup();
    const t = es.investments.forms.createPortfolio;
    const input = screen.getByLabelText(t.name);

    await user.click(screen.getByRole('button', { name: t.submit }));
    expect(document.activeElement).toBe(input);

    await user.click(screen.getByRole('button', { name: t.submit }));
    expect(document.activeElement).toBe(input);
  });

  it('does not call onSubmit when submitted while pending', () => {
    const { onSubmit } = renderForm({ pending: true });
    const input = screen.getByLabelText(es.investments.forms.createPortfolio.name);

    fireEvent.change(input, { target: { value: 'Balanz' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
