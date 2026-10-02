import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import es from '../messages/es.json';
import { AddHoldingForm } from '../src/features/investments/components/add-holding-form';
import { CreatePortfolioForm } from '../src/features/investments/components/create-portfolio-form';
import { EditHoldingForm } from '../src/features/investments/components/edit-holding-form';
import { PriceForm } from '../src/features/investments/components/price-form';
import type { HoldingFormErrors } from '../src/features/investments/holding-form-errors';
import { HOLDING } from './support/holding-fixture';

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="es" timeZone="UTC" messages={es}>
      {element}
    </NextIntlClientProvider>,
  );
}

const noop = () => undefined;

const FORMS: [string, (errors: HoldingFormErrors) => ReactElement][] = [
  [
    'create portfolio',
    (errors) => <CreatePortfolioForm pending={false} errors={errors} onSubmit={noop} />,
  ],
  [
    'add holding',
    (errors) => <AddHoldingForm language="es" pending={false} errors={errors} onSubmit={noop} />,
  ],
  [
    'edit holding',
    (errors) => (
      <EditHoldingForm
        holding={HOLDING}
        language="es"
        pending={false}
        errors={errors}
        onSubmit={noop}
      />
    ),
  ],
  [
    'price',
    (errors) => <PriceForm language="es" pending={false} errors={errors} onSubmit={noop} />,
  ],
];

const INVALID: HoldingFormErrors = {
  form: 'network',
  fields: {
    name: 'nameRequired',
    ticker: 'tickerInvalid',
    instrumentName: 'instrumentNameRequired',
    quantity: 'notPositive',
    totalCost: 'costRequired',
    valuationCurrency: 'currencyMismatch',
    unitPrice: 'notPositive',
  },
};

function describedByIds(html: string): string[] {
  return [...html.matchAll(/aria-describedby="([^"]*)"/g)].flatMap(([, ids = '']) =>
    ids.split(' ').filter(Boolean),
  );
}

function controls(html: string): string[] {
  return [...html.matchAll(/<(?:input|select)\b[^>]*>/g)].map(([tag = '']) => tag);
}

describe('investment form accessibility', () => {
  it.each(FORMS)('the %s form turns off native browser validation (novalidate)', (_, form) => {
    expect(render(form({}))).toMatch(/<form[^>]* novalidate=""/i);
  });

  it.each(FORMS)('every control of the %s form has a label', (_, form) => {
    const html = render(form({}));

    for (const control of controls(html)) {
      const id = /\bid="([^"]*)"/.exec(control)?.[1];
      expect(id, `control without id: ${control}`).toBeTruthy();
      expect(html).toContain(`for="${id}"`);
    }
  });

  it.each(FORMS)('the %s form only points aria-describedby at ids that exist', (_, form) => {
    for (const errors of [{}, INVALID]) {
      const html = render(form(errors));
      for (const id of describedByIds(html)) {
        expect(html, `aria-describedby points at missing #${id}`).toContain(`id="${id}"`);
      }
    }
  });

  it.each(FORMS)('the %s form marks invalid fields and leaves valid ones alone', (_, form) => {
    expect(render(form({}))).not.toContain('aria-invalid="true"');
    expect(render(form(INVALID))).toContain('aria-invalid="true"');
  });

  it('describes an invalid ticker with its message', () => {
    const html = render(
      <AddHoldingForm
        language="es"
        pending={false}
        errors={{ fields: { ticker: 'tickerInvalid' } }}
        onSubmit={noop}
      />,
    );

    const input = /<input[^>]*name="ticker"[^>]*>/.exec(html)?.[0] ?? '';
    expect(input).toContain('aria-invalid="true"');
    const messages = describedByIds(input).map(
      (id) => new RegExp(`<p[^>]*id="${id}"[^>]*>([^<]*)</p>`).exec(html)?.[1],
    );
    expect(messages).toContain(es.investments.errors.tickerInvalid);
  });
});
