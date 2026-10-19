import type { ApiClient, Article } from '../lib/api';
import { ArticleImage } from './ArticleImage';
import { useI18n } from '../i18n/I18nProvider';
import { dayKey, groupByDay, paragraphs, ressortsOf, sourceLabel } from '../lib/articles';

const longDate = (d: Date, locale: string) =>
  d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const time = (iso: string, locale: string) =>
  new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

interface FrontPageProps {
  api: ApiClient;
  articles: Article[];
  ressort: string | null;
  onRessort: (ressort: string | null) => void;
  onOpen: (id: string) => void;
}

/**
 * The edition: masthead, ressort bar, one lead story (the newest article of
 * the latest day), the rest of that day in columns, older days below.
 * Column count, rules and kicker style come from the theme (data-* on <html>).
 */
export function FrontPage({ api, articles, ressort, onRessort, onOpen }: FrontPageProps) {
  const { t, dateLocale } = useI18n();
  const ressorts = ressortsOf(articles);
  const visible = ressort ? articles.filter((a) => a.topic === ressort) : articles;
  const [today, ...earlier] = groupByDay(visible);
  const [lead, ...rest] = today?.[1] ?? [];

  return (
    <div className="flex flex-col">
      <header className="samix-masthead">
        <h1 className="samix-masthead-name">Samix</h1>
        <p className="samix-hint">
          {longDate(new Date(), dateLocale)} · {t.paper.edition(articles.length)}
        </p>
      </header>

      {ressorts.length > 0 ? (
        <nav className="samix-ressorts" aria-label={t.paper.ressorts}>
          <button aria-pressed={ressort === null} onClick={() => onRessort(null)}>
            {t.paper.all}
          </button>
          {ressorts.map((r) => (
            <button key={r} aria-pressed={ressort === r} onClick={() => onRessort(r)}>
              {r}
            </button>
          ))}
        </nav>
      ) : null}

      {!lead ? (
        <p className="samix-note">
          <b>{t.status.notice}</b> {t.paper.empty}
        </p>
      ) : (
        <>
          {today && dayKey(new Date().toISOString()) !== today[0] ? (
            <p className="samix-label mb-3">
              {t.paper.lastEdition} · {longDate(new Date(lead.createdAt), dateLocale)}
            </p>
          ) : null}

          <article className="samix-lead">
            <div className="samix-lead-text">
              {lead.topic ? <span className="samix-kicker">{lead.topic}</span> : null}
              <h2 className="samix-headline text-4xl leading-tight mt-1">
                <button className="samix-headline-link" onClick={() => onOpen(lead.id)}>
                  {lead.title}
                </button>
              </h2>
              <p className="samix-prose samix-teaser mt-3">{teaser(lead)}</p>
              <Meta article={lead} />
            </div>
            <ArticleImage api={api} article={lead} placement="lead" />
          </article>

          {rest.length > 0 ? (
            <div className="samix-columns">
              {rest.map((a) => (
                <article key={a.id} className="samix-column-item">
                  <ArticleImage api={api} article={a} placement="column" />
                  {a.topic ? <span className="samix-kicker">{a.topic}</span> : null}
                  <h3 className="samix-headline text-xl leading-snug mt-1">
                    <button className="samix-headline-link" onClick={() => onOpen(a.id)}>
                      {a.title}
                    </button>
                  </h3>
                  <p className="samix-teaser mt-2">{teaser(a)}</p>
                  <Meta article={a} />
                </article>
              ))}
            </div>
          ) : null}
        </>
      )}

      {earlier.map(([day, items]) => (
        <section key={day} className="samix-earlier">
          <h2 className="samix-label pb-1 mb-3 border-b border-rule">{longDate(new Date(items[0].createdAt), dateLocale)}</h2>
          <ul className="flex flex-col gap-3">
            {items.map((a) => (
              <li key={a.id}>
                {a.topic ? <span className="samix-kicker mr-2">{a.topic}</span> : null}
                <span className="samix-headline text-lg">
                  <button className="samix-headline-link" onClick={() => onOpen(a.id)}>
                    {a.title}
                  </button>
                </span>
                <Meta article={a} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Front-page teaser: the first paragraph; the reader shows all of it. */
const teaser = (a: Article) => paragraphs(a.summary)[0] ?? '';

function Meta({ article }: { article: Article }) {
  const { t, dateLocale } = useI18n();
  const source = sourceLabel(article);
  return (
    <p className="samix-hint mt-2">
      {source ? `${source} · ` : ''}
      {t.paper.collected(time(article.createdAt, dateLocale))}
    </p>
  );
}
