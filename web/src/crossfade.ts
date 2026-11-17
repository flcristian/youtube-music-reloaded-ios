/**
 * Crossfade, with the app doing the audio: the page hands it the end of the
 * song that's leaving (it plays it natively and fades it out), mutes the
 * player and moves on; once the next song's first seconds are loaded it
 * hands those over too (faded in), and the app gives the player back at
 * the same spot and unmutes it. See `CrossfadeEngine.swift`.
 */
import { base64, tap } from './tap';

export interface CrossfadeConfig {
  enabled: boolean;
  /** At the end of a song (or of its part). */
  autoEnabled: boolean;
  autoDuration: number;
  /** On Next / Previous / picking another song. */
  manualEnabled: boolean;
  manualDuration: number;
}

interface PlayerApi {
  getVideoData(): { video_id?: string } | undefined;
  getCurrentTime(): number;
  getDuration(): number;
  mute?(): void;
  unMute?(): void;
}

const api = () =>
  document.getElementById('movie_player') as (HTMLElement & PlayerApi) | null;
const video = () => document.querySelector('video');

/**
 * Mute or unmute through the player too: it keeps its own mute state and
 * applies it to the next song, so muting only the element can be undone (or
 * kept) behind our back when the song changes.
 */
const setMuted = (muted: boolean) => {
  const player = api();
  if (muted) player?.mute?.();
  else player?.unMute?.();
  const media = video();
  if (media) media.muted = muted;
};

type Handler = { postMessage(message: unknown): void };
const post = (message: Record<string, unknown>) =>
  (
    window as unknown as {
      webkit?: { messageHandlers?: { ytmrFade?: Handler } };
    }
  ).webkit?.messageHandlers?.ytmrFade?.postMessage(JSON.stringify(message));

/** TEMPORARY: a line in the app's crossfade log. */
const log = (text: string) => post({ phase: 'log', id: 0, text });

/** Extra audio after the fade, while the next song loads, in seconds. */
const SPARE = 6;
/** Start this much before the fade, for the next song to load, in seconds. */
const LEAD = 2.5;
/** How long to wait for the app to start the outgoing song. */
const START_TIMEOUT = 3000;
/** How long to wait for the next song's audio. */
const NEXT_TIMEOUT = 8000;

class Crossfade {
  config: CrossfadeConfig = {
    enabled: false,
    autoEnabled: true,
    autoDuration: 5,
    manualEnabled: true,
    manualDuration: 5,
  };

  /** A crossfade in progress. */
  private fade?: {
    id: number;
    duration: number;
    from: string | undefined;
    action: () => void;
    started: boolean;
  };
  private ids = 0;
  /** Song (and start) the automatic crossfade already ran for. */
  private autoDoneFor?: string;

  /** Where the playing song (or its chosen part) ends. */
  partEnd: () => number | undefined = () => undefined;

  constructor() {
    document.addEventListener('timeupdate', this.onTimeUpdate, true);
  }

  get busy() {
    return this.fade !== undefined;
  }

  /**
   * Change the song with a crossfade (if on): `action` runs once the app
   * plays the leaving song's end.
   */
  leave(action: () => void, kind: 'auto' | 'manual', end?: number) {
    const config = this.config;
    const on =
      config.enabled &&
      (kind === 'auto' ? config.autoEnabled : config.manualEnabled);
    const media = video();
    if (!on || this.fade || !media || media.paused) {
      action();
      return;
    }
    const duration = kind === 'auto' ? config.autoDuration : config.manualDuration;
    const from = media.currentTime;
    const to = Math.min(end ?? Infinity, from + duration + SPARE);
    const audio = tap.window(from, Math.min(to, from + duration));
    if (!audio) {
      log(`leave: no audio for ${from.toFixed(1)}`);
      action();
      return;
    }
    const id = ++this.ids;
    log(`leave ${kind} at ${from.toFixed(1)} until ${to.toFixed(1)}`);
    this.fade = {
      id,
      duration,
      from: api()?.getVideoData()?.video_id,
      action,
      started: false,
    };
    // The longest stretch that's loaded, up to `to`.
    const longest = tap.window(from, to) ?? audio;
    post({
      phase: 'out',
      id,
      data: base64(longest.data),
      start: longest.start,
      at: media.currentTime,
      sentAt: Date.now(),
      until: to,
      duration,
    });
    setTimeout(() => {
      if (this.fade?.id === id && !this.fade.started) this.cancel();
    }, START_TIMEOUT);
  }

