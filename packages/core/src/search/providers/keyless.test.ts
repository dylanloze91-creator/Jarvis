import { describe, expect, it } from 'vitest';
import {
  DuckDuckGoSearchProvider,
  isDuckDuckGoChallenge,
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
  unwrapDuckDuckGoHref,
} from './duckduckgo.js';
import { BingSearchProvider, parseBingHtml, unwrapBingHref } from './bing.js';
import { BingNewsRssProvider, GoogleNewsRssProvider, parseRssItems, unwrapBingNewsLink } from './newsRss.js';

const NOW = new Date('2026-10-01T22:00:00Z');

// Extraits réels (1er octobre 2026), raccourcis.
const DDG_HTML = `
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://nodejs.org/fr/download">Télécharger Node.js®</a>
    </h2>
    <a class="result__snippet" href="https://nodejs.org/fr/download">Obtenir <b>Node.js</b>® v24.21. LTS pour Windows l&#x27;utiliser</a>
    <div class="clear"></div>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.versio.io%2Ffr%2Fnodejs.html&amp;rut=abc">Versions de Node.js et dates d&#39;EOL</a>
    </h2>
    <a class="result__snippet" href="#">30 sept. 2026 · Dates d'end-of-life de <b>Node.js</b> : dernière version 26.10.0.</a>
  </div>
</div>
<div class="result results_links results_links_deep result--ad ">
  <h2 class="result__title"><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=pub.example">Pub</a></h2>
</div>`;

const DDG_LITE = `
<table>
<tr><td>1.&nbsp;</td><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fen%2Fblog%2Frelease&amp;rut=x" class='result-link'>Node.js — Releases</a></td></tr>
<tr><td>&nbsp;&nbsp;&nbsp;</td><td class='result-snippet'>il y a 3 jours · Node v26.10.0 (Current) est disponible.</td></tr>
</table>`;

const DDG_CHALLENGE = '<html><body><div class="anomaly-modal__box">Unfortunately, bots use DuckDuckGo too.</div><form id="challenge-form"></form></body></html>';

const BING_HTML = `
<ol id="b_results">
<li class="b_algo" data-id iid=SERP.5350><div class="b_tpcn"><a class="tilk" href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1aHR0cHM6Ly9ub2RlanMub3JnL2ZyL2Rvd25sb2Fk&amp;ntb=1"></a></div>
<h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1aHR0cHM6Ly9ub2RlanMub3JnL2ZyL2Rvd25sb2Fk&amp;ntb=1">Télécharger <strong>Node.js</strong></a></h2>
<div class="b_caption"><p class="b_lineclamp2">30 sept. 2026 · Téléchargez la dernière version de <strong>Node.js</strong>.</p></div></li>
<li class="b_algo"><h2><a href="https://www.example.org/page">Exemple direct</a></h2><div class="b_caption"><p>Sans date.</p></div></li>
</ol>`;

