// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Shared from '@pesly/shared';
import { AddHoldingForm } from '../src/features/investments/components/add-holding-form';
import { CreatePortfolioForm } from '../src/features/investments/components/create-portfolio-form';
import { EditHoldingForm } from '../src/features/investments/components/edit-holding-form';
import { PriceForm } from '../src/features/investments/components/price-form';
import { HOLDING } from './support/holding-fixture';
import { CATALOGS, renderApp } from './support/render-app';

const { es } = CATALOGS;

/** Issues a shared schema is forced to report; empty means "behave as the real schema". */
interface ForcedIssues {
  issues: Partial<Record<string, { path: string[]; code: string }[]>>;
}
const forced = vi.hoisted((): ForcedIssues => ({ issues: {} }));

vi.mock('@pesly/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof Shared>();
  const delegating = (name: string, schema: { safeParse: (value: unknown) => unknown }) => ({
    safeParse: (value: unknown) => {
      const issues = forced.issues[name];
      return issues ? { success: false, error: { issues } } : schema.safeParse(value);
    },
  });
  return {
    ...actual,
    createPortfolioRequestSchema: delegating(
      'createPortfolio',
      actual.createPortfolioRequestSchema,
    ),
    setPriceRequestSchema: delegating('setPrice', actual.setPriceRequestSchema),
    addHoldingRequestSchema: delegating('addHolding', actual.addHoldingRequestSchema),
    updateHoldingRequestSchema: delegating('updateHolding', actual.updateHoldingRequestSchema),
  };
});

beforeEach(() => {
  forced.issues = {};
});

describe('the forms validate with the shared request schemas', () => {
  it('create portfolio shows what the schema reports for the name', async () => {
    forced.issues.createPortfolio = [{ path: ['name'], code: 'too_big' }];
    const onSubmit = vi.fn();
    renderApp(<CreatePortfolioForm pending={false} onSubmit={onSubmit} />);

    await userEvent
      .setup()
      .type(screen.getByLabelText(es.investments.forms.createPortfolio.name), 'Balanz');
    fireEvent.click(
      screen.getByRole('button', { name: es.investments.forms.createPortfolio.submit }),
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.nameTooLong)).toBeDefined();
  });

  it('create portfolio sends the name the schema returns', async () => {
    const onSubmit = vi.fn();
    renderApp(<CreatePortfolioForm pending={false} onSubmit={onSubmit} />);

    await userEvent
      .setup()
      .type(screen.getByLabelText(es.investments.forms.createPortfolio.name), '  Balanz  ');
    fireEvent.click(
      screen.getByRole('button', { name: es.investments.forms.createPortfolio.submit }),
    );

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: 'Balanz' });
  });

  it('price shows the range message when the schema rejects the price', async () => {
    forced.issues.setPrice = [{ path: ['unitPrice'], code: 'custom' }];
    const onSubmit = vi.fn();
    renderApp(<PriceForm language="es" pending={false} onSubmit={onSubmit} />);

    await userEvent.setup().type(screen.getByLabelText(es.investments.forms.price.unitPrice), '10');
    fireEvent.click(screen.getByRole('button', { name: es.investments.forms.price.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.amountInvalid)).toBeDefined();
  });
});

describe('a schema failure that cannot be placed on a field is never silent', () => {
  it('add holding shows the unexpected error above the form and focuses it', async () => {
    forced.issues.addHolding = [{ path: ['mystery'], code: 'custom' }];
    const onSubmit = vi.fn();
    renderApp(<AddHoldingForm language="es" pending={false} onSubmit={onSubmit} />);
    const t = es.investments.forms.addHolding;
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(t.ticker), 'AAPL');
    await user.type(screen.getByLabelText(t.instrumentName), 'Apple');
    await user.type(screen.getByLabelText(t.quantity), '1');
    await user.click(screen.getByRole('button', { name: t.submit }));

    const alert = screen.getByRole('alert');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(alert.textContent).toContain(es.investments.errors.unexpected);
    expect(document.activeElement).toBe(alert);
  });

  it('edit holding shows the unexpected error above the form and focuses it', async () => {
    forced.issues.updateHolding = [{ path: [], code: 'custom' }];
    const onSubmit = vi.fn();
    renderApp(
      <EditHoldingForm holding={HOLDING} language="es" pending={false} onSubmit={onSubmit} />,
    );
    const t = es.investments.forms.editHolding;
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText(t.quantity));
    await user.type(screen.getByLabelText(t.quantity), '15');
    await user.click(screen.getByRole('button', { name: t.submit }));

    const alert = screen.getByRole('alert');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(alert.textContent).toContain(es.investments.errors.unexpected);
    expect(document.activeElement).toBe(alert);
  });
});
