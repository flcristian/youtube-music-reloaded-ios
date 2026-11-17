/**
 * Turns any YouTube Music page (home, explore, library, playlist, album,
 * artist, search results, and their "load more" pages) into one simple shape
 * the native screens can draw.
 */
import { findAll } from './innertube';

type Json = Record<string, unknown>;

export type ItemKind =
  | 'song'
  | 'video'
  | 'album'
  | 'playlist'
  | 'artist'
  | 'profile'
  | 'podcast'
  | 'episode'
  | 'page';

export interface Item {
  kind: ItemKind;
  title: string;
  subtitle: string;
  thumbnail?: string;
  /** 16:9 cover (music videos). */
  wide: boolean;
  videoId?: string;
  duration?: string;
  /** Endpoint (JSON text) that plays this item. */
  play?: string;
  /** Endpoint (JSON text) that opens this item's page. */
  open?: string;
}

export interface Section {
  title?: string;
  /** `cards`: one row of up to 3 cards. */
  style: 'list' | 'carousel' | 'grid' | 'cards';
  items: Item[];
  /** Endpoint (JSON text) of the section's "More" / "See all" page. */
  more?: string;
}

export interface Header {
  title: string;
  subtitle: string;
  secondSubtitle: string;
  /** Artist or owner shown above the title. */
  strapline?: string;
  thumbnail?: string;
  round: boolean;
  play?: string;
  shuffle?: string;
}

/** A filter button above search results ("Songs", "Artists"…). */
export interface Chip {
  title: string;
  selected: boolean;
  /** Endpoint (JSON text) of the filtered page. */
  open: string;
}

export interface Page {
  header?: Header;
  chips: Chip[];
  sections: Section[];
  /** Rows of a "load more" page that continue the last list section. */
  items: Item[];
  continuation?: string;
}

const SHUFFLE_PARAMS = 'wAEB8gECKAE%3D';

const text = (value: unknown) => {
  const node = value as
    | { runs?: { text?: string }[]; simpleText?: string }
    | undefined;
  return (
    node?.runs?.map((run) => run.text ?? '').join('') ?? node?.simpleText ?? ''
  );
};

const get = (node: unknown, ...path: string[]) => {
  let current = node;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Json)[key];
  }
  return current;
};

/** A thumbnail at least `min` px wide (or the largest there is). */
const thumbnail = (node: unknown, min: number) => {
  const lists = findAll(node, 'thumbnails') as
    | { url?: string; width?: number }[][]
    | undefined;
  const list = lists?.[0];
  if (!list?.length) return undefined;
  const sorted = [...list].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const url = (sorted.find((it) => (it.width ?? 0) >= min) ?? sorted.at(-1))
    ?.url;
  return url?.startsWith('//') ? `https:${url}` : url;
};

const pageKinds: Record<string, ItemKind> = {
  MUSIC_PAGE_TYPE_ALBUM: 'album',
  MUSIC_PAGE_TYPE_AUDIOBOOK: 'album',
  MUSIC_PAGE_TYPE_PLAYLIST: 'playlist',
  MUSIC_PAGE_TYPE_ARTIST: 'artist',
  MUSIC_PAGE_TYPE_USER_CHANNEL: 'profile',
  MUSIC_PAGE_TYPE_LIBRARY_ARTIST: 'artist',
  MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE: 'podcast',
  MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE: 'episode',
};

const pageKind = (endpoint: unknown): ItemKind => {
  const type = get(
    endpoint,
    'browseEndpoint',
    'browseEndpointContextSupportedConfigs',
    'browseEndpointContextMusicConfig',
    'pageType',
  );
  return (typeof type === 'string' && pageKinds[type]) || 'page';
};

