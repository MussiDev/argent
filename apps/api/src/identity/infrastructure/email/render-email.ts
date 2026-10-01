import type { Language } from '../../domain/account-defaults';
import en from './messages/en.json';
import es from './messages/es.json';

export type TokenEmailKind = 'verification' | 'password_reset';
/** Emails that only inform: no token, no link (FR-05). */
export type NoticeEmailKind = 'two_factor_enabled' | 'two_factor_disabled';

export const NOTICE_EMAIL_KINDS: readonly NoticeEmailKind[] = [
  'two_factor_enabled',
  'two_factor_disabled',
];

export function isNoticeEmailKind(kind: string): kind is NoticeEmailKind {
  return (NOTICE_EMAIL_KINDS as readonly string[]).includes(kind);
}

interface EmailCopy {
  subject: string;
  intro: string;
  action: string;
  expiry: string;
  ignore: string;
}

interface NoticeCopy {
  subject: string;
  body: string;
  advice: string;
}

type Catalog = Record<TokenEmailKind, EmailCopy> & Record<NoticeEmailKind, NoticeCopy>;

const CATALOGS: Record<Language, Catalog> = { es, en };

/** Web pages that read the token from the link and post it to the API. */
const PAGE_BY_KIND: Record<TokenEmailKind, string> = {
  verification: 'verify-email',
  password_reset: 'reset-password',
};

export interface RenderEmailInput {
  kind: TokenEmailKind;
  language: Language;
  token: string;
  /** The configured `WEB_BASE_URL`; never anything derived from a request (threat R-08). */
  webBaseUrl: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** `{base}/{language}/{page}?token=...`, keeping any path prefix of the base URL. */
function buildLink(webBaseUrl: string, language: Language, page: string, token: string): string {
  const base = webBaseUrl.endsWith('/') ? webBaseUrl : `${webBaseUrl}/`;
  const url = new URL(`${language}/${page}`, base);
  url.searchParams.set('token', token);
  return url.toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Subject and bodies of a token email, in the recipient's language, from the email catalogs. */
export function renderEmail({
  kind,
  language,
  token,
  webBaseUrl,
}: RenderEmailInput): RenderedEmail {
  const copy = CATALOGS[language][kind];
  const link = buildLink(webBaseUrl, language, PAGE_BY_KIND[kind], token);

  const text = [copy.intro, `${copy.action}: ${link}`, copy.expiry, copy.ignore].join('\n\n');
  const html = [
    `<p>${escapeHtml(copy.intro)}</p>`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(copy.action)}</a></p>`,
    `<p>${escapeHtml(copy.expiry)}</p>`,
    `<p>${escapeHtml(copy.ignore)}</p>`,
  ].join('\n');

  return { subject: copy.subject, text, html };
}

/** Subject and bodies of a notice email, in the recipient's language; they carry no link. */
export function renderNotice(kind: NoticeEmailKind, language: Language): RenderedEmail {
  const copy = CATALOGS[language][kind];
  const paragraphs = [copy.body, copy.advice];
  return {
    subject: copy.subject,
    text: paragraphs.join('\n\n'),
    html: paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n'),
  };
}
