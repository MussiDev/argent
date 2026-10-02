'use client';

import type {
  AddHoldingRequest,
  CreatePortfolioRequest,
  HoldingResponse,
  PortfolioResponse,
  SetPriceRequest,
  UpdateHoldingRequest,
} from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Locale } from '@/i18n/routing';
import { formatQuantity } from '@/lib/format-amount';
import type { HoldingFormErrors, InvestmentErrorKey } from '../holding-form-errors';
import { AddHoldingForm } from './add-holding-form';
import { CreatePortfolioForm } from './create-portfolio-form';
import { EditHoldingForm } from './edit-holding-form';
import { PortfolioCard } from './portfolio-card';
import { PriceForm } from './price-form';

/** The one form or confirmation that is open; opening another closes the previous one. */
export type OpenForm =
  | { kind: 'create' }
  | { kind: 'add'; portfolioId: string }
  | { kind: 'edit'; holdingId: string }
  | { kind: 'price'; holdingId: string }
  | { kind: 'delete-portfolio'; portfolioId: string };

export type InvestmentsNotice =
  { kind: 'merged'; ticker: string; quantity: string } | { kind: 'deleted' };

/** A message above one portfolio. The object is created once per failure, so focus moves once. */
export interface PortfolioMessage {
  key: InvestmentErrorKey;
}

export interface InvestmentsScreenProps {
  state: 'loading' | 'failed' | 'loaded';
  portfolios: PortfolioResponse[];
  /** Why the last load failed; with `loaded` the list shown is the previous one. */
  loadError?: InvestmentErrorKey;
  language: Locale;
  timeZone: string;
  pending: boolean;
  openForm: OpenForm | null;
  /** Remounts the create form after each successful creation, so it starts empty. */
  createRevision: number;
  notice: InvestmentsNotice | null;
  messages: Record<string, PortfolioMessage | undefined>;
  formErrors: HoldingFormErrors | undefined;
  onRetry: () => void;
  onOpenForm: (form: OpenForm) => void;
  onCloseForm: () => void;
  onCreatePortfolio: (values: CreatePortfolioRequest) => void;
  onAddHolding: (portfolioId: string, values: AddHoldingRequest) => void;
  onEditHolding: (holdingId: string, values: UpdateHoldingRequest) => void;
  onSetPrice: (holdingId: string, values: SetPriceRequest) => void;
  onDeleteHolding: (holdingId: string) => void;
  onDeletePortfolio: (portfolioId: string) => void;
}

/** Moves focus to what just appeared, so a screen reader announces it. */
function useFocusOnMount<T extends HTMLElement>(dependency: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [dependency]);
  return ref;
}

function MessageAlert({ message }: { message: PortfolioMessage }) {
  const t = useTranslations('investments.errors');
  const ref = useFocusOnMount<HTMLDivElement>(message);
  return (
    <Alert ref={ref} variant="destructive" tabIndex={-1}>
      <CircleAlert aria-hidden />
      <AlertDescription>{t(message.key)}</AlertDescription>
    </Alert>
  );
}

function Panel({
  title,
  level,
  children,
}: {
  title: string;
  level: 'h2' | 'h3';
  children: ReactNode;
}) {
  const ref = useFocusOnMount<HTMLHeadingElement>(null);
  const Heading = level;
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground">
      <Heading ref={ref} tabIndex={-1} className="text-base font-semibold">
        {title}
      </Heading>
      {children}
    </div>
  );
}

function findHolding(portfolio: PortfolioResponse, holdingId: string): HoldingResponse | undefined {
  return portfolio.holdings.find((holding) => holding.id === holdingId);
}

