/**
 * Runs inside the hidden YouTube Music page. The native app calls
 * `window.__ytmr.call(method, params)` (returns JSON text) and receives the
 * player state through the `ytmrState` message handler.
 */
import { innertube, thumbnailOf } from './innertube';
import { parsePage } from './pages';
import { arrangeSearch } from './search';

declare const ytcfg: { get: (key: string) => unknown };

interface PlayerApi {
  getVideoData(): { video_id?: string; title?: string; author?: string } | undefined;
  getCurrentTime(): number;
  getDuration(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
}

interface WatchEndpoint {
  videoId?: string;
  playlistId?: string;
  [key: string]: unknown;
}

type QueueElement = HTMLElement & {
  data?: {
    videoId?: string;
    title?: unknown;
    shortBylineText?: unknown;
    lengthText?: unknown;
    thumbnail?: unknown;
    navigationEndpoint?: { watchEndpoint?: WatchEndpoint };
  };
};

type Params = Record<string, unknown>;

const api = () =>
  document.getElementById('movie_player') as (HTMLElement & PlayerApi) | null;
const video = () => document.querySelector('video');

const text = (value: unknown) => {
  const node = value as
    | { runs?: { text?: string }[]; simpleText?: string }
    | undefined;
  return (
    node?.runs?.map((run) => run.text ?? '').join('') ?? node?.simpleText ?? ''
  );
};

/** A bigger version of a YouTube Music cover URL. */
const large = (url: string | undefined, size = 544) =>
  url?.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);

const str = (params: Params, name: string) => {
  const value = params[name];
  if (typeof value !== 'string' || !value) throw new Error(`Missing "${name}"`);
  return value;
};
const num = (params: Params, name: string) => {
  const value = params[name];
  if (typeof value !== 'number') throw new Error(`Missing "${name}"`);
  return value;
};

/** Queue rows, without the "video version" twins some rows hold. */
const queueItems = () =>
  [...document.querySelectorAll<QueueElement>('ytmusic-player-queue-item')].filter(
    (item) => item.parentElement?.id !== 'counterpart-renderer',
  );

const isCurrent = (item: QueueElement) => {
  const playing = api()?.getVideoData()?.video_id;
  const versions = [
    item,
    ...(item
      .closest('ytmusic-playlist-panel-video-wrapper-renderer')
      ?.querySelectorAll<QueueElement>(
        '#counterpart-renderer ytmusic-player-queue-item',
      ) ?? []),
  ];
  return versions.some(
    (version) =>
      version.hasAttribute('selected') && version.data?.videoId === playing,
  );
};

const navigate = (endpoint: Record<string, unknown>) => {
  document.querySelector('ytmusic-app')?.dispatchEvent(
    new CustomEvent('yt-navigate', {
      bubbles: true,
      composed: true,
      detail: { endpoint },
    }),
  );
};

/** An endpoint the page parser handed out (JSON text). */
const parseEndpoint = (params: Params) => {
  const value: unknown = JSON.parse(str(params, 'endpoint'));
  if (!value || typeof value !== 'object') throw new Error('Bad endpoint');
  return value as Record<string, Record<string, unknown> | undefined>;
};

const clickButton = (selector: string) => {
  const button = document.querySelector<HTMLElement>(selector);
  if (!button) throw new Error('The player is not ready yet');
  button.click();
};

/** The cover of the playing song, as the player bar shows it. */
const currentCover = () => {
  const img = document.querySelector<HTMLImageElement>(
    'ytmusic-player-bar img.image, ytmusic-player-bar .thumbnail-image-wrapper img',
  );
  const src = img?.src;
  if (src && !src.startsWith('data:')) return large(src);
  const id = api()?.getVideoData()?.video_id;
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined;
};

const state = () => {
  const player = api();
  const data = player?.getVideoData();
  const media = video();
  return {
    ready: Boolean(player),
    loggedIn: ytcfg.get('LOGGED_IN') === true,
    videoId: data?.video_id || undefined,
    title: data?.title || undefined,
    artist: data?.author || undefined,
    cover: data?.video_id ? currentCover() : undefined,
    position: player?.getCurrentTime() ?? 0,
    duration: player?.getDuration() ?? 0,
    paused: media?.paused ?? true,
  };
};

