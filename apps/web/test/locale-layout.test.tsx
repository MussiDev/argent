import { createTranslator } from 'next-intl';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';

// Outside React Server Components next-intl ships stubs; this is the server build's behaviour.
vi.mock('next-intl/server', () => ({
  getTranslations: ({ locale, namespace }: { locale: 'es' | 'en'; namespace: 'metadata' }) =>
    Promise.resolve(createTranslator({ locale, messages: locale === 'en' ? en : es, namespace })),
}));

const { default: LocaleLayout, generateMetadata } = await import('../src/app/[locale]/layout');
const { ApiClientProvider } = await import('../src/lib/api-client-provider');

type Props = LayoutProps<'/[locale]'>;

function props(locale: string): Props {
  return { children: <p>page</p>, params: Promise.resolve({ locale }) };
}

/** Depth-first search of a returned (not rendered) element tree. */
function findElement(node: ReactNode, type: unknown): ReactElement | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === type) return node;
  const children = [node.props.children].flat();
  for (const child of children) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return undefined;
}

const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('[locale] layout', () => {
  it('renders the document in the requested language', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_ORIGIN', 'https://api.argent.test/');

    const tree = await LocaleLayout(props('en'));

    expect(isValidElement(tree) && tree.type).toBe('html');
    expect((tree as ReactElement<{ lang: string }>).props.lang).toBe('en');
    // Only the API origin reaches the browser, normalized.
    const provider = findElement(tree, ApiClientProvider) as ReactElement<{ apiOrigin: string }>;
    expect(provider.props.apiOrigin).toBe('https://api.argent.test');
  });

  it('answers 404 for an unsupported locale', async () => {
    await expect(LocaleLayout(props('fr'))).rejects.toMatchObject(NOT_FOUND);
    await expect(generateMetadata(props('fr'))).rejects.toMatchObject(NOT_FOUND);
  });

  it.each([
    ['es', es],
    ['en', en],
  ] as const)('titles the %s pages from the catalog', async (locale, catalog) => {
    await expect(generateMetadata(props(locale))).resolves.toEqual({
      title: catalog.metadata.title,
      description: catalog.metadata.description,
    });
  });
});