const GOOGLE_NEWS_RSS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rss version="2.0"><channel>
<item><title>Le PSG corrige Louvain - Flashscore.fr</title><link>https://news.google.com/rss/articles/CBMiabc?oc=5</link><guid isPermaLink="false">CBMiabc</guid><pubDate>Thu, 01 Oct 2026 11:50:00 GMT</pubDate><description>&lt;a href="https://news.google.com/rss/articles/CBMiabc?oc=5"&gt;Le PSG corrige Louvain&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Flashscore.fr&lt;/font&gt;</description><source url="https://www.flashscore.fr">Flashscore.fr</source></item>
<item><title>Budget 2027 : Sébastien Lecornu alerte - Le Monde.fr</title><link>https://news.google.com/rss/articles/CBMidef?oc=5</link><pubDate>Wed, 30 Sep 2026 09:18:00 GMT</pubDate><source url="https://www.lemonde.fr">Le Monde.fr</source></item>
</channel></rss>`;

const BING_NEWS_RSS = `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0" xmlns:News="https://www.bing.com/news/search?q=PSG&amp;format=rss"><channel>
<item><title>OM-PSG : revivez la courte victoire du Paris Saint-Germain</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=1&amp;url=https%3a%2f%2fwww.lequipe.fr%2fFootball%2fom-psg&amp;c=1&amp;mkt=fr-fr</link><description>L&#8217;OM s&#39;est incliné face au PSG (1-2).</description><pubDate>Sun, 20 Sep 2026 13:46:00 GMT</pubDate><News:Source>L'Équipe</News:Source></item>
</channel></rss>`;

function fakeFetch(responses: { status: number; body: string }[], seen: { url: string; init?: RequestInit }[] = []): typeof fetch {
  let index = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return new Response(next.body, { status: next.status });
  }) as typeof fetch;
}

describe('DuckDuckGo', () => {
  it('lit les résultats, déballe uddg, garde la date d’un extrait et ignore la publicité', () => {
    const results = parseDuckDuckGoHtml(DDG_HTML, 10, NOW);
    expect(results.map((item) => item.url)).toEqual(['https://nodejs.org/fr/download', 'https://www.versio.io/fr/nodejs.html']);
    expect(results[0]).toMatchObject({ title: 'Télécharger Node.js®', source: 'nodejs.org' });
    expect(results[0]?.snippet).toBe("Obtenir Node.js ® v24.21. LTS pour Windows l'utiliser");
    expect(results[1]?.title).toBe("Versions de Node.js et dates d'EOL");
    expect(results[1]?.publishedAt?.slice(0, 10)).toBe('2026-09-30');
    expect(results[1]?.snippet.startsWith('Dates')).toBe(true);
  });

  it('lit la version « lite » et une date relative', () => {
    const results = parseDuckDuckGoLite(DDG_LITE, 5, NOW);
    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe('https://nodejs.org/en/blog/release');
    expect(results[0]?.publishedAt?.slice(0, 10)).toBe('2026-09-28');
  });

  it('reconnaît le défi anti-robot (HTTP 202 ou page « anomaly »)', () => {
    expect(isDuckDuckGoChallenge(202, '')).toBe(true);
    expect(isDuckDuckGoChallenge(200, DDG_CHALLENGE)).toBe(true);
    expect(isDuckDuckGoChallenge(200, DDG_HTML)).toBe(false);
    expect(unwrapDuckDuckGoHref('https://duckduckgo.com/y.js?ad_domain=x')).toBeNull();
  });

  it('POST sur html puis repli sur lite après un 202', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const provider = new DuckDuckGoSearchProvider({
      fetchImpl: fakeFetch([{ status: 202, body: DDG_CHALLENGE }, { status: 200, body: DDG_LITE }], seen),
      now: () => NOW,
    });
    const response = await provider.search({ query: 'node.js version', freshness: 'week' });
    expect(seen.map((call) => call.url)).toEqual(['https://html.duckduckgo.com/html/', 'https://lite.duckduckgo.com/lite/']);
    expect(seen[0]?.init?.method).toBe('POST');
    expect(String(seen[0]?.init?.body)).toContain('df=w');
    expect(response.results).toHaveLength(1);
  });

  it('deux défis : erreur explicite, pas « aucun résultat »', async () => {
    const provider = new DuckDuckGoSearchProvider({ fetchImpl: fakeFetch([{ status: 202, body: DDG_CHALLENGE }]) });
    await expect(provider.search({ query: 'x' })).rejects.toThrow(/limite temporairement/);
  });
});

describe('Bing', () => {
  it('déballe les liens /ck/a (base64) et lit titre, extrait, date', () => {
    expect(unwrapBingHref('https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly9ub2RlanMub3JnL2ZyL2Rvd25sb2Fk&ntb=1')).toBe('https://nodejs.org/fr/download');
    const results = parseBingHtml(BING_HTML, 10, NOW);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: 'Télécharger Node.js', url: 'https://nodejs.org/fr/download', source: 'nodejs.org' });
    expect(results[0]?.publishedAt?.slice(0, 10)).toBe('2026-09-30');
    expect(results[1]).toMatchObject({ url: 'https://www.example.org/page', snippet: 'Sans date.' });
    expect(results[1]?.publishedAt).toBeUndefined();
  });

  it('filtre de fraîcheur et erreur sur une page vide', async () => {
    const seen: { url: string }[] = [];
    const provider = new BingSearchProvider({ fetchImpl: fakeFetch([{ status: 200, body: '<html></html>' }], seen) });
    await expect(provider.search({ query: 'psg', freshness: 'day' })).rejects.toThrow(/sans résultats/);
    expect(decodeURIComponent(seen[0]!.url)).toContain('filters=ex1:"ez1"');
  });
});

describe('Flux d’actualité', () => {
  it('Google Actualités : titre sans le média, domaine du média, date de publication', async () => {
    const seen: { url: string }[] = [];
    const provider = new GoogleNewsRssProvider({ fetchImpl: fakeFetch([{ status: 200, body: GOOGLE_NEWS_RSS }], seen) });
    const response = await provider.search({ query: 'PSG', freshness: 'week' });
    expect(new URL(seen[0]!.url).searchParams.get('q')).toBe('PSG when:7d');
    expect(response.results[0]).toMatchObject({
      title: 'Le PSG corrige Louvain',
      source: 'flashscore.fr',
      publisher: 'Flashscore.fr',
      publishedAt: '2026-10-01T11:50:00.000Z',
    });
    expect(response.results[1]?.title).toBe('Budget 2027 : Sébastien Lecornu alerte');
  });

  it('Google Actualités : la une sans requête', async () => {
    const seen: { url: string }[] = [];
    const provider = new GoogleNewsRssProvider({ fetchImpl: fakeFetch([{ status: 200, body: GOOGLE_NEWS_RSS }], seen) });
    await provider.search({ query: '*' });
    expect(seen[0]!.url).toBe('https://news.google.com/rss?hl=fr&gl=FR&ceid=FR%3Afr');
  });

  it('Bing Actualités : lien réel de l’article, extrait, média, date', async () => {
    expect(unwrapBingNewsLink('http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fwww.lequipe.fr%2fa&c=1')).toBe('https://www.lequipe.fr/a');
    const provider = new BingNewsRssProvider({ fetchImpl: fakeFetch([{ status: 200, body: BING_NEWS_RSS }]) });
    const response = await provider.search({ query: 'PSG' });
    expect(response.results[0]).toMatchObject({
      url: 'https://www.lequipe.fr/Football/om-psg',
      source: 'lequipe.fr',
      publisher: "L'Équipe",
      snippet: "L’OM s'est incliné face au PSG (1-2).",
      publishedAt: '2026-09-20T13:46:00.000Z',
    });
  });

  it('parseRssItems ignore les entrées sans titre ou sans lien', () => {
    expect(parseRssItems('<rss><item><title>Sans lien</title></item></rss>')).toEqual([]);
  });
});
