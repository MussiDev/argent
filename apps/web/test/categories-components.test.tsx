// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATEGORY_COLORS, CATEGORY_ICONS, DEFAULT_CATEGORIES } from '@pesly/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  CategoryForm,
  type CategoryFormProps,
} from '../src/features/categories/components/category-form';
import {
  CategoryList,
  type CategoryListProps,
} from '../src/features/categories/components/category-list';
import {
  CATEGORY_COLOR_CLASSES,
  CategoryVisual,
} from '../src/features/categories/components/category-visual';
import { category, defaultRow, seededDefaults, uuid } from './support/category-fixtures';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

const ARCHIVED_AT = '2026-10-02T00:00:00.000Z';

function listProps(overrides: Partial<CategoryListProps> = {}): CategoryListProps {
  return {
    categories: seededDefaults(),
    language: 'es',
    showArchived: false,
    pending: false,
    editingId: undefined,
    confirmingDeleteId: undefined,
    blockedDeleteId: undefined,
    editError: undefined,
    actionError: undefined,
    onToggleArchived: vi.fn(),
    onStartEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onSaveEdit: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onAskDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    ...overrides,
  };
}

function formProps(overrides: Partial<CategoryFormProps> = {}): CategoryFormProps {
  return {
    categories: seededDefaults(),
    language: 'es',
    pending: false,
    errors: {},
    onSubmit: vi.fn(),
    ...overrides,
  };
}

