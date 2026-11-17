/**
 * Requests to YouTube Music's own API (the same one the web app uses),
 * signed with the logged-in session, plus parsers for the responses.
 */
declare const ytcfg: { get: (key: string) => unknown };

type Json = Record<string, unknown>;

const sha1 = async (value: string) => {
  const hash = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/** The `SAPISIDHASH` authorization the web app sends for personal data. */
const authorization = async () => {
  const sapisid = /(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/.exec(
    document.cookie,
  )?.[1];
  if (!sapisid) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const hash = await sha1(`${now} ${sapisid} ${location.origin}`);
  return `SAPISIDHASH ${now}_${hash}`;
};

const sessionIndex = () => {
  const value = ytcfg.get('SESSION_INDEX');
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '0';
};

export const innertube = async (endpoint: string, body: Json) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-origin': location.origin,
    'x-goog-authuser': sessionIndex(),
  };
  const auth = await authorization();
  if (auth) headers.authorization = auth;
  const response = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ context: ytcfg.get('INNERTUBE_CONTEXT'), ...body }),
  });
  if (!response.ok) {
    throw new Error(`YouTube Music API ${endpoint}: ${response.status}`);
  }
  return (await response.json()) as Json;
};

/** Every value stored under `key`, anywhere in `node`. */
export const findAll = (node: unknown, key: string, out: unknown[] = []) => {
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, key, out);
  } else if (node && typeof node === 'object') {
    for (const [name, value] of Object.entries(node)) {
      if (name === key) out.push(value);
      else findAll(value, key, out);
    }
  }
  return out;
};

const text = (value: unknown) => {
  const node = value as
    | { runs?: { text?: string }[]; simpleText?: string }
    | undefined;
  return (
    node?.runs?.map((run) => run.text ?? '').join('') ?? node?.simpleText ?? ''
  );
};

export interface Track {
  videoId: string;
  title: string;
  /** Artists, album, … as YouTube Music shows them. */
  subtitle: string;
  duration?: string;
  /** Small cover image URL. */
  thumbnail?: string;
}

/** The smallest thumbnail URL in a renderer (good for list rows). */
export const thumbnailOf = (node: unknown) => {
  const list = findAll(node, 'thumbnails')[0] as { url?: string }[] | undefined;
  return list?.[0]?.url;
};

const DURATION = /^\d+:\d{2}(:\d{2})?$/;

/** Songs in a response (playlist rows, search results…). */
export const parseTracks = (json: unknown): Track[] => {
  const tracks: Track[] = [];
  for (const raw of findAll(json, 'musicResponsiveListItemRenderer')) {
    const item = raw as Json;
    const columns = ((item.flexColumns as Json[] | undefined) ?? []).map(
      (column) =>
        text(
          (column.musicResponsiveListItemFlexColumnRenderer as Json | undefined)
            ?.text,
        ),
    );
    const watch = findAll(
      [item.playlistItemData, item.flexColumns, item.overlay],
      'videoId',
    );
    const videoId = watch.find((id): id is string => typeof id === 'string');
    if (!videoId) continue;
    const fixed = text(
      (
        (item.fixedColumns as Json[] | undefined)?.[0]
          ?.musicResponsiveListItemFixedColumnRenderer as Json | undefined
      )?.text,
    );
    const parts = columns.slice(1).filter(Boolean).join(' • ');
    const duration =
      fixed ||
      parts
        .split(' • ')
        .map((part) => part.trim())
        .find((part) => DURATION.test(part));
    tracks.push({
      videoId,
      title: columns[0] ?? '',
      subtitle: parts,
      duration: duration || undefined,
      thumbnail: thumbnailOf(item.thumbnail),
    });
  }
  return tracks;
};

/** Token for the next page, if there is one. */
export const parseContinuation = (json: unknown) => {
  const command = findAll(json, 'continuationCommand')[0] as
    | { token?: string }
    | undefined;
  if (command?.token) return command.token;
  const next = findAll(json, 'nextContinuationData')[0] as
    | { continuation?: string }
    | undefined;
  return next?.continuation;
};

export interface PlaylistSummary {
  playlistId: string;
  title: string;
  subtitle: string;
}

export const parsePlaylists = (json: unknown): PlaylistSummary[] => {
  const playlists: PlaylistSummary[] = [];
  for (const raw of findAll(json, 'musicTwoRowItemRenderer')) {
    const item = raw as Json;
    const browseId = (
      (item.navigationEndpoint as Json | undefined)?.browseEndpoint as
        | { browseId?: string }
        | undefined
    )?.browseId;
    if (!browseId?.startsWith('VL')) continue;
    playlists.push({
      playlistId: browseId.slice(2),
      title: text(item.title),
      subtitle: text(item.subtitle),
    });
  }
  return playlists;
};

export interface ArtistSummary {
  artistId: string;
  name: string;
  /** e.g. "Artist • 1.2M subscribers". */
  subtitle: string;
}

/** Artists in a search response. */
export const parseArtists = (json: unknown): ArtistSummary[] => {
  const artists: ArtistSummary[] = [];
  for (const raw of findAll(json, 'musicResponsiveListItemRenderer')) {
    const item = raw as Json;
    const browseId = (
      (item.navigationEndpoint as Json | undefined)?.browseEndpoint as
        | { browseId?: string }
        | undefined
    )?.browseId;
    if (!browseId?.startsWith('UC')) continue;
    const columns = ((item.flexColumns as Json[] | undefined) ?? []).map(
      (column) =>
        text(
          (column.musicResponsiveListItemFlexColumnRenderer as Json | undefined)
            ?.text,
        ),
    );
    artists.push({
      artistId: browseId,
      name: columns[0] ?? '',
      subtitle: columns.slice(1).filter(Boolean).join(' • '),
    });
  }
  return artists;
};

/** An artist page's name and its songs shelf ("see all" link if any). */
export const parseArtistPage = (json: unknown) => {
  const header = [
    ...findAll(json, 'musicImmersiveHeaderRenderer'),
    ...findAll(json, 'musicVisualHeaderRenderer'),
  ][0] as Json | undefined;
  const shelves = findAll(json, 'musicShelfRenderer') as Json[];
  const songs = shelves.find((shelf) => parseTracks(shelf).length > 0);
  const allSongs = (songs?.bottomEndpoint as Json | undefined)
    ?.browseEndpoint as { browseId?: string; params?: string } | undefined;
  return {
    name: text(header?.title),
    tracks: songs ? parseTracks(songs) : [],
    allSongs: allSongs?.browseId ? allSongs : undefined,
  };
};