  /** The app plays the leaving song: mute the player and move on. */
  outStarted(id: number) {
    const fade = this.fade;
    if (fade?.id !== id || fade.started) return false;
    fade.started = true;
    setMuted(true);
    log('muted');
    fade.action();
    this.waitForNext(fade.id, fade.from, fade.duration).catch(() => this.cancel());
    return true;
  }

  /** The fade is over: the player plays the new song from here on. */
  done(id: number) {
    if (this.fade?.id !== id) return false;
    this.fade = undefined;
    setMuted(false);
    post({ phase: 'unmuted', id });
    // In case the player muted it again while switching songs.
    setTimeout(() => {
      if (!this.fade && video()?.muted) {
        log('still muted after the fade: unmuting again');
        setMuted(false);
      }
    }, 500);
    return true;
  }

  /** Give up: the player plays (unmuted) and the app fades out alone. */
  private cancel() {
    const fade = this.fade;
    this.fade = undefined;
    setMuted(false);
    if (fade && !fade.started) fade.action();
    if (fade) post({ phase: 'cancel', id: fade.id });
  }

  /** Once the next song plays and its start is loaded, hand it over. */
  private async waitForNext(id: number, from: string | undefined, duration: number) {
    const until = performance.now() + NEXT_TIMEOUT;
    let settledAt: number | undefined;
    let settledTime = -1;
    while (performance.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.fade?.id !== id) return;
      const media = video();
      const player = api();
      const videoId = player?.getVideoData()?.video_id;
      if (!media || !player || !videoId || videoId === from) continue;
      if (media.paused || media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        continue;
      }
      if (Math.round(performance.now() / 500) !== this.lastLog) {
        this.lastLog = Math.round(performance.now() / 500);
        log(`next ${videoId} t=${media.currentTime.toFixed(2)} ${tap.describe()}`);
      }
      // Wait until it stays where it starts (a part's start is a seek).
      const time = media.currentTime;
      if (Math.abs(time - settledTime) > 1) {
        settledTime = time;
        settledAt = performance.now();
        continue;
      }
      settledTime = time;
      if (performance.now() - (settledAt ?? 0) < 300) continue;
      const audio = tap.window(time, time + duration + 1);
      if (!audio) continue;
      log(`in at ${media.currentTime.toFixed(2)} start ${audio.start.toFixed(2)}`);
      post({
        phase: 'in',
        id,
        data: base64(audio.data),
        start: audio.start,
        at: media.currentTime,
        sentAt: Date.now(),
        duration,
      });
      return;
    }
    log('next: timed out');
    this.cancel();
  }

  private lastLog = 0;

  /** Automatic crossfade near the end of the song (or of its part). */
  private readonly onTimeUpdate = (event: Event) => {
    if (!(event.target instanceof HTMLMediaElement)) return;
    const config = this.config;
    if (!config.enabled || !config.autoEnabled || this.fade) return;
    const media = event.target;
    const player = api();
    const videoId = player?.getVideoData()?.video_id;
    if (!player || !videoId || media.paused) return;
    const duration = player.getDuration();
    if (!(duration > 0)) return;
    // Player time and media time can differ (the media keeps counting
    // across songs on some players): work in media time.
    const shift = media.currentTime - player.getCurrentTime();
    const end = (this.partEnd() ?? duration) + shift;
    const remaining = end - media.currentTime;
    const fade = config.autoDuration;
    if (remaining > fade + LEAD || remaining < 0.5) return;
    if (end - shift < fade * 2) return;
    const key = `${videoId}@${Math.round(end)}`;
    if (key === this.autoDoneFor) return;
    this.autoDoneFor = key;
    this.leave(
      () => document.querySelector<HTMLElement>('.next-button')?.click(),
      'auto',
      end,
    );
  };
}

export const crossfade = new Crossfade();
