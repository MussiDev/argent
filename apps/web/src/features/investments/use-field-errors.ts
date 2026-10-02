'use client';

import { useCallback, useMemo, useState } from 'react';
import type { HoldingFormErrors, InvestmentErrorKey } from './holding-form-errors';

type Fields = NonNullable<HoldingFormErrors['fields']>;

interface LocalErrors {
  fields: Fields;
  form: InvestmentErrorKey | undefined;
  /** Counts failed submits, so an identical failure is still told apart from the previous one. */
  attempt: number;
}

/** When a form should move focus: for new API errors and for each failed local submit. */
export interface FocusRequest {
  api: Fields | undefined;
  attempt: number;
  formError: boolean;
}

/**
 * Errors of a form: the ones the container got from the API, overlaid field by field by the ones
 * found while validating the typed text. `setLocal(fields, form)` replaces the local ones; calling
 * it with nothing (a valid submit) clears them without asking for focus, so an API error that is
 * still on screen does not pull focus back to its field.
 */
export function useFieldErrors(errors: HoldingFormErrors | undefined) {
  const [local, setLocalState] = useState<LocalErrors>({
    fields: {},
    form: undefined,
    attempt: 0,
  });
  const fromApi = errors?.fields;
  const fields = useMemo<Fields>(() => ({ ...fromApi, ...local.fields }), [fromApi, local.fields]);

  const setLocal = useCallback((nextFields: Fields, form?: InvestmentErrorKey) => {
    const failed = Object.keys(nextFields).length > 0 || form !== undefined;
    setLocalState((previous) => {
      if (failed) return { fields: nextFields, form, attempt: previous.attempt + 1 };
      const alreadyClear = Object.keys(previous.fields).length === 0 && !previous.form;
      return alreadyClear ? previous : { fields: {}, form: undefined, attempt: previous.attempt };
    });
  }, []);

  const focus = useMemo<FocusRequest>(
    () => ({ api: fromApi, attempt: local.attempt, formError: local.form !== undefined }),
    [fromApi, local.attempt, local.form],
  );

  return { fields, form: local.form ?? errors?.form, focus, setLocal };
}
