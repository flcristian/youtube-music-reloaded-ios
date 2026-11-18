/**
 * Playing only part of a song ("Play from…", best parts), ported from the
 * desktop app's seamless-crossfade plugin. Without crossfade (yet): at a
 * part's end the player just moves on to the next song.
 */
import { bestPartStart, loadReplayGraph } from './best-part';
import {
  findAll,
  innertube,
  parseContinuation,
  parseTracks,
  thumbnailOf,
  type Track,
} from './innertube';

/** Part of a song to play, in song seconds; no `end`: until the end. */
export interface Interval {
  start: number;
  end?: number;
}

interface PlayerApi {
  getVideoData(): { video_id?: string; title?: string } | undefined;
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
}

export type InsertPosition = 'INSERT_AFTER_CURRENT_VIDEO' | 'INSERT_AT_END';

const api = () =>
  document.getElementById('movie_player') as (HTMLElement & PlayerApi) | null;

/** How long to wait for a chosen song to load, in ms. */
const ENSURE_TIMEOUT = 10_000;
/** How long the song must stay at the chosen start to be done, in ms. */
const SETTLE_TIME = 1000;
const nearStart = (time: number, start: number) =>
  time >= start - 1.5 && time <= start + 10;

/** Best parts: songs per run, replay graphs fetched at once, waits. */
const MAX_SONGS = 50;
const PARALLEL = 6;
const QUEUE_WAIT = 4000;
const MAX_PAGES = 50;

const normalizeTitle = (title: string | undefined) =>
  (title ?? '')
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const waitFor = async (done: () => boolean, timeout: number) => {
  const until = performance.now() + timeout;
  while (performance.now() < until) {
    if (done()) return true;
    await wait(100);
  }
  return done();
};

const seconds = (duration: string | undefined) => {
  if (!duration) return undefined;
  let total = 0;
  for (const part of duration.split(':')) total = total * 60 + Number(part);
  return Number.isFinite(total) && total > 0 ? total : undefined;
};

const shuffled = <T>(items: T[]) => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

const queueEntries = () =>
  [
    ...document.querySelectorAll<HTMLElement & { data?: unknown }>(
      'ytmusic-player-queue-item',
    ),
  ].map(
    (item) =>
      item.closest<HTMLElement & { data?: unknown }>(
        'ytmusic-playlist-panel-video-wrapper-renderer',
      ) ?? item,
  );

const queueLength = () =>
  document.querySelectorAll('ytmusic-player-queue-item').length;

/** The player's queue: its store and the actions its own UI sends. */
type QueueElement = HTMLElement & {
  dispatch?: (action: { type: string; payload?: unknown }) => void;
  queue?: {
    store?: {
      store?: {
        getState(): {
          queue?: {
            items?: Record<string, unknown>[];
            nextQueueItemId?: unknown;
            queueContextParams?: string;
          };
        };
      };
    };
  };
};
const queueElement = () => document.querySelector<QueueElement>('#queue');
const queueState = () => queueElement()?.queue?.store?.store?.getState().queue;

const isSelected = (item: Record<string, unknown>) => {
  const wrapper = item.playlistPanelVideoWrapperRenderer as
    | { primaryRenderer?: { playlistPanelVideoRenderer?: { selected?: boolean } } }
    | undefined;
  const video = (item.playlistPanelVideoRenderer ??
    wrapper?.primaryRenderer?.playlistPanelVideoRenderer) as
    | { selected?: boolean }
    | undefined;
  return video?.selected === true;
};

/**
 * Make the queue the playing song followed by `videoIds` only (the
 * player's own suggestions after it are dropped), in one go. False if
 * the queue can't be changed this way.
 */