const watchKind = (endpoint: unknown): ItemKind => {
  const type = get(
    endpoint,
    'watchEndpoint',
    'watchEndpointMusicSupportedConfigs',
    'watchEndpointMusicConfig',
    'musicVideoType',
  );
  if (type === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE') return 'episode';
  return type === 'MUSIC_VIDEO_TYPE_ATV' ? 'song' : 'video';
};

/** Only the endpoint itself, as JSON text (drops tracking data). */
const endpoint = (node: unknown, ...keys: string[]) => {
  for (const key of keys) {
    const value = get(node, key);
    if (value) return JSON.stringify({ [key]: value });
  }
  return undefined;
};

const playEndpoint = (node: unknown) =>
  endpoint(node, 'watchEndpoint', 'watchPlaylistEndpoint');
const openEndpoint = (node: unknown) =>
  endpoint(node, 'browseEndpoint', 'searchEndpoint');

const DURATION = /^\d+:\d{2}(:\d{2})?$/;

/** A row: songs, videos, and albums/artists/playlists in search results. */
const listItem = (item: Json): Item | undefined => {
  const columns = ((item.flexColumns as Json[] | undefined) ?? []).map(
    (column) => get(column, 'musicResponsiveListItemFlexColumnRenderer', 'text'),
  );
  const title = text(columns[0]);
  const details = columns.slice(1).map(text).filter(Boolean).join(' • ');
  const fixed = text(
    get(
      (item.fixedColumns as Json[] | undefined)?.[0],
      'musicResponsiveListItemFixedColumnRenderer',
      'text',
    ),
  );
  const parts = details.split(' • ').map((part) => part.trim());
  const duration = fixed || parts.find((part) => DURATION.test(part));
  const subtitle = parts.filter((part) => part && part !== duration).join(' • ');

  const overlayPlay = get(
    item.overlay,
    'musicItemThumbnailOverlayRenderer',
    'content',
    'musicPlayButtonRenderer',
    'playNavigationEndpoint',
  );
  const videoId = (
    findAll([item.playlistItemData, overlayPlay, columns[0]], 'videoId') as
      | unknown[]
  ).find((id): id is string => typeof id === 'string');
  const titleEndpoint = get(
    (columns[0] as { runs?: unknown[] } | undefined)?.runs?.[0],
    'navigationEndpoint',
  );

  // Albums, playlists and artists open a page (their play button may
  // still name a song).
  const open = openEndpoint(item.navigationEndpoint);
  if (videoId && !open) {
    const play =
      playEndpoint(overlayPlay) ??
      playEndpoint(titleEndpoint) ??
      JSON.stringify({ watchEndpoint: { videoId } });
    return {
      kind: watchKind(overlayPlay ?? titleEndpoint),
      title,
      subtitle,
      thumbnail: thumbnail(item.thumbnail, 96),
      wide: false,
      videoId,
      duration,
      play,
    };
  }
  if (!open || !title) return undefined;
  return {
    kind: pageKind(item.navigationEndpoint),
    title,
    subtitle,
    thumbnail: thumbnail(item.thumbnail, 96),
    wide: false,
    duration,
    open,
    play: playEndpoint(overlayPlay),
  };
};

/** A card: albums, playlists, artists, videos in carousels and grids. */
const cardItem = (item: Json): Item | undefined => {
  const navigation = item.navigationEndpoint;
  const overlayPlay = get(
    item.thumbnailOverlay,
    'musicItemThumbnailOverlayRenderer',
    'content',
    'musicPlayButtonRenderer',
    'playNavigationEndpoint',
  );
  const title = text(item.title);
  if (!title) return undefined;
  const wide =
    item.aspectRatio === 'MUSIC_TWO_ROW_ITEM_THUMBNAIL_ASPECT_RATIO_RECTANGLE_16_9';
  const watch = get(navigation, 'watchEndpoint') as Json | undefined;
  if (watch) {
    return {
      kind: watchKind(navigation),
      title,
      subtitle: text(item.subtitle),
      thumbnail: thumbnail(item.thumbnailRenderer, 226),
      wide,
      videoId: typeof watch.videoId === 'string' ? watch.videoId : undefined,
      play: playEndpoint(navigation),
    };
  }
  const open = openEndpoint(navigation);
  const play = playEndpoint(overlayPlay);
  // e.g. Library's "New playlist" tile.
  if (!open && !play) return undefined;
  return {
    kind: pageKind(navigation),
    title,
    subtitle: text(item.subtitle),
    thumbnail: thumbnail(item.thumbnailRenderer, 226),
    wide,
    open,
    play,
  };
};

/** Explore's "New releases / Charts / Moods" buttons and mood tiles. */
const navigationButton = (item: Json): Item | undefined => {
  const open = openEndpoint(item.clickCommand);
  const title = text(item.buttonText);
  if (!open || !title) return undefined;
  return { kind: 'page', title, subtitle: '', wide: false, open };
};

const items = (contents: unknown): Item[] => {
  const out: Item[] = [];
  for (const entry of (contents as Json[] | undefined) ?? []) {
    const list = entry.musicResponsiveListItemRenderer as Json | undefined;
    const card = entry.musicTwoRowItemRenderer as Json | undefined;
    const button = entry.musicNavigationButtonRenderer as Json | undefined;
    const item =
      (list && listItem(list)) ??
      (card && cardItem(card)) ??
      (button && navigationButton(button));
    if (item) out.push(item);
  }
  return out;
};

const moreEndpoint = (node: unknown) =>
  openEndpoint(
    get(
      node,
      'header',
      'musicCarouselShelfBasicHeaderRenderer',
      'moreContentButton',
      'buttonRenderer',
      'navigationEndpoint',
    ),
  ) ?? openEndpoint(get(node, 'bottomEndpoint'));

/** Search's "Top result" card, plus the rows under it. */
const topResult = (card: Json): Section => {
  const navigation = card.onTap ?? get(card, 'title', 'runs', '0', 'navigationEndpoint');
  const main: Item = {
    kind: get(navigation, 'watchEndpoint') ? watchKind(navigation) : pageKind(navigation),
    title: text(card.title),
    subtitle: text(card.subtitle),
    thumbnail: thumbnail(card.thumbnail, 226),
    wide: false,
    play: playEndpoint(navigation),
    open: openEndpoint(navigation),
    videoId: get(navigation, 'watchEndpoint', 'videoId') as string | undefined,
  };
  return {
    title: text(get(card, 'header', 'musicCardShelfHeaderBasicRenderer', 'title')),
    style: 'list',
    items: [main, ...items(card.contents)].filter((it) => it.title),
  };
};

const SECTION_KEYS = [
  'musicCarouselShelfRenderer',
  'musicShelfRenderer',
  'musicPlaylistShelfRenderer',
  'gridRenderer',
  'musicCardShelfRenderer',
];

const section = (key: string, node: Json): Section | undefined => {
  switch (key) {
    case 'musicCarouselShelfRenderer': {
      const list = items(node.contents);
      const title = text(
        get(node, 'header', 'musicCarouselShelfBasicHeaderRenderer', 'title'),
      );
      const rows = list.every((it) => it.videoId && !it.wide) &&
        (node.contents as Json[] | undefined)?.[0]?.musicResponsiveListItemRenderer;
      return { title, style: rows ? 'list' : 'carousel', items: list, more: moreEndpoint(node) };
    }
    case 'musicShelfRenderer':
    case 'musicPlaylistShelfRenderer':
      return {
        title: text(node.title) || undefined,
        style: 'list',
        items: items(node.contents),
        more: moreEndpoint(node),
      };
    case 'gridRenderer':
      return {
        title: text(get(node, 'header', 'gridHeaderRenderer', 'title')) || undefined,
        style: 'grid',
        items: items(node.items),
      };
    case 'musicCardShelfRenderer':
      return topResult(node);
    default:
      return undefined;
  }
};

const HEADER_KEYS = [
  'musicResponsiveHeaderRenderer',
  'musicImmersiveHeaderRenderer',
  'musicVisualHeaderRenderer',
  'musicDetailHeaderRenderer',
];

const header = (json: unknown, browseId?: string): Header | undefined => {
  for (const key of HEADER_KEYS) {
    const node = findAll(json, key)[0] as Json | undefined;
    if (!node) continue;
    const artist = key !== 'musicResponsiveHeaderRenderer' && key !== 'musicDetailHeaderRenderer';
    const watch = (findAll(node, 'watchPlaylistEndpoint')[0] ??
      undefined) as Json | undefined;
    const listId =
      (browseId?.startsWith('VL') ? browseId.slice(2) : undefined) ??
      (findAll(node, 'playlistId').find((id) => typeof id === 'string') as
        | string
        | undefined);
    const play = artist
      ? watch && JSON.stringify({ watchPlaylistEndpoint: watch })
      : listId && JSON.stringify({ watchPlaylistEndpoint: { playlistId: listId } });
    const shuffle =
      !artist && listId
        ? JSON.stringify({
            watchPlaylistEndpoint: { playlistId: listId, params: SHUFFLE_PARAMS },
          })
        : undefined;
    return {
      title: text(node.title),
      subtitle: text(node.subtitle),
      secondSubtitle: text(node.secondSubtitle),
      strapline: text(node.straplineTextOne) || undefined,
      thumbnail: thumbnail(node.thumbnail ?? node.foregroundThumbnail, 400),
      round: artist,
      play,
      shuffle,
    };
  }
  return undefined;
};

const continuation = (json: unknown) => {
  const command = findAll(json, 'continuationCommand')[0] as
    | { token?: string }
    | undefined;
  if (command?.token) return command.token;
  const next = findAll(json, 'nextContinuationData')[0] as
    | { continuation?: string }
    | undefined;
  return next?.continuation;
};

/**
 * Search results come one row per `itemSectionRenderer`; consecutive ones
 * make up one list.
 */
const merged = new WeakSet<Section>();

const itemSection = (node: Json, page: Page) => {
  const rows = items(node.contents);
  if (!rows.length) return;
  const last = page.sections.at(-1);
  if (last && merged.has(last)) {
    last.items.push(...rows);
    return;
  }
  const created: Section = { style: 'list', items: rows };
  merged.add(created);
  page.sections.push(created);
};

const chip = (node: Json): Chip | undefined => {
  const open = openEndpoint(node.navigationEndpoint);
  const title = text(node.text);
  if (!open || !title) return undefined;
  return { title, selected: node.isSelected === true, open };
};

/** Sections in page order; rows outside any section become `items`. */
const collect = (node: unknown, page: Page) => {
  if (Array.isArray(node)) {
    for (const entry of node) collect(entry, page);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (SECTION_KEYS.includes(key)) {
      const found = section(key, value as Json);
      if (found && found.items.length) page.sections.push(found);
    } else if (key === 'itemSectionRenderer') {
      itemSection(value as Json, page);
    } else if (key === 'chipCloudChipRenderer') {
      const found = chip(value as Json);
      if (found) page.chips.push(found);
    } else if (key === 'musicResponsiveListItemRenderer') {
      const item = listItem(value as Json);
      if (item) page.items.push(item);
    } else if (key === 'musicTwoRowItemRenderer') {
      const item = cardItem(value as Json);
      if (item) page.items.push(item);
    } else if (!HEADER_KEYS.includes(key) && key !== 'microformat') {
      collect(value, page);
    }
  }
};

export const parsePage = (json: unknown, browseId?: string): Page => {
  const page: Page = { sections: [], items: [], chips: [] };
  page.header = header(json, browseId);
  collect(json, page);
  page.continuation = continuation(json);
  return page;
};