/** The layout of the investments page; every state arrives through props. */
export function InvestmentsScreen(props: InvestmentsScreenProps) {
  const {
    state,
    portfolios,
    loadError,
    language,
    timeZone,
    pending,
    openForm,
    createRevision,
    notice,
    messages,
    formErrors,
  } = props;
  const t = useTranslations('investments');
  const tApp = useTranslations('app');
  const tErrors = useTranslations('investments.errors');
  const rootRef = useRef<HTMLDivElement>(null);
  const opener = useRef<{ element: HTMLElement; label: string | null } | null>(null);
  const previousForm = useRef(openForm);

  /** Opens a form and remembers the control that opened it, to give focus back on close. */
  function openPanel(form: OpenForm) {
    const active = document.activeElement;
    opener.current =
      active instanceof HTMLElement && active !== document.body
        ? { element: active, label: active.getAttribute('aria-label') ?? active.textContent }
        : null;
    props.onOpenForm(form);
  }

  // When a panel closes, focus goes back to its opener (the button is re-created when it was
  // hidden while the panel was open, so it is found again by its label), else to the page heading.
  useEffect(() => {
    const wasOpen = previousForm.current !== null;
    previousForm.current = openForm;
    const root = rootRef.current;
    if (!wasOpen || openForm !== null || !root) return;
    const remembered = opener.current;
    opener.current = null;
    const target =
      remembered && remembered.element.isConnected
        ? remembered.element
        : (Array.from(root.querySelectorAll('button')).find(
            (button) =>
              remembered?.label != null &&
              (button.getAttribute('aria-label') ?? button.textContent) === remembered.label,
          ) ??
          root.closest('main')?.querySelector('h1') ??
          root);
    if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus();
  }, [openForm]);

  if (state === 'loading') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {tApp('loading')}
      </p>
    );
  }

  const retry = (
    <Button type="button" variant="outline" onClick={props.onRetry}>
      {tApp('retry')}
    </Button>
  );

  if (state === 'failed') {
    return (
      <div className="grid gap-4">
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{tErrors(loadError ?? 'unexpected')}</AlertDescription>
        </Alert>
        {retry}
      </div>
    );
  }

  const createForm = (
    <CreatePortfolioForm
      key={createRevision}
      pending={pending}
      errors={openForm?.kind === 'create' || portfolios.length === 0 ? formErrors : undefined}
      onSubmit={props.onCreatePortfolio}
      onCancel={portfolios.length === 0 ? undefined : props.onCloseForm}
    />
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      {loadError && (
        <div className="grid gap-4">
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{tErrors(loadError)}</AlertDescription>
          </Alert>
          {retry}
        </div>
      )}
      <p role="status" className="text-sm text-muted-foreground empty:sr-only">
        {notice?.kind === 'merged'
          ? t('notices.merged', {
              ticker: notice.ticker,
              quantity: formatQuantity(BigInt(notice.quantity), language),
            })
          : notice?.kind === 'deleted'
            ? t('notices.deleted')
            : null}
      </p>
      {portfolios.length === 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('empty.description')}</p>
          {createForm}
        </section>
      ) : (
        <>
          {openForm?.kind === 'create' ? (
            <Panel title={t('forms.createPortfolio.title')} level="h2">
              {createForm}
            </Panel>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => {
                openPanel({ kind: 'create' });
              }}
            >
              {t('forms.createPortfolio.title')}
            </Button>
          )}
          {portfolios.map((portfolio) => {
            const message = messages[portfolio.id];
            // The form's own submit button has the same name, so the opener steps aside.
            const adding = openForm?.kind === 'add' && openForm.portfolioId === portfolio.id;
            const editing =
              openForm?.kind === 'edit' ? findHolding(portfolio, openForm.holdingId) : undefined;
            const pricing =
              openForm?.kind === 'price' ? findHolding(portfolio, openForm.holdingId) : undefined;
            return (
              <section key={portfolio.id} className="flex flex-col gap-3">
                {message && <MessageAlert message={message} />}
                <PortfolioCard
                  portfolio={portfolio}
                  language={language}
                  timeZone={timeZone}
                  onAddHolding={
                    adding
                      ? undefined
                      : (portfolioId) => {
                          openPanel({ kind: 'add', portfolioId });
                        }
                  }
                  onDeletePortfolio={(portfolioId) => {
                    openPanel({ kind: 'delete-portfolio', portfolioId });
                  }}
                  onEditHolding={(holdingId) => {
                    openPanel({ kind: 'edit', holdingId });
                  }}
                  onSetPrice={(holdingId) => {
                    openPanel({ kind: 'price', holdingId });
                  }}
                  onDeleteHolding={props.onDeleteHolding}
                />
                {adding && (
                  <Panel title={t('forms.addHolding.title')} level="h3">
                    <AddHoldingForm
                      language={language}
                      pending={pending}
                      errors={formErrors}
                      onSubmit={(values) => {
                        props.onAddHolding(portfolio.id, values);
                      }}
                      onCancel={props.onCloseForm}
                    />
                  </Panel>
                )}
                {editing && (
                  <Panel title={t('forms.editHolding.title')} level="h3">
                    <EditHoldingForm
                      key={editing.id}
                      holding={editing}
                      language={language}
                      pending={pending}
                      errors={formErrors}
                      onSubmit={(values) => {
                        props.onEditHolding(editing.id, values);
                      }}
                      onCancel={props.onCloseForm}
                    />
                  </Panel>
                )}
                {pricing && (
                  <Panel title={t('forms.price.title')} level="h3">
                    <PriceForm
                      key={pricing.id}
                      language={language}
                      pending={pending}
                      errors={formErrors}
                      onSubmit={(values) => {
                        props.onSetPrice(pricing.id, values);
                      }}
                      onCancel={props.onCloseForm}
                    />
                  </Panel>
                )}
                {openForm?.kind === 'delete-portfolio' && openForm.portfolioId === portfolio.id && (
                  <Panel title={t('portfolio.delete')} level="h3">
                    <p className="text-sm">{t('forms.confirmDelete.portfolio')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="default"
                        disabled={pending}
                        onClick={() => {
                          props.onDeletePortfolio(portfolio.id);
                        }}
                      >
                        {t('forms.confirmDelete.confirm')}
                      </Button>
                      <Button type="button" variant="outline" onClick={props.onCloseForm}>
                        {t('forms.cancel')}
                      </Button>
                    </div>
                  </Panel>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
