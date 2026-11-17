/**
 * Keeps the audio the player loads (fragmented MP4 from its SourceBuffer),
 * with each fragment's position on the media timeline, so the app can play
 * a few seconds of it natively during a crossfade (iPhone media elements
 * have no volume control, and Web Audio can't route them).
 */

interface Fragment {
  /** Media time of its first sample, in seconds. */
  start: number;
  data: Uint8Array;
}

interface Track {
  /** `ftyp` + `moov`: needed in front of any fragments. */
  init?: Uint8Array;
  timescale: number;
  fragments: Fragment[];
  /** The fragment whose last piece hasn't been appended yet. */
  open?: { fragment: Fragment; missing: number };
}

/** Keep this much audio behind the playback position, in seconds. */
const KEEP_BEHIND = 30;
const MAX_FRAGMENTS = 400;

const type = (data: Uint8Array, at: number) =>
  String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7]);

const size = (view: DataView, at: number) => {
  const small = view.getUint32(at);
  return small === 1 ? Number(view.getBigUint64(at + 8)) : small || view.byteLength - at;
};

/** Top-level (or child) boxes of `data` between `from` and `to`. */
const boxes = (data: Uint8Array, from = 0, to = data.byteLength) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const found: { type: string; at: number; size: number }[] = [];
  let at = from;
  while (at + 8 <= to) {
    const length = size(view, at);
    if (length < 8) break;
    found.push({ type: type(data, at), at, size: length });
    at += length;
  }
  return found;
};

const header = (data: Uint8Array, at: number) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at) === 1
    ? 16
    : 8;

/** The first box at `path` (e.g. ['moov', 'trak', 'mdia', 'mdhd']). */
const find = (
  data: Uint8Array,
  path: string[],
  from = 0,
  to = data.byteLength,
): { at: number; size: number } | undefined => {
  const [name, ...rest] = path;
  const box = boxes(data, from, to).find((it) => it.type === name);
  if (!box) return undefined;
  if (!rest.length) return box;
  return find(data, rest, box.at + header(data, box.at), box.at + box.size);
};

const timescaleOf = (init: Uint8Array) => {
  const mdhd = find(init, ['moov', 'trak', 'mdia', 'mdhd']);
  if (!mdhd) return undefined;
  const view = new DataView(init.buffer, init.byteOffset, init.byteLength);
  const body = mdhd.at + header(init, mdhd.at);
  const version = init[body];
  return view.getUint32(body + (version === 1 ? 20 : 12));
};

/** `baseMediaDecodeTime` of a `moof`, in timescale units. */
const decodeTimeOf = (data: Uint8Array, moofAt: number, moofSize: number) => {
  const tfdt = find(data, ['traf', 'tfdt'], moofAt + header(data, moofAt), moofAt + moofSize);
  if (!tfdt) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const body = tfdt.at + header(data, tfdt.at);
  return data[body] === 1
    ? Number(view.getBigUint64(body + 4))
    : view.getUint32(body + 4);
};

const RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000,
];

