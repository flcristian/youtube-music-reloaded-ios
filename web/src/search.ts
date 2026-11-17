/**
 * Arranges "all results" search pages: artists (3 cards) and songs (5 rows)
 * first — songs first when YouTube's top result is a song — then one shelf
 * per other kind. Every shelf links to its full, filtered list.
 */
import type { Item, ItemKind, Page, Section } from './pages';

/** Start of each filter chip's `params`, by what it lists. */
const FILTERS: [string, string][] = [
  ['EgWKAQIIAW', 'songs'],
  ['EgWKAQIgAW', 'artists'],
  ['EgWKAQIQAW', 'videos'],
  ['EgWKAQIYAW', 'albums'],
  ['EgeKAQQoAEAB', 'community'],
  ['EgeKAQQoADgB', 'featured'],
  ['EgWKAQJYAW', 'profiles'],
  ['EgWKAQJIAW', 'episodes'],
  ['EgWKAQJQAW', 'podcasts'],
];

const filterOf = (open: string) => {
  const params = (JSON.parse(open) as { searchEndpoint?: { params?: string } })
    .searchEndpoint?.params;
  return FILTERS.find(([prefix]) => params?.startsWith(prefix))?.[1];
};

/** Case- and accent-insensitive text for comparing names. */
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const ARTISTS = 3;
const SONGS = 5;

export const arrangeSearch = (page: Page, query: string): Page => {
  // Filtered pages (a chip is selected) stay as they are.
  if (!page.chips.length || page.chips.some((chip) => chip.selected)) return page;

  const chips = new Map(
    page.chips.map((chip) => [filterOf(chip.open), chip] as const),
  );
  const all: Item[] = [];
  const seen = new Set<string>();
  for (const item of page.sections.flatMap((section) => section.items)) {
    const key = item.videoId ?? item.open ?? item.title;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(item);
  }
  const of = (...kinds: ItemKind[]) => all.filter((item) => kinds.includes(item.kind));

  const shelf = (
    filter: string,
    style: Section['style'],
    items: Item[],
    fallback: string,
  ): Section | undefined => {
    if (!items.length) return undefined;
    const chip = chips.get(filter);
    return { title: chip?.title ?? fallback, style, items, more: chip?.open };
  };

  const artists = shelf('artists', 'cards', of('artist').slice(0, ARTISTS), 'Artists');
  const songs = shelf('songs', 'list', of('song').slice(0, SONGS), 'Songs');
  // Artists first when the search is an artist's name ("miyagi"), songs
  // first otherwise ("kolibri", "miyagi kolibri").
  const wanted = normalize(query);
  const artistSearch = of('artist').some((artist) =>
    normalize(artist.title).includes(wanted),
  );
  const songFirst = !artistSearch;
  const rest = [
    shelf('videos', 'carousel', of('video').map((it) => ({ ...it, wide: true })), 'Videos'),
    shelf('albums', 'carousel', of('album'), 'Albums'),
    shelf('community', 'carousel', of('playlist'), 'Playlists'),
    shelf('podcasts', 'carousel', of('podcast'), 'Podcasts'),
    shelf('episodes', 'list', of('episode'), 'Episodes'),
    shelf('profiles', 'carousel', of('profile'), 'Profiles'),
  ];
  const sections = [
    ...(songFirst ? [songs, artists] : [artists, songs]),
    ...rest,
  ].filter((section): section is Section => Boolean(section));
  return { ...page, sections, items: [] };
};