describe('CategoryVisual', () => {
  it('maps every color key to a token class and every icon key to its own icon', () => {
    for (const color of CATEGORY_COLORS) {
      expect(CATEGORY_COLOR_CLASSES[color]).toContain(`category-${color}`);
    }
    const { container } = render(
      <>
        {CATEGORY_ICONS.map((icon) => (
          <CategoryVisual key={icon} icon={icon} color="red" />
        ))}
      </>,
    );
    const marks = [...container.querySelectorAll('[data-icon]')];
    expect(marks.map((mark) => mark.getAttribute('data-icon'))).toEqual([...CATEGORY_ICONS]);
    expect(container.querySelectorAll('svg')).toHaveLength(CATEGORY_ICONS.length);
  });

  it('falls back to a neutral icon and color for unknown keys and never uses raw values', () => {
    const { container } = render(<CategoryVisual icon="rocket" color="#ff0000" />);
    const mark = container.querySelector('[data-icon]');

    expect(mark?.getAttribute('data-icon')).toBe('unknown');
    expect(mark?.getAttribute('data-color')).toBe('unknown');
    expect(mark?.getAttribute('class')).toContain('text-muted-foreground');
    expect(mark?.getAttribute('style')).toBeNull();
    expect(container.innerHTML).not.toContain('#ff0000');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('defines the 12 color tokens for light, dark and the Tailwind theme', () => {
    const css = readFileSync(resolve(__dirname, '../src/app/globals.css'), 'utf8');
    const root = /:root\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    const dark = /\.dark\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    const theme = /@theme inline\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    for (const color of CATEGORY_COLORS) {
      expect(root).toContain(`--category-${color}:`);
      expect(dark).toContain(`--category-${color}:`);
      expect(theme).toContain(`--color-category-${color}: var(--category-${color})`);
    }
  });
});

describe('CategoryList', () => {
  it('shows the Spanish default names with es (AC-14)', () => {
    renderApp(<CategoryList {...listProps({ language: 'es' })} />);

    expect(screen.getByRole('listitem', { name: 'Comida' })).toBeDefined();
    expect(screen.getByRole('listitem', { name: 'Supermercado' })).toBeDefined();
    expect(screen.queryByRole('listitem', { name: 'Food' })).toBeNull();
  });

  it('shows the English default names with en (AC-15)', () => {
    renderApp(<CategoryList {...listProps({ language: 'en' })} />, { locale: 'en' });

    expect(screen.getByRole('listitem', { name: 'Food' })).toBeDefined();
    expect(screen.getByRole('listitem', { name: 'Groceries' })).toBeDefined();
    expect(screen.queryByRole('listitem', { name: 'Comida' })).toBeNull();
  });

  it('switches untouched defaults with the language and keeps a renamed default (AC-15, AC-16, AC-17)', () => {
    const categories = seededDefaults().map((row) =>
      row.key === 'transport' ? { ...row, name: 'Mi auto' } : row,
    );
    const { rerender } = renderApp(<CategoryList {...listProps({ categories })} />);

    expect(screen.getByRole('listitem', { name: 'Comida' })).toBeDefined();
    expect(screen.getByRole('listitem', { name: 'Mi auto' })).toBeDefined();

    rerender(<CategoryList {...listProps({ categories, language: 'en' })} />);

    expect(screen.getByRole('listitem', { name: 'Food' })).toBeDefined();
    expect(screen.queryByRole('listitem', { name: 'Comida' })).toBeNull();
    expect(screen.getByRole('listitem', { name: 'Mi auto' })).toBeDefined();
    expect(screen.queryByRole('listitem', { name: 'Transport' })).toBeNull();
  });

  it('has an expense and an income section, each category with its subcategories', () => {
    renderApp(<CategoryList {...listProps()} />);

    const expense = screen.getByRole('region', { name: es.categories.sections.expense });
    const income = screen.getByRole('region', { name: es.categories.sections.income });
    const food = within(expense).getByRole('listitem', { name: 'Comida' });
    expect(within(food).getByRole('listitem', { name: 'Supermercado' })).toBeDefined();
    expect(within(expense).queryByRole('listitem', { name: 'Sueldo' })).toBeNull();
    expect(within(income).getByRole('listitem', { name: 'Sueldo' })).toBeDefined();
  });

  it('sorts defaults by catalog position, then custom ones by creation, whatever the API order', () => {
    const custom1 = category({
      id: uuid(901),
      name: 'Zeta',
      createdAt: '2026-10-02T00:00:00.000Z',
    });
    const custom2 = category({
      id: uuid(902),
      name: 'Alfa',
      createdAt: '2026-10-03T00:00:00.000Z',
    });
    const categories = [custom2, ...seededDefaults().reverse(), custom1];
    renderApp(<CategoryList {...listProps({ categories })} />);

    const expense = screen.getByRole('region', { name: es.categories.sections.expense });
    const names = within(expense)
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('aria-label'));
    const expectedDefaults = DEFAULT_CATEGORIES.filter((entry) => entry.kind === 'expense').map(
      (entry) => entry.names.es,
    );
    expect(names).toEqual([...expectedDefaults, 'Zeta', 'Alfa']);
  });

  it('renders a name containing markup as literal text (error path, invalid markup)', () => {
    const name = '<img src=x onerror="alert(1)">';
    const { container } = renderApp(
      <CategoryList {...listProps({ categories: [category({ name })] })} />,
    );

    expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows only the categories it is given (AC-13)', () => {
    renderApp(<CategoryList {...listProps({ categories: [category()] })} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('listitem', { name: 'Comida' })).toBeNull();
  });

  it('shows the empty states', () => {
    const { rerender } = renderApp(<CategoryList {...listProps({ categories: [] })} />);
    expect(screen.getByText(es.categories.list.empty)).toBeDefined();

    rerender(<CategoryList {...listProps({ categories: [], showArchived: true })} />);
    expect(screen.getByText(es.categories.list.emptyArchived)).toBeDefined();
  });

  it('toggles archived categories with a native checkbox', async () => {
    const props = listProps();
    renderApp(<CategoryList {...props} />);

    const toggle = screen.getByRole<HTMLInputElement>('checkbox', {
      name: es.categories.list.showArchived,
    });
    expect(toggle.checked).toBe(false);
    await userEvent.setup().click(toggle);
    expect(props.onToggleArchived).toHaveBeenCalledTimes(1);
  });

  it('shows archived subcategories whose parent is not in the view', () => {
    const child = defaultRow('food.groceries', { archived: true, archivedAt: ARCHIVED_AT });
    renderApp(<CategoryList {...listProps({ categories: [child], showArchived: true })} />);

    expect(screen.getByRole('listitem', { name: 'Supermercado' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Desarchivar Supermercado' })).toBeDefined();
  });

  it('gives every row button a unique accessible name', () => {
    renderApp(<CategoryList {...listProps()} />);

    const names = screen.getAllByRole('button').map((button) => button.textContent.trim());
    expect(new Set(names).size).toBe(names.length);
    expect(screen.getByRole('button', { name: 'Archivar Comida' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Editar Supermercado' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Eliminar Sueldo' })).toBeDefined();
  });

  it('reports the row actions with the category id', async () => {
    const props = listProps();
    renderApp(<CategoryList {...props} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Editar Comida' }));
    await user.click(screen.getByRole('button', { name: 'Archivar Comida' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar Comida' }));

    expect(props.onStartEdit).toHaveBeenCalledWith(uuid(1));
    expect(props.onArchive).toHaveBeenCalledWith(uuid(1));
    expect(props.onAskDelete).toHaveBeenCalledWith(uuid(1));
  });

  it('shows unarchive instead of archive on an archived row', async () => {
    const archived = category({ archived: true, archivedAt: ARCHIVED_AT });
    const props = listProps({ categories: [archived], showArchived: true });
    renderApp(<CategoryList {...props} />);

    expect(screen.queryByRole('button', { name: /^Archivar/ })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Desarchivar Mascotas' }));
    expect(props.onUnarchive).toHaveBeenCalledWith(uuid(900));
  });

  it('edits inline with the current name, icon and color selected and reports the new ones', async () => {
    const props = listProps({ editingId: uuid(1) });
    renderApp(<CategoryList {...props} />);
    const user = userEvent.setup();

    const name = screen.getByLabelText<HTMLInputElement>('Nuevo nombre de Comida');
    expect(name.value).toBe('Comida');
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: es.categories.icons.utensils }).checked,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: es.categories.colors.orange }).checked,
    ).toBe(true);

    await user.clear(name);
    await user.type(name, 'Alimentos');
    await user.click(screen.getByRole('radio', { name: es.categories.icons.coffee }));
    await user.click(screen.getByRole('radio', { name: es.categories.colors.blue }));
    await user.click(screen.getByRole('button', { name: es.categories.actions.save }));

    expect(props.onSaveEdit).toHaveBeenCalledWith(uuid(1), {
      name: 'Alimentos',
      icon: 'coffee',
      color: 'blue',
    });
  });

  it('cancels an edit', async () => {
    const props = listProps({ editingId: uuid(1) });
    renderApp(<CategoryList {...props} />);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.categories.actions.cancel }));
    expect(props.onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('shows an edit error on the name field', () => {
    renderApp(
      <CategoryList
        {...listProps({ editingId: uuid(1), editError: 'errors.categoryNameTaken' })}
      />,
    );

    expect(screen.getByText(es.errors.categoryNameTaken)).toBeDefined();
    expect(screen.getByLabelText('Nuevo nombre de Comida').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('asks for confirmation with a status message before deleting', async () => {
    const props = listProps({ confirmingDeleteId: uuid(1) });
    renderApp(<CategoryList {...props} />);

    expect(screen.getByRole('status').textContent).toBe(
      es.categories.actions.confirmDelete.replace('{name}', 'Comida'),
    );
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.categories.actions.confirmDeleteYes }));
    expect(props.onConfirmDelete).toHaveBeenCalledWith(uuid(1));
  });

  it('shows the in-use message with archive-instead only on active rows (AC-10)', async () => {
    const props = listProps({ blockedDeleteId: uuid(1) });
    const { rerender } = renderApp(<CategoryList {...props} />);

    expect(screen.getByText(es.errors.categoryInUse)).toBeDefined();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.categories.actions.archiveInstead }));
    expect(props.onArchive).toHaveBeenCalledWith(uuid(1));

    const archived = defaultRow('food', { archived: true, archivedAt: ARCHIVED_AT });
    rerender(
      <CategoryList
        {...listProps({ categories: [archived], showArchived: true, blockedDeleteId: uuid(1) })}
      />,
    );
    expect(screen.getByText(es.errors.categoryInUse)).toBeDefined();
    expect(screen.queryByRole('button', { name: es.categories.actions.archiveInstead })).toBeNull();
  });

  it('disables every control while a request is pending', () => {
    renderApp(<CategoryList {...listProps({ pending: true })} />);

    for (const button of screen.getAllByRole('button')) {
      expect(button.hasAttribute('disabled')).toBe(true);
    }
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: es.categories.list.showArchived })
        .disabled,
    ).toBe(true);
  });

  it('shows the action error in an alert', () => {
    renderApp(<CategoryList {...listProps({ actionError: 'network' })} />);

    expect(screen.getByRole('alert').textContent).toContain(es.errors.network);
  });
});