/** The AAC frames of MP4 fragments, each with an ADTS header. */
const toAdts = (init: Uint8Array, fragments: Fragment[]) => {
  const mdhd = find(init, ['moov', 'trak', 'mdia', 'mdhd']);
  const mp4a = find(init, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
  if (!mdhd || !mp4a) return undefined;
  const initView = new DataView(init.buffer, init.byteOffset, init.byteLength);
  const rate = timescaleOf(init) ?? 48000;
  // stsd: version/flags, count, then the mp4a entry (channel count at 16).
  const entry = mp4a.at + header(init, mp4a.at) + 8;
  const channels = initView.getUint16(entry + 8 + 16) || 2;
  const rateIndex = Math.max(0, RATES.indexOf(rate));
  const profile = 1; // AAC LC (mp4a.40.2)

  const frames: Uint8Array[] = [];
  for (const fragment of fragments) {
    const data = fragment.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const top = boxes(data);
    for (let b = 0; b < top.length; b++) {
      const moof = top[b];
      if (moof.type !== 'moof') continue;
      const mdat = top.slice(b + 1).find((box) => box.type === 'mdat');
      const inside = moof.at + header(data, moof.at);
      const traf = find(data, ['traf'], inside, moof.at + moof.size);
      if (!traf || !mdat) continue;
      const trafInside = traf.at + header(data, traf.at);
      const tfhd = find(data, ['tfhd'], trafInside, traf.at + traf.size);
      const trun = find(data, ['trun'], trafInside, traf.at + traf.size);
      if (!tfhd || !trun) continue;

      let at = tfhd.at + 8;
      const tfhdFlags = view.getUint32(at) & 0xffffff;
      at += 8; // flags + track id
      if (tfhdFlags & 0x1) at += 8;
      if (tfhdFlags & 0x2) at += 4;
      if (tfhdFlags & 0x8) at += 4;
      const defaultSize = tfhdFlags & 0x10 ? view.getUint32(at) : 0;

      at = trun.at + 8;
      const flags = view.getUint32(at) & 0xffffff;
      const count = view.getUint32(at + 4);
      at += 8;
      let offset = mdat.at + header(data, mdat.at);
      if (flags & 0x1) {
        offset = moof.at + view.getInt32(at);
        at += 4;
      }
      if (flags & 0x4) at += 4;
      for (let i = 0; i < count; i++) {
        if (flags & 0x100) at += 4;
        let size = defaultSize;
        if (flags & 0x200) {
          size = view.getUint32(at);
          at += 4;
        }
        if (flags & 0x400) at += 4;
        if (flags & 0x800) at += 4;
        if (!size || offset + size > data.byteLength) break;
        const length = size + 7;
        const frame = new Uint8Array(length);
        frame[0] = 0xff;
        frame[1] = 0xf1; // MPEG-4, no CRC
        frame[2] = (profile << 6) | (rateIndex << 2) | (channels >> 2);
        frame[3] = ((channels & 3) << 6) | (length >> 11);
        frame[4] = (length >> 3) & 0xff;
        frame[5] = ((length & 7) << 5) | 0x1f;
        frame[6] = 0xfc;
        frame.set(data.subarray(offset, offset + size), 7);
        frames.push(frame);
        offset += size;
      }
    }
  }
  if (!frames.length) return undefined;
  const out = new Uint8Array(frames.reduce((sum, it) => sum + it.length, 0));
  let at = 0;
  for (const frame of frames) {
    out.set(frame, at);
    at += frame.length;
  }
  // AAC: 1024 samples per frame.
  return { data: out, seconds: (frames.length * 1024) / rate };
};

class AudioTap {
  private readonly tracks = new WeakMap<SourceBuffer, Track>();
  /** The audio track that was appended to last (the playing song). */
  private current?: Track;

  install() {
    const sources = [
      (window as unknown as { ManagedMediaSource?: typeof MediaSource })
        .ManagedMediaSource,
      window.MediaSource,
    ];
    for (const Source of new Set(sources)) {
      if (Source) this.hook(Source);
    }
  }

  private hook(Source: typeof MediaSource) {
    const tap = this;
    const addSourceBuffer = Source.prototype.addSourceBuffer;
    Source.prototype.addSourceBuffer = function (mime: string) {
      const buffer = addSourceBuffer.call(this, mime);
      if (mime.startsWith('audio/mp4')) {
        tap.tracks.set(buffer, { timescale: 0, fragments: [] });
        const append = buffer.appendBuffer;
        buffer.appendBuffer = function (data: BufferSource) {
          try {
            tap.add(buffer, data);
          } catch (err) {
            console.warn('[ytmr tap]', err);
          }
          return append.call(this, data);
        };
      }
      return buffer;
    };
  }

  private add(buffer: SourceBuffer, source: BufferSource) {
    const track = this.tracks.get(buffer);
    if (!track) return;
    let data =
      source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    // The player appends a fragment in pieces: the rest of the last one.
    const open = track.open;
    if (open && open.missing > 0) {
      const take = Math.min(open.missing, data.byteLength);
      const merged = new Uint8Array(open.fragment.data.byteLength + take);
      merged.set(open.fragment.data);
      merged.set(data.subarray(0, take), open.fragment.data.byteLength);
      open.fragment.data = merged;
      open.missing -= take;
      data = data.subarray(take);
      if (!data.byteLength) return;
    }
    const top = boxes(data);
    const moov = top.find((box) => box.type === 'moov');
    const firstMoof = top.find((box) => box.type === 'moof');
    if (moov) {
      track.init = data.slice(0, firstMoof ? firstMoof.at : data.byteLength);
      track.timescale = timescaleOf(track.init) ?? track.timescale;
    }
    if (!track.timescale) return;
    track.open = undefined;
    for (let i = 0; i < top.length; i++) {
      const moof = top[i];
      if (moof.type !== 'moof') continue;
      const mdat = top.slice(i + 1).find((box) => box.type === 'mdat');
      const end = mdat ? mdat.at + mdat.size : moof.at + moof.size;
      const time = decodeTimeOf(data, moof.at, moof.size);
      if (time === undefined) continue;
      const start = time / track.timescale + buffer.timestampOffset;
      const fragment = {
        start,
        data: data.slice(moof.at, Math.min(end, data.byteLength)),
      };
      // Appended again (after a seek): replace.
      track.fragments = track.fragments.filter(
        (it) => Math.abs(it.start - start) > 0.001,
      );
      track.fragments.push(fragment);
      if (end > data.byteLength) {
        track.open = { fragment, missing: end - data.byteLength };
      }
    }
    track.fragments.sort((a, b) => a.start - b.start);
    const now = document.querySelector('video')?.currentTime ?? 0;
    while (
      track.fragments.length > MAX_FRAGMENTS ||
      (track.fragments.length > 1 && track.fragments[1].start < now - KEEP_BEHIND)
    ) {
      track.fragments.shift();
    }
    this.current = track;
  }

  /**
   * The playing song's audio from `from` to `to` (media seconds), as ADTS
   * (raw AAC frames, each with a small header: a stream any decoder
   * reads) and the media time it starts at, if that part has been loaded.
   */
  window(from: number, to: number) {
    const track = this.current;
    if (!track?.init) return undefined;
    const list = track.fragments;
    let first = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i].start <= from) first = i;
    }
    if (first < 0) return undefined;
    const picked = [list[first]];
    for (let i = first + 1; i < list.length && list[i].start < to; i++) {
      picked.push(list[i]);
    }
    const adts = toAdts(track.init, picked);
    // Only what has really been loaded counts (a fragment may be partial).
    if (!adts || picked[0].start + adts.seconds < to - 0.05) return undefined;
    return { data: adts.data, start: picked[0].start };
  }

  /** TEMPORARY: the playing song's fragments, for the log. */
  describe() {
    const list = this.current?.fragments ?? [];
    return `init=${Boolean(this.current?.init)} n=${list.length} ${list
      .slice(0, 3)
      .map((it) => it.start.toFixed(2))
      .join(',')}…${list.at(-1)?.start.toFixed(2) ?? ''}`;
  }

  /** Whether `from`…`to` of the playing song has been loaded. */
  has(from: number, to: number) {
    return this.window(from, to) !== undefined;
  }
}

export const tap = new AudioTap();

/** Base64 of bytes (for the message to the app). */
export const base64 = (data: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < data.length; i += 0x8000) {
    binary += String.fromCharCode.apply(
      null,
      data.subarray(i, i + 0x8000) as unknown as number[],
    );
  }
  return btoa(binary);
};