const replaceUpNext = async (videoIds: string[]) => {
  const queue = queueElement();
  const state = queueState();
  if (!queue?.dispatch || !state?.items) return false;
  const json = await innertube('music/get_queue', {
    queueContextParams: state.queueContextParams,
    videoIds,
  });
  const items = ((json.queueDatas as { content?: unknown }[] | undefined) ?? [])
    .map((data) => data.content)
    .filter(Boolean);
  if (!items.length) return false;
  const now = queueState();
  const all = now?.items ?? [];
  const current = all.findIndex(isSelected);
  if (current < 0) return false;
  for (let i = all.length - 1; i > current; i--) {
    queue.dispatch({ type: 'REMOVE_ITEM', payload: i });
  }
  queue.dispatch({
    type: 'ADD_ITEMS',
    payload: {
      nextQueueItemId: queueState()?.nextQueueItemId,
      index: current + 1,
      items,
      shuffleEnabled: false,
      shouldAssignIds: true,
    },
  });
  return true;
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

/** Length, title and cover of any song, from YouTube Music's own API. */
export const songDetails = async (videoId: string) => {
  const json = await innertube('player', { videoId });
  const details =
    (json.videoDetails as
      | {
          title?: string;
          author?: string;
          lengthSeconds?: string;
          thumbnail?: { thumbnails?: { url: string; width: number }[] };
        }
      | undefined) ?? {};
  const thumbnails = details.thumbnail?.thumbnails ?? [];
  const largest = thumbnails.reduce<(typeof thumbnails)[number] | undefined>(
    (best, it) => (!best || it.width > best.width ? it : best),
    undefined,
  );
  return {
    title: details.title ?? '',
    artist: details.author ?? '',
    length: Number(details.lengthSeconds) || 0,
    thumbnail: largest?.url,
  };
};

/** The best `part`-second window of a song, or `undefined` without data. */
export const bestPart = async (
  videoId: string,
  length: number,
  part: number,
): Promise<Interval | undefined> => {
  const graph = await loadReplayGraph(videoId);
  if (!graph || !length) return undefined;
  const span = Math.min(part, length);
  const start = bestPartStart(graph, length, span);
  const end = start + span;
  return { start, end: end >= length - 0.5 ? undefined : end };
};

/** The part to play in a best-parts run (the middle without replay data). */
const runPart = async (track: Track, part: number): Promise<Interval> => {
  const length = seconds(track.duration);
  if (!length || length <= part + 20) return { start: 0 };
  const graph = await loadReplayGraph(track.videoId);
  const start = graph
    ? bestPartStart(graph, length, part)
    : Math.max(15, Math.round(length * 0.45) - Math.round(part / 2));
  return { start, end: Math.min(length, start + part) };
};

const playlistTracks = async (playlistId: string) => {
  const tracks: Track[] = [];
  let json = await innertube('browse', {
    browseId: `VL${playlistId.replace(/^VL/, '')}`,
  });
  for (let page = 0; page < MAX_PAGES; page++) {
    tracks.push(...parseTracks(json));
    const next = parseContinuation(json);
    if (!next) break;
    json = await innertube('browse', { continuation: next });
  }
  return tracks;
};

const runsText = (value: unknown) => {
  const node = value as { runs?: { text?: string }[]; simpleText?: string } | undefined;
  return node?.runs?.map((run) => run.text ?? '').join('') ?? node?.simpleText ?? '';
};

/** Where a best-parts run takes its songs from. */
export type Source =
  | { playlistId: string }
  /** A song's or a playlist's radio. */
  | { radio: { videoId?: string; playlistId?: string } };

/** The songs of a radio, as the player's queue would get them. */
const radioTracks = async (target: { videoId?: string; playlistId?: string }) => {
  const json = await innertube(
    'next',
    target.videoId
      ? { videoId: target.videoId, playlistId: `RDAMVM${target.videoId}` }
      : { playlistId: `RDAMPL${target.playlistId}` },
  );
  return findAll(json, 'playlistPanelVideoRenderer').flatMap((raw): Track[] => {
    const item = raw as Record<string, unknown>;
    if (typeof item.videoId !== 'string') return [];
    return [
      {
        videoId: item.videoId,
        title: runsText(item.title),
        subtitle: runsText(item.shortBylineText),
        duration: runsText(item.lengthText) || undefined,
        thumbnail: thumbnailOf(item.thumbnail),
      },
    ];
  });
};

const sourceTracks = (source: Source) =>
  'radio' in source ? radioTracks(source.radio) : playlistTracks(source.playlistId);

class Parts {
  /** Queued songs and the part of them to play. */
  private readonly scheduled = new Map<string, Interval>();
  /** Songs of a best-parts run that haven't played yet, and their titles. */
  private readonly bestParts = new Set<string>();
  private readonly bestPartTitles = new Map<string, string>();
  /** Play now: the next song that starts is the chosen one. */
  private playNow?: { interval: Interval; key: string; at: number };
  /** The playing song's part, once it has started. */
  private active?: { videoId: string; start: number; end?: number };
  private lastVideoId?: string;
  private cancelEnsure?: () => void;
  /** Bumped by every best-parts run, so an older one stops. */
  private run = 0;
  /** What a best-parts run is doing (for the app), if one is running. */
  task?: string;

  constructor() {
    for (const type of ['loadeddata', 'playing', 'timeupdate']) {
      document.addEventListener(type, this.onProgress, true);
    }
  }

  /**
   * Move where the playing song stops (`undefined`: at its end), as
   * dragging the line at the part's end on the waveform does.
   */
  setPartEnd(end: number | undefined) {
    const videoId = api()?.getVideoData()?.video_id;
    if (!videoId) return;
    if (this.active?.videoId === videoId) {
      this.active = { ...this.active, end };
    } else if (end !== undefined) {
      this.active = { videoId, start: 0, end };
    }
  }

  /** The playing song's part, if one was chosen. */
  current() {
    const videoId = api()?.getVideoData()?.video_id;
    const active = this.active;
    return active && active.videoId === videoId
      ? { start: active.start, end: active.end }
      : undefined;
  }

  /** Play `interval` of `videoId` now. */
  play(videoId: string, interval: Interval) {
    const player = api();
    if (player?.getVideoData()?.video_id === videoId) {
      this.active = { videoId, ...interval };
      player.seekTo(interval.start, true);
      return;
    }
    this.playNow = { interval, key: videoId, at: performance.now() };
    navigate({
      watchEndpoint: { videoId, startTimeSeconds: Math.floor(interval.start) },
    });
  }

  /** "Play next" / "Add to queue", playing only `interval` when it's up. */
  /** Queue a whole playlist or album, next or at the end. */
  enqueuePlaylist(playlistId: string, position: InsertPosition) {
    const item = document.createElement(
      'ytmusic-menu-service-item-renderer',
    ) as HTMLElement & { data?: unknown; onTap?: () => void };
    item.hidden = true;
    document.body.append(item);
    item.data = {
      serviceEndpoint: {
        queueAddEndpoint: {
          queueTarget: {
            playlistId,
            onEmptyQueue: { watchPlaylistEndpoint: { playlistId } },
          },
          queueInsertPosition: position,
        },
      },
    };
    try {
      item.onTap?.();
    } finally {
      setTimeout(() => item.remove(), 1000);
    }
  }

  enqueue(videoId: string, interval: Interval, position: InsertPosition) {
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
    if (interval.start >= 1 || interval.end !== undefined) {
      this.scheduled.set(videoId, interval);
    } else if (!this.bestParts.has(videoId)) {
      this.scheduled.delete(videoId);
    }
  }

  /** Play up to 50 songs of a playlist, each only for its best part. */
  async playBestParts(source: Source, shuffle: boolean, part: number) {
    const run = ++this.run;
    const stale = () => run !== this.run;
    this.task = 'Loading songs…';
    try {
      const all = await sourceTracks(source);
      if (stale()) return;
      const unique = [
        ...new Map(all.map((track) => [track.videoId, track])).values(),
      ];
      const tracks = (shuffle ? shuffled(unique) : unique).slice(0, MAX_SONGS);
      if (!tracks.length) throw new Error('This playlist is empty');

      const parts = new Map<string, Interval>();
      let done = 0;
      this.task = `Finding best parts… 0/${tracks.length}`;
      const pending = [...tracks];
      const worker = async () => {
        for (let track = pending.shift(); track; track = pending.shift()) {
          const interval = await runPart(track, part).catch(() => ({
            start: 0,
          }));
          parts.set(track.videoId, interval);
          done++;
          if (!stale()) {
            this.task = `Finding best parts… ${done}/${tracks.length}`;
          }
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      if (stale()) return;

      this.endBestParts();
      for (const track of tracks) {
        this.scheduled.set(track.videoId, parts.get(track.videoId)!);
        this.bestParts.add(track.videoId);
        const title = normalizeTitle(track.title);
        if (title) this.bestPartTitles.set(track.videoId, title);
      }
      const [first, ...rest] = tracks;
      this.play(first.videoId, parts.get(first.videoId)!);
      // Queue the rest right after it, once it plays (last first, each
      // after the previous one landed, so they keep their order).
      await waitFor(
        () => api()?.getVideoData()?.video_id === first.videoId,
        15_000,
      );
      await wait(1000);
      if (stale() || !rest.length) return;
      this.task = 'Queueing…';
      // All at once, in place of the player's suggestions (one at a time,
      // a part could end mid-way and suggestions would play in between).
      const replaced = await replaceUpNext(
        rest.map((track) => track.videoId),
      ).catch(() => false);
      if (replaced || stale()) return;
      let queued = 0;
      for (const track of [...rest].reverse()) {
        if (stale()) return;
        this.task = `Queueing… ${queued}/${rest.length}`;
        const before = queueLength();
        this.enqueue(
          track.videoId,
          parts.get(track.videoId)!,
          'INSERT_AFTER_CURRENT_VIDEO',
        );
        await waitFor(() => queueLength() > before, QUEUE_WAIT);
        queued++;
      }
    } finally {
      if (run === this.run) this.task = undefined;
    }
  }

  private endBestParts() {
    for (const videoId of this.bestParts) this.scheduled.delete(videoId);
    this.bestParts.clear();
    this.bestPartTitles.clear();
  }

  /**
   * The scheduled entry for the playing song. Songs can play under another
   * id (song vs. music video version): also look at every id in the
   * playing song's queue entry, then at best-parts titles.
   */
  private findScheduled(videoId: string) {
    const direct = this.scheduled.get(videoId);
    if (direct) return { key: videoId, interval: direct };
    if (!this.scheduled.size) return undefined;
    const ids = new Set<string>();
    for (const entry of queueEntries()) {
      const json = JSON.stringify(entry.data ?? {});
      if (!json.includes(`"${videoId}"`)) continue;
      for (const match of json.matchAll(/"videoId":"([\w-]+)"/g)) {
        ids.add(match[1]);
      }
    }
    for (const [key, interval] of this.scheduled) {
      if (ids.has(key)) return { key, interval };
    }
    const title = normalizeTitle(api()?.getVideoData()?.title);
    if (title) {
      for (const key of this.bestParts) {
        const interval = this.scheduled.get(key);
        if (interval && this.bestPartTitles.get(key) === title) {
          return { key, interval };
        }
      }
    }
    return undefined;
  }

  /** Whether a best-parts song that hasn't played yet is still queued. */
  private bestPartsQueued() {
    const json = queueEntries()
      .map((entry) => JSON.stringify(entry.data ?? {}))
      .join();
    return [...this.bestParts].some((videoId) =>
      json.includes(`"${videoId}"`),
    );
  }

  /** A song started: jump to its part. While it plays: stop at its end. */
  private readonly onProgress = (event: Event) => {
    if (!(event.target instanceof HTMLMediaElement)) return;
    const player = api();
    const videoId = player?.getVideoData()?.video_id;
    if (!player || !videoId) return;
    if (videoId === this.lastVideoId) {
      this.checkEnd(player, videoId, event.target);
      return;
    }
    if (!(player.getDuration() > 0)) return;
    this.lastVideoId = videoId;
    let found: { key: string; interval: Interval } | undefined;
    const playNow = this.playNow;
    this.playNow = undefined;
    if (playNow && performance.now() - playNow.at < ENSURE_TIMEOUT) {
      found = playNow;
    } else {
      found = this.findScheduled(videoId);
    }
    if (found) {
      this.active = { videoId, ...found.interval };
    } else if (this.active?.videoId !== videoId) {
      this.active = undefined;
    }
    if (!found && this.bestParts.size && !this.bestPartsQueued()) {
      this.endBestParts();
    }
    if (!found) return;
    this.scheduled.delete(found.key);
    this.bestParts.delete(found.key);
    if (found.interval.start >= 1) {
      this.ensurePosition(videoId, found.interval.start);
    }
  };

  /** At the chosen end, move on to the next song. */
  private checkEnd(player: PlayerApi, videoId: string, media: HTMLMediaElement) {
    const end = this.active?.videoId === videoId ? this.active.end : undefined;
    if (end === undefined || media.paused) return;
    const time = player.getCurrentTime();
    if (time < end || time > end + 2) return;
    this.active = undefined;
    document.querySelector<HTMLElement>('.next-button')?.click();
  }

  /**
   * Make the song actually play from `start`: YouTube Music sometimes
   * ignores the start time, so keep checking until it stays there.
   */
  private ensurePosition(videoId: string, start: number) {
    this.cancelEnsure?.();
    const started = performance.now();
    let settledSince: number | undefined;
    const timer = setInterval(() => {
      const now = performance.now();
      if (now - started > ENSURE_TIMEOUT) {
        this.cancelEnsure?.();
        return;
      }
      const player = api();
      const media = document.querySelector('video');
      const playing =
        media &&
        !media.paused &&
        media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
      if (!player || player.getVideoData()?.video_id !== videoId || !playing) {
        return;
      }
      if (!nearStart(player.getCurrentTime(), start)) {
        player.seekTo(start, true);
        settledSince = undefined;
      } else {
        settledSince ??= now;
        if (now - settledSince > SETTLE_TIME) this.cancelEnsure?.();
      }
    }, 50);
    this.cancelEnsure = () => {
      clearInterval(timer);
      this.cancelEnsure = undefined;
    };
  }
}

export const parts = new Parts();