describe('CategoryForm', () => {
  it('has a kind select, a parent select, a name, and 24 icons and 12 colors as radios', () => {
    renderApp(<CategoryForm {...formProps()} />);

    expect(screen.getByLabelText<HTMLSelectElement>(es.categories.fields.kind).value).toBe(
      'expense',
    );
    expect(screen.getByLabelText(es.categories.fields.parent)).toBeDefined();
    expect(screen.getByLabelText(es.categories.fields.name)).toBeDefined();
    const icons = screen.getByRole('radiogroup', { name: es.categories.fields.icon });
    const colors = screen.getByRole('radiogroup', { name: es.categories.fields.color });
    expect(within(icons).getAllByRole('radio')).toHaveLength(CATEGORY_ICONS.length);
    expect(within(colors).getAllByRole('radio')).toHaveLength(CATEGORY_COLORS.length);
    for (const icon of CATEGORY_ICONS) {
      expect(within(icons).getByRole('radio', { name: es.categories.icons[icon] })).toBeDefined();
    }
  });

  it('lists only the active top-level categories of the chosen kind, with display names', async () => {
    const archived = defaultRow('health', { archived: true, archivedAt: ARCHIVED_AT });
    const categories = seededDefaults().map((row) => (row.key === 'health' ? archived : row));
    renderApp(<CategoryForm {...formProps({ categories })} />);
    const user = userEvent.setup();

    const labels = () =>
      [...screen.getByLabelText<HTMLSelectElement>(es.categories.fields.parent).options].map(
        (option) => option.textContent,
      );
    expect(labels()).toContain('Comida');
    expect(labels()).toContain('Otros gastos');
    expect(labels()).not.toContain('Supermercado');
    expect(labels()).not.toContain('Salud');
    expect(labels()).not.toContain('Sueldo');

    await user.selectOptions(screen.getByLabelText(es.categories.fields.kind), 'income');
    expect(labels()).toContain('Sueldo');
    expect(labels()).not.toContain('Comida');
  });

  it('shows the parent names in English with en', () => {
    renderApp(<CategoryForm {...formProps({ language: 'en' })} />, { locale: 'en' });

    const parent = screen.getByLabelText<HTMLSelectElement>(en.categories.fields.parent);
    expect([...parent.options].map((option) => option.textContent)).toContain('Food');
  });

  it('submits what was typed and picked, untouched', async () => {
    const props = formProps();
    renderApp(<CategoryForm {...props} />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(es.categories.fields.parent), uuid(1));
    await user.type(screen.getByLabelText(es.categories.fields.name), '  Café ');
    await user.click(screen.getByRole('radio', { name: es.categories.icons.coffee }));
    await user.click(screen.getByRole('radio', { name: es.categories.colors.teal }));
    await user.click(screen.getByRole('button', { name: es.categories.form.submit }));

    expect(props.onSubmit).toHaveBeenCalledWith({
      kind: 'expense',
      parentId: uuid(1),
      name: '  Café ',
      icon: 'coffee',
      color: 'teal',
    });
  });

  it('shows each field error with aria-invalid and focuses the first invalid field', async () => {
    renderApp(
      <CategoryForm
        {...formProps({
          errors: {
            fields: {
              name: 'categories.errors.nameRequired',
              icon: 'categories.errors.iconRequired',
              color: 'categories.errors.colorRequired',
              parentId: 'errors.categoryNestingTooDeep',
            },
          },
        })}
      />,
    );

    expect(screen.getByText(es.categories.errors.nameRequired)).toBeDefined();
    expect(screen.getByText(es.categories.errors.iconRequired)).toBeDefined();
    expect(screen.getByText(es.categories.errors.colorRequired)).toBeDefined();
    expect(screen.getByText(es.errors.categoryNestingTooDeep)).toBeDefined();
    expect(screen.getByLabelText(es.categories.fields.name).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(screen.getByLabelText(es.categories.fields.parent).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(
      screen
        .getByRole('radiogroup', { name: es.categories.fields.icon })
        .getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen
        .getByRole('radiogroup', { name: es.categories.fields.color })
        .getAttribute('aria-invalid'),
    ).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.categories.fields.parent));
    });
  });

  it('shows the form-level alert and disables submit while pending', () => {
    renderApp(<CategoryForm {...formProps({ pending: true, errors: { form: 'network' } })} />);

    expect(screen.getByRole('alert').textContent).toContain(es.errors.network);
    expect(
      screen.getByRole('button', { name: es.categories.form.pending }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