const methods: Record<string, (params: Params) => unknown> = {
  state,

  /** Search results, as YouTube Music's search page shows them. */
  search: async (params) =>
    arrangeSearch(
      parsePage(await innertube('search', { query: str(params, 'query') })),
      str(params, 'query'),
    ),

  /** Any page from an "open" or "more" endpoint. */
  page: async (params) => {
    const endpoint = parseEndpoint(params);
    if (endpoint.searchEndpoint) {
      return parsePage(await innertube('search', endpoint.searchEndpoint));
    }
    const browse = endpoint.browseEndpoint;
    if (!browse || typeof browse.browseId !== 'string') {
      throw new Error('This page cannot be opened');
    }
    return parsePage(
      await innertube('browse', {
        browseId: browse.browseId,
        ...(typeof browse.params === 'string' ? { params: browse.params } : {}),
      }),
      browse.browseId,
    );
  },

  /** The next part of a page (`search` for search result pages). */
  more: async (params) =>
    parsePage(
      await innertube(params.search === true ? 'search' : 'browse', {
        continuation: str(params, 'continuation'),
      }),
    ),

  /** Play from a "play" endpoint (a song in its playlist, an album…). */
  playEndpoint: (params) => {
    const endpoint = parseEndpoint(params);
    if (!endpoint.watchEndpoint && !endpoint.watchPlaylistEndpoint) {
      throw new Error('Nothing to play');
    }
    navigate(endpoint);
    return true;
  },

  queue: () =>
    queueItems().map((item) => ({
      videoId: item.data?.videoId ?? '',
      title: text(item.data?.title),
      artist: text(item.data?.shortBylineText),
      duration: text(item.data?.lengthText) || undefined,
      thumbnail: thumbnailOf(item.data?.thumbnail),
      current: isCurrent(item),
    })),

  /** Play a song now; YouTube Music fills the queue with its radio. */
  play: (params) => {
    navigate({ watchEndpoint: { videoId: str(params, 'videoId') } });
    return true;
  },

  /** Jump to a song that's already in the queue. */
  playQueueItem: (params) => {
    const item = queueItems()[num(params, 'index')];
    const videoId = item?.data?.videoId;
    if (!item || !videoId) throw new Error('That song is no longer queued');
    navigate({
      watchEndpoint: item.data?.navigationEndpoint?.watchEndpoint ?? { videoId },
    });
    return true;
  },

  /** "Play next" / "Add to queue", with YouTube Music's own action. */
  enqueue: (params) => {
    const videoId = str(params, 'videoId');
    const position =
      params.position === 'end'
        ? 'INSERT_AT_END'
        : 'INSERT_AFTER_CURRENT_VIDEO';
    const item = document.createElement(
      'ytmusic-menu-service-item-renderer',
    ) as HTMLElement & { data?: unknown; onTap?: () => void };
    item.hidden = true;
    document.body.append(item);
    item.data = {
      serviceEndpoint: {
        queueAddEndpoint: {
          queueTarget: { videoId, onEmptyQueue: { watchEndpoint: { videoId } } },
          queueInsertPosition: position,
        },
      },
    };
    try {
      item.onTap?.();
    } finally {
      setTimeout(() => item.remove(), 1000);
    }
    return true;
  },

  next: () => {
    clickButton('.next-button');
    return true;
  },
  previous: () => {
    clickButton('.previous-button');
    return true;
  },
  pause: () => {
    api()?.pauseVideo();
    return true;
  },
  resume: () => {
    api()?.playVideo();
    return true;
  },
  seek: (params) => {
    api()?.seekTo(num(params, 'seconds'), true);
    return true;
  },
};

// --- State updates to the app -------------------------------------------

type Handler = { postMessage(message: unknown): void };
const handler = () =>
  (window as unknown as { webkit?: { messageHandlers?: { ytmrState?: Handler } } })
    .webkit?.messageHandlers?.ytmrState;

let lastSent = '';
let lastAt = 0;
const send = (force = false) => {
  const now = performance.now();
  const current = state();
  // Position moves all the time; only resend it twice a second.
  const key = JSON.stringify({ ...current, position: 0 });
  if (!force && key === lastSent && now - lastAt < 500) return;
  lastSent = key;
  lastAt = now;
  handler()?.postMessage(JSON.stringify(current));
};

for (const type of [
  'play',
  'pause',
  'playing',
  'ended',
  'seeked',
  'loadedmetadata',
  'durationchange',
  'timeupdate',
]) {
  // Media events don't bubble; listen on the way down instead.
  document.addEventListener(type, () => send(type !== 'timeupdate'), true);
}
// Title / cover changes and the player appearing.
setInterval(() => send(), 1000);

(window as unknown as { __ytmr: unknown }).__ytmr = {
  async call(method: string, params: Params = {}) {
    const run = methods[method];
    if (!run) return JSON.stringify({ error: `Unknown method: ${method}` });
    try {
      return JSON.stringify({ result: await run(params) });
    } catch (err) {
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
