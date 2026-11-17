"use strict";
(() => {
  // src/innertube.ts
  var sha1 = async (value) => {
    const hash = await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(value)
    );
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  var authorization = async () => {
    const sapisid = /(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/.exec(
      document.cookie
    )?.[1];
    if (!sapisid) return void 0;
    const now = Math.floor(Date.now() / 1e3);
    const hash = await sha1(`${now} ${sapisid} ${location.origin}`);
    return `SAPISIDHASH ${now}_${hash}`;
  };
  var sessionIndex = () => {
    const value = ytcfg.get("SESSION_INDEX");
    return typeof value === "string" || typeof value === "number" ? String(value) : "0";
  };
  var innertube = async (endpoint2, body) => {
    const headers = {
      "content-type": "application/json",
      "x-origin": location.origin,
      "x-goog-authuser": sessionIndex()
    };
    const auth = await authorization();
    if (auth) headers.authorization = auth;
    const response = await fetch(`/youtubei/v1/${endpoint2}?prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ context: ytcfg.get("INNERTUBE_CONTEXT"), ...body })
    });
    if (!response.ok) {
      throw new Error(`YouTube Music API ${endpoint2}: ${response.status}`);
    }
    return await response.json();
  };
  var findAll = (node, key, out = []) => {
    if (Array.isArray(node)) {
      for (const item of node) findAll(item, key, out);
    } else if (node && typeof node === "object") {
      for (const [name, value] of Object.entries(node)) {
        if (name === key) out.push(value);
        else findAll(value, key, out);
      }
    }
    return out;
  };
  var text = (value) => {
    const node = value;
    return node?.runs?.map((run) => run.text ?? "").join("") ?? node?.simpleText ?? "";
  };
  var thumbnailOf = (node) => {
    const list = findAll(node, "thumbnails")[0];
    return list?.[0]?.url;
  };
  var DURATION = /^\d+:\d{2}(:\d{2})?$/;
  var parseTracks = (json) => {
    const tracks = [];
    for (const raw of findAll(json, "musicResponsiveListItemRenderer")) {
      const item = raw;
      const columns = (item.flexColumns ?? []).map(
        (column) => text(
          column.musicResponsiveListItemFlexColumnRenderer?.text
        )
      );
      const watch = findAll(
        [item.playlistItemData, item.flexColumns, item.overlay],
        "videoId"
      );
      const videoId = watch.find((id) => typeof id === "string");
      if (!videoId) continue;
      const fixed = text(
        item.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text
      );
      const parts2 = columns.slice(1).filter(Boolean).join(" \u2022 ");
      const duration = fixed || parts2.split(" \u2022 ").map((part) => part.trim()).find((part) => DURATION.test(part));
      tracks.push({
        videoId,
        title: columns[0] ?? "",
        subtitle: parts2,
        duration: duration || void 0,
        thumbnail: thumbnailOf(item.thumbnail)
      });
    }
    return tracks;
  };
  var parseContinuation = (json) => {
    const command = findAll(json, "continuationCommand")[0];
    if (command?.token) return command.token;
    const next = findAll(json, "nextContinuationData")[0];
    return next?.continuation;
  };

  // src/pages.ts
  var SHUFFLE_PARAMS = "wAEB8gECKAE%3D";
  var text2 = (value) => {
    const node = value;
    return node?.runs?.map((run) => run.text ?? "").join("") ?? node?.simpleText ?? "";
  };
  var get = (node, ...path) => {
    let current = node;
    for (const key of path) {
      if (!current || typeof current !== "object") return void 0;
      current = current[key];
    }
    return current;
  };
  var thumbnail = (node, min) => {
    const lists = findAll(node, "thumbnails");
    const list = lists?.[0];
    if (!list?.length) return void 0;
    const sorted = [...list].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
    const url = (sorted.find((it) => (it.width ?? 0) >= min) ?? sorted.at(-1))?.url;
    return url?.startsWith("//") ? `https:${url}` : url;
  };
  var pageKinds = {
    MUSIC_PAGE_TYPE_ALBUM: "album",
    MUSIC_PAGE_TYPE_AUDIOBOOK: "album",
    MUSIC_PAGE_TYPE_PLAYLIST: "playlist",
    MUSIC_PAGE_TYPE_ARTIST: "artist",
    MUSIC_PAGE_TYPE_USER_CHANNEL: "profile",
    MUSIC_PAGE_TYPE_LIBRARY_ARTIST: "artist",
    MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE: "podcast",
    MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE: "episode"
  };
  var pageKind = (endpoint2) => {
    const type2 = get(
      endpoint2,
      "browseEndpoint",
      "browseEndpointContextSupportedConfigs",
      "browseEndpointContextMusicConfig",
      "pageType"
    );
    return typeof type2 === "string" && pageKinds[type2] || "page";
  };
  var watchKind = (endpoint2) => {
    const type2 = get(
      endpoint2,
      "watchEndpoint",
      "watchEndpointMusicSupportedConfigs",
      "watchEndpointMusicConfig",
      "musicVideoType"
    );
    if (type2 === "MUSIC_VIDEO_TYPE_PODCAST_EPISODE") return "episode";
    return type2 === "MUSIC_VIDEO_TYPE_ATV" ? "song" : "video";
  };
  var endpoint = (node, ...keys) => {
    for (const key of keys) {
      const value = get(node, key);
      if (value) return JSON.stringify({ [key]: value });
    }
    return void 0;
  };
  var playEndpoint = (node) => endpoint(node, "watchEndpoint", "watchPlaylistEndpoint");
  var openEndpoint = (node) => endpoint(node, "browseEndpoint", "searchEndpoint");
  var DURATION2 = /^\d+:\d{2}(:\d{2})?$/;
  var listItem = (item) => {
    const columns = (item.flexColumns ?? []).map(
      (column) => get(column, "musicResponsiveListItemFlexColumnRenderer", "text")
    );
    const title = text2(columns[0]);
    const details = columns.slice(1).map(text2).filter(Boolean).join(" \u2022 ");
    const fixed = text2(
      get(
        item.fixedColumns?.[0],
        "musicResponsiveListItemFixedColumnRenderer",
        "text"
      )
    );
    const parts2 = details.split(" \u2022 ").map((part) => part.trim());
    const duration = fixed || parts2.find((part) => DURATION2.test(part));
    const subtitle = parts2.filter((part) => part && part !== duration).join(" \u2022 ");
    const overlayPlay = get(
      item.overlay,
      "musicItemThumbnailOverlayRenderer",
      "content",
      "musicPlayButtonRenderer",
      "playNavigationEndpoint"
    );
    const videoId = findAll([item.playlistItemData, overlayPlay, columns[0]], "videoId").find((id) => typeof id === "string");
    const titleEndpoint = get(
      columns[0]?.runs?.[0],
      "navigationEndpoint"
    );
    const open = openEndpoint(item.navigationEndpoint);
    if (videoId && !open) {
      const play = playEndpoint(overlayPlay) ?? playEndpoint(titleEndpoint) ?? JSON.stringify({ watchEndpoint: { videoId } });
      return {
        kind: watchKind(overlayPlay ?? titleEndpoint),
        title,
        subtitle,
        thumbnail: thumbnail(item.thumbnail, 96),
        wide: false,
        videoId,
        duration,
        play
      };
    }
    if (!open || !title) return void 0;
    return {
      kind: pageKind(item.navigationEndpoint),
      title,
      subtitle,
      thumbnail: thumbnail(item.thumbnail, 96),
      wide: false,
      duration,
      open,
      play: playEndpoint(overlayPlay)
    };
  };
  var cardItem = (item) => {
    const navigation = item.navigationEndpoint;
    const overlayPlay = get(
      item.thumbnailOverlay,
      "musicItemThumbnailOverlayRenderer",
      "content",
      "musicPlayButtonRenderer",
      "playNavigationEndpoint"
    );
    const title = text2(item.title);
    if (!title) return void 0;
    const wide = item.aspectRatio === "MUSIC_TWO_ROW_ITEM_THUMBNAIL_ASPECT_RATIO_RECTANGLE_16_9";
    const watch = get(navigation, "watchEndpoint");
    if (watch) {
      return {
        kind: watchKind(navigation),
        title,
        subtitle: text2(item.subtitle),
        thumbnail: thumbnail(item.thumbnailRenderer, 226),
        wide,
        videoId: typeof watch.videoId === "string" ? watch.videoId : void 0,
        play: playEndpoint(navigation)
      };
    }
    const open = openEndpoint(navigation);
    const play = playEndpoint(overlayPlay);
    if (!open && !play) return void 0;
    return {
      kind: pageKind(navigation),
      title,
      subtitle: text2(item.subtitle),
      thumbnail: thumbnail(item.thumbnailRenderer, 226),
      wide,
      open,
      play
    };
  };
  var navigationButton = (item) => {
    const open = openEndpoint(item.clickCommand);
    const title = text2(item.buttonText);
    if (!open || !title) return void 0;
    return { kind: "page", title, subtitle: "", wide: false, open };
  };
  var items = (contents) => {
    const out = [];
    for (const entry of contents ?? []) {
      const list = entry.musicResponsiveListItemRenderer;
      const card = entry.musicTwoRowItemRenderer;
      const button = entry.musicNavigationButtonRenderer;
      const item = (list && listItem(list)) ?? (card && cardItem(card)) ?? (button && navigationButton(button));
      if (item) out.push(item);
    }
    return out;
  };
  var moreEndpoint = (node) => openEndpoint(
    get(
      node,
      "header",
      "musicCarouselShelfBasicHeaderRenderer",
      "moreContentButton",
      "buttonRenderer",
      "navigationEndpoint"
    )
  ) ?? openEndpoint(get(node, "bottomEndpoint"));
  var topResult = (card) => {
    const navigation = card.onTap ?? get(card, "title", "runs", "0", "navigationEndpoint");
    const main = {
      kind: get(navigation, "watchEndpoint") ? watchKind(navigation) : pageKind(navigation),
      title: text2(card.title),
      subtitle: text2(card.subtitle),
      thumbnail: thumbnail(card.thumbnail, 226),
      wide: false,
      play: playEndpoint(navigation),
      open: openEndpoint(navigation),
      videoId: get(navigation, "watchEndpoint", "videoId")
    };
    return {
      title: text2(get(card, "header", "musicCardShelfHeaderBasicRenderer", "title")),
      style: "list",
      items: [main, ...items(card.contents)].filter((it) => it.title)
    };
  };
  var SECTION_KEYS = [
    "musicCarouselShelfRenderer",
    "musicShelfRenderer",
    "musicPlaylistShelfRenderer",
    "gridRenderer",
    "musicCardShelfRenderer"
  ];
  var section = (key, node) => {
    switch (key) {
      case "musicCarouselShelfRenderer": {
        const list = items(node.contents);
        const title = text2(
          get(node, "header", "musicCarouselShelfBasicHeaderRenderer", "title")
        );
        const rows = list.every((it) => it.videoId && !it.wide) && node.contents?.[0]?.musicResponsiveListItemRenderer;
        return { title, style: rows ? "list" : "carousel", items: list, more: moreEndpoint(node) };
      }
      case "musicShelfRenderer":
      case "musicPlaylistShelfRenderer":
        return {
          title: text2(node.title) || void 0,
          style: "list",
          items: items(node.contents),
          more: moreEndpoint(node)
        };
      case "gridRenderer":
        return {
          title: text2(get(node, "header", "gridHeaderRenderer", "title")) || void 0,
          style: "grid",
          items: items(node.items)
        };
      case "musicCardShelfRenderer":
        return topResult(node);
      default:
        return void 0;
    }
  };
  var HEADER_KEYS = [
    "musicResponsiveHeaderRenderer",
    "musicImmersiveHeaderRenderer",
    "musicVisualHeaderRenderer",
    "musicDetailHeaderRenderer"
  ];
  var header = (json, browseId) => {
    for (const key of HEADER_KEYS) {
      const node = findAll(json, key)[0];
      if (!node) continue;
      const artist = key !== "musicResponsiveHeaderRenderer" && key !== "musicDetailHeaderRenderer";
      const watch = findAll(node, "watchPlaylistEndpoint")[0] ?? void 0;
      const listId = (browseId?.startsWith("VL") ? browseId.slice(2) : void 0) ?? findAll(node, "playlistId").find((id) => typeof id === "string");
      const play = artist ? watch && JSON.stringify({ watchPlaylistEndpoint: watch }) : listId && JSON.stringify({ watchPlaylistEndpoint: { playlistId: listId } });
      const shuffle = !artist && listId ? JSON.stringify({
        watchPlaylistEndpoint: { playlistId: listId, params: SHUFFLE_PARAMS }
      }) : void 0;
      return {
        title: text2(node.title),
        subtitle: text2(node.subtitle),
        secondSubtitle: text2(node.secondSubtitle),
        strapline: text2(node.straplineTextOne) || void 0,
        thumbnail: thumbnail(node.thumbnail ?? node.foregroundThumbnail, 400),
        round: artist,
        play,
        shuffle
      };
    }
    return void 0;
  };
  var continuation = (json) => {
    const command = findAll(json, "continuationCommand")[0];
    if (command?.token) return command.token;
    const next = findAll(json, "nextContinuationData")[0];
    return next?.continuation;
  };
  var merged = /* @__PURE__ */ new WeakSet();
  var itemSection = (node, page) => {
    const rows = items(node.contents);
    if (!rows.length) return;
    const last = page.sections.at(-1);
    if (last && merged.has(last)) {
      last.items.push(...rows);
      return;
    }
    const created = { style: "list", items: rows };
    merged.add(created);
    page.sections.push(created);
  };
  var chip = (node) => {
    const open = openEndpoint(node.navigationEndpoint);
    const title = text2(node.text);
    if (!open || !title) return void 0;
    return { title, selected: node.isSelected === true, open };
  };
  var collect = (node, page) => {
    if (Array.isArray(node)) {
      for (const entry of node) collect(entry, page);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (SECTION_KEYS.includes(key)) {
        const found = section(key, value);
        if (found && found.items.length) page.sections.push(found);
      } else if (key === "itemSectionRenderer") {
        itemSection(value, page);
      } else if (key === "chipCloudChipRenderer") {
        const found = chip(value);
        if (found) page.chips.push(found);
      } else if (key === "musicResponsiveListItemRenderer") {
        const item = listItem(value);
        if (item) page.items.push(item);
      } else if (key === "musicTwoRowItemRenderer") {
        const item = cardItem(value);
        if (item) page.items.push(item);
      } else if (!HEADER_KEYS.includes(key) && key !== "microformat") {
        collect(value, page);
      }
    }
  };
  var parsePage = (json, browseId) => {
    const page = { sections: [], items: [], chips: [] };
    page.header = header(json, browseId);
    collect(json, page);
    page.continuation = continuation(json);
    return page;
  };

  // src/tap.ts
  var KEEP_BEHIND = 30;
  var MAX_FRAGMENTS = 400;
  var type = (data, at) => String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7]);
  var size = (view, at) => {
    const small = view.getUint32(at);
    return small === 1 ? Number(view.getBigUint64(at + 8)) : small || view.byteLength - at;
  };
  var boxes = (data, from = 0, to = data.byteLength) => {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const found = [];
    let at = from;
    while (at + 8 <= to) {
      const length = size(view, at);
      if (length < 8) break;
      found.push({ type: type(data, at), at, size: length });
      at += length;
    }
    return found;
  };
  var header2 = (data, at) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at) === 1 ? 16 : 8;
  var find = (data, path, from = 0, to = data.byteLength) => {
    const [name, ...rest] = path;
    const box = boxes(data, from, to).find((it) => it.type === name);
    if (!box) return void 0;
    if (!rest.length) return box;
    return find(data, rest, box.at + header2(data, box.at), box.at + box.size);
  };
  var timescaleOf = (init) => {
    const mdhd = find(init, ["moov", "trak", "mdia", "mdhd"]);
    if (!mdhd) return void 0;
    const view = new DataView(init.buffer, init.byteOffset, init.byteLength);
    const body = mdhd.at + header2(init, mdhd.at);
    const version = init[body];
    return view.getUint32(body + (version === 1 ? 20 : 12));
  };
  var decodeTimeOf = (data, moofAt, moofSize) => {
    const tfdt = find(data, ["traf", "tfdt"], moofAt + header2(data, moofAt), moofAt + moofSize);
    if (!tfdt) return void 0;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const body = tfdt.at + header2(data, tfdt.at);
    return data[body] === 1 ? Number(view.getBigUint64(body + 4)) : view.getUint32(body + 4);
  };
  var RATES = [
    96e3,
    88200,
    64e3,
    48e3,
    44100,
    32e3,
    24e3,
    22050,
    16e3,
    12e3,
    11025,
    8e3
  ];
  var toAdts = (init, fragments) => {
    const mdhd = find(init, ["moov", "trak", "mdia", "mdhd"]);
    const mp4a = find(init, ["moov", "trak", "mdia", "minf", "stbl", "stsd"]);
    if (!mdhd || !mp4a) return void 0;
    const initView = new DataView(init.buffer, init.byteOffset, init.byteLength);
    const rate = timescaleOf(init) ?? 48e3;
    const entry = mp4a.at + header2(init, mp4a.at) + 8;
    const channels = initView.getUint16(entry + 8 + 16) || 2;
    const rateIndex = Math.max(0, RATES.indexOf(rate));
    const profile = 1;
    const frames = [];
    for (const fragment of fragments) {
      const data = fragment.data;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const top = boxes(data);
      for (let b = 0; b < top.length; b++) {
        const moof = top[b];
        if (moof.type !== "moof") continue;
        const mdat = top.slice(b + 1).find((box) => box.type === "mdat");
        const inside = moof.at + header2(data, moof.at);
        const traf = find(data, ["traf"], inside, moof.at + moof.size);
        if (!traf || !mdat) continue;
        const trafInside = traf.at + header2(data, traf.at);
        const tfhd = find(data, ["tfhd"], trafInside, traf.at + traf.size);
        const trun = find(data, ["trun"], trafInside, traf.at + traf.size);
        if (!tfhd || !trun) continue;
        let at2 = tfhd.at + 8;
        const tfhdFlags = view.getUint32(at2) & 16777215;
        at2 += 8;
        if (tfhdFlags & 1) at2 += 8;
        if (tfhdFlags & 2) at2 += 4;
        if (tfhdFlags & 8) at2 += 4;
        const defaultSize = tfhdFlags & 16 ? view.getUint32(at2) : 0;
        at2 = trun.at + 8;
        const flags = view.getUint32(at2) & 16777215;
        const count = view.getUint32(at2 + 4);
        at2 += 8;
        let offset = mdat.at + header2(data, mdat.at);
        if (flags & 1) {
          offset = moof.at + view.getInt32(at2);
          at2 += 4;
        }
        if (flags & 4) at2 += 4;
        for (let i = 0; i < count; i++) {
          if (flags & 256) at2 += 4;
          let size2 = defaultSize;
          if (flags & 512) {
            size2 = view.getUint32(at2);
            at2 += 4;
          }
          if (flags & 1024) at2 += 4;
          if (flags & 2048) at2 += 4;
          if (!size2 || offset + size2 > data.byteLength) break;
          const length = size2 + 7;
          const frame = new Uint8Array(length);
          frame[0] = 255;
          frame[1] = 241;
          frame[2] = profile << 6 | rateIndex << 2 | channels >> 2;
          frame[3] = (channels & 3) << 6 | length >> 11;
          frame[4] = length >> 3 & 255;
          frame[5] = (length & 7) << 5 | 31;
          frame[6] = 252;
          frame.set(data.subarray(offset, offset + size2), 7);
          frames.push(frame);
          offset += size2;
        }
      }
    }
    if (!frames.length) return void 0;
    const out = new Uint8Array(frames.reduce((sum, it) => sum + it.length, 0));
    let at = 0;
    for (const frame of frames) {
      out.set(frame, at);
      at += frame.length;
    }
    return { data: out, seconds: frames.length * 1024 / rate };
  };
  var AudioTap = class {
    tracks = /* @__PURE__ */ new WeakMap();
    /** The audio track that was appended to last (the playing song). */
    current;
    install() {
      const sources = [
        window.ManagedMediaSource,
        window.MediaSource
      ];
      for (const Source of new Set(sources)) {
        if (Source) this.hook(Source);
      }
    }
    hook(Source) {
      const tap2 = this;
      const addSourceBuffer = Source.prototype.addSourceBuffer;
      Source.prototype.addSourceBuffer = function(mime) {
        const buffer = addSourceBuffer.call(this, mime);
        if (mime.startsWith("audio/mp4")) {
          tap2.tracks.set(buffer, { timescale: 0, fragments: [] });
          const append = buffer.appendBuffer;
          buffer.appendBuffer = function(data) {
            try {
              tap2.add(buffer, data);
            } catch (err) {
              console.warn("[ytmr tap]", err);
            }
            return append.call(this, data);
          };
        }
        return buffer;
      };
    }
    add(buffer, source) {
      const track = this.tracks.get(buffer);
      if (!track) return;
      let data = source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      const open = track.open;
      if (open && open.missing > 0) {
        const take = Math.min(open.missing, data.byteLength);
        const merged2 = new Uint8Array(open.fragment.data.byteLength + take);
        merged2.set(open.fragment.data);
        merged2.set(data.subarray(0, take), open.fragment.data.byteLength);
        open.fragment.data = merged2;
        open.missing -= take;
        data = data.subarray(take);
        if (!data.byteLength) return;
      }
      const top = boxes(data);
      const moov = top.find((box) => box.type === "moov");
      const firstMoof = top.find((box) => box.type === "moof");
      if (moov) {
        track.init = data.slice(0, firstMoof ? firstMoof.at : data.byteLength);
        track.timescale = timescaleOf(track.init) ?? track.timescale;
      }
      if (!track.timescale) return;
      track.open = void 0;
      for (let i = 0; i < top.length; i++) {
        const moof = top[i];
        if (moof.type !== "moof") continue;
        const mdat = top.slice(i + 1).find((box) => box.type === "mdat");
        const end = mdat ? mdat.at + mdat.size : moof.at + moof.size;
        const time = decodeTimeOf(data, moof.at, moof.size);
        if (time === void 0) continue;
        const start = time / track.timescale + buffer.timestampOffset;
        const fragment = {
          start,
          data: data.slice(moof.at, Math.min(end, data.byteLength))
        };
        track.fragments = track.fragments.filter(
          (it) => Math.abs(it.start - start) > 1e-3
        );
        track.fragments.push(fragment);
        if (end > data.byteLength) {
          track.open = { fragment, missing: end - data.byteLength };
        }
      }
      track.fragments.sort((a, b) => a.start - b.start);
      const now = document.querySelector("video")?.currentTime ?? 0;
      while (track.fragments.length > MAX_FRAGMENTS || track.fragments.length > 1 && track.fragments[1].start < now - KEEP_BEHIND) {
        track.fragments.shift();
      }
      this.current = track;
    }
    /**
     * The playing song's audio from `from` to `to` (media seconds), as ADTS
     * (raw AAC frames, each with a small header: a stream any decoder
     * reads) and the media time it starts at, if that part has been loaded.
     */
    window(from, to) {
      const track = this.current;
      if (!track?.init) return void 0;
      const list = track.fragments;
      let first = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].start <= from) first = i;
      }
      if (first < 0) return void 0;
      const picked = [list[first]];
      for (let i = first + 1; i < list.length && list[i].start < to; i++) {
        picked.push(list[i]);
      }
      const adts = toAdts(track.init, picked);
      if (!adts || picked[0].start + adts.seconds < to - 0.05) return void 0;
      return { data: adts.data, start: picked[0].start };
    }
    /** TEMPORARY: the playing song's fragments, for the log. */
    describe() {
      const list = this.current?.fragments ?? [];
      return `init=${Boolean(this.current?.init)} n=${list.length} ${list.slice(0, 3).map((it) => it.start.toFixed(2)).join(",")}\u2026${list.at(-1)?.start.toFixed(2) ?? ""}`;
    }
    /** Whether `from`…`to` of the playing song has been loaded. */
    has(from, to) {
      return this.window(from, to) !== void 0;
    }
  };
  var tap = new AudioTap();
  var base64 = (data) => {
    let binary = "";
    for (let i = 0; i < data.length; i += 32768) {
      binary += String.fromCharCode.apply(
        null,
        data.subarray(i, i + 32768)
      );
    }
    return btoa(binary);
  };

  // src/crossfade.ts
  var api = () => document.getElementById("movie_player");
  var video = () => document.querySelector("video");
  var setMuted = (muted) => {
    const player = api();
    if (muted) player?.mute?.();
    else player?.unMute?.();
    const media = video();
    if (media) media.muted = muted;
  };
  var post = (message) => window.webkit?.messageHandlers?.ytmrFade?.postMessage(JSON.stringify(message));
  var log = (text4) => post({ phase: "log", id: 0, text: text4 });
  var SPARE = 6;
  var LEAD = 2.5;
  var START_TIMEOUT = 3e3;
  var NEXT_TIMEOUT = 8e3;
  var Crossfade = class {
    config = {
      enabled: false,
      autoEnabled: true,
      autoDuration: 5,
      manualEnabled: true,
      manualDuration: 5
    };
    /** A crossfade in progress. */
    fade;
    ids = 0;
    /** Song (and start) the automatic crossfade already ran for. */
    autoDoneFor;
    /** Where the playing song (or its chosen part) ends. */
    partEnd = () => void 0;
    constructor() {
      document.addEventListener("timeupdate", this.onTimeUpdate, true);
    }
    get busy() {
      return this.fade !== void 0;
    }
    /**
     * Change the song with a crossfade (if on): `action` runs once the app
     * plays the leaving song's end.
     */
    leave(action, kind, end) {
      const config = this.config;
      const on = config.enabled && (kind === "auto" ? config.autoEnabled : config.manualEnabled);
      const media = video();
      if (!on || this.fade || !media || media.paused) {
        action();
        return;
      }
      const duration = kind === "auto" ? config.autoDuration : config.manualDuration;
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
        started: false
      };
      const longest = tap.window(from, to) ?? audio;
      post({
        phase: "out",
        id,
        data: base64(longest.data),
        start: longest.start,
        at: media.currentTime,
        sentAt: Date.now(),
        until: to,
        duration
      });
      setTimeout(() => {
        if (this.fade?.id === id && !this.fade.started) this.cancel();
      }, START_TIMEOUT);
    }
    /** The app plays the leaving song: mute the player and move on. */
    outStarted(id) {
      const fade = this.fade;
      if (fade?.id !== id || fade.started) return false;
      fade.started = true;
      setMuted(true);
      log("muted");
      fade.action();
      this.waitForNext(fade.id, fade.from, fade.duration).catch(() => this.cancel());
      return true;
    }
    /** The fade is over: the player plays the new song from here on. */
    done(id) {
      if (this.fade?.id !== id) return false;
      this.fade = void 0;
      setMuted(false);
      post({ phase: "unmuted", id });
      setTimeout(() => {
        if (!this.fade && video()?.muted) {
          log("still muted after the fade: unmuting again");
          setMuted(false);
        }
      }, 500);
      return true;
    }
    /** Give up: the player plays (unmuted) and the app fades out alone. */
    cancel() {
      const fade = this.fade;
      this.fade = void 0;
      setMuted(false);
      if (fade && !fade.started) fade.action();
      if (fade) post({ phase: "cancel", id: fade.id });
    }
    /** Once the next song plays and its start is loaded, hand it over. */
    async waitForNext(id, from, duration) {
      const until = performance.now() + NEXT_TIMEOUT;
      let settledAt;
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
          phase: "in",
          id,
          data: base64(audio.data),
          start: audio.start,
          at: media.currentTime,
          sentAt: Date.now(),
          duration
        });
        return;
      }
      log("next: timed out");
      this.cancel();
    }
    lastLog = 0;
    /** Automatic crossfade near the end of the song (or of its part). */
    onTimeUpdate = (event) => {
      if (!(event.target instanceof HTMLMediaElement)) return;
      const config = this.config;
      if (!config.enabled || !config.autoEnabled || this.fade) return;
      const media = event.target;
      const player = api();
      const videoId = player?.getVideoData()?.video_id;
      if (!player || !videoId || media.paused) return;
      const duration = player.getDuration();
      if (!(duration > 0)) return;
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
        () => document.querySelector(".next-button")?.click(),
        "auto",
        end
      );
    };
  };
  var crossfade = new Crossfade();

  // src/best-part.ts
  var INTRO = 15;
  var STEP = 5;
  var OUTRO = 4;
  var graphs = /* @__PURE__ */ new Map();
  var fetchGraph = async (videoId) => {
    const response = await fetch(
      "https://www.youtube.com/youtubei/v1/next?prettyPrint=false",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "WEB",
              clientVersion: "2.20251101.00.00",
              hl: "en"
            }
          },
          videoId
        })
      }
    );
    if (!response.ok) return void 0;
    let markers = [];
    const walk = (node) => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
      } else if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          const list = value?.markersList;
          if (key === "macroMarkersListEntity" && list?.markerType === "MARKER_TYPE_HEATMAP") {
            markers = list.markers ?? [];
          } else {
            walk(value);
          }
        }
      }
    };
    walk(await response.json());
    return markers.length ? markers.map((marker) => ({
      at: Number(marker.startMillis) / 1e3,
      value: marker.intensityScoreNormalized ?? 0
    })) : void 0;
  };
  var loadReplayGraph = (videoId) => {
    let graph = graphs.get(videoId);
    if (!graph) {
      graph = fetchGraph(videoId).catch(() => void 0);
      graphs.set(videoId, graph);
    }
    return graph;
  };
  var bestPartStart = (graph, length, seconds2) => {
    if (seconds2 >= length - INTRO - OUTRO) return 0;
    const body = graph.filter((point) => point.at >= INTRO);
    if (body.length < 2) return 0;
    const meanAt = body.reduce((sum, point) => sum + point.at, 0) / body.length;
    const meanValue = body.reduce((sum, point) => sum + point.value, 0) / body.length;
    let covariance = 0;
    let spread = 0;
    for (const point of body) {
      const offset = point.at - meanAt;
      covariance += offset * (point.value - meanValue);
      spread += offset * offset;
    }
    const slope = spread ? covariance / spread : 0;
    const above = body.map((point) => {
      const drift = slope * (point.at - meanAt);
      const trend = meanValue + drift;
      return { at: point.at, value: point.value - trend };
    });
    let best = INTRO;
    let bestScore = -Infinity;
    for (let start = INTRO; start + seconds2 <= length - OUTRO; start += STEP) {
      const end = start + seconds2;
      let score = 0;
      for (const point of above) {
        if (point.at >= start && point.at < end) score += point.value;
      }
      if (score > bestScore) {
        bestScore = score;
        best = start;
      }
    }
    return best;
  };

  // src/parts.ts
  var api2 = () => document.getElementById("movie_player");
  var ENSURE_TIMEOUT = 1e4;
  var SETTLE_TIME = 1e3;
  var nearStart = (time, start) => time >= start - 1.5 && time <= start + 10;
  var MAX_SONGS = 50;
  var PARALLEL = 6;
  var QUEUE_WAIT = 4e3;
  var MAX_PAGES = 50;
  var normalizeTitle = (title) => (title ?? "").normalize("NFD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  var wait = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
  var waitFor = async (done, timeout) => {
    const until = performance.now() + timeout;
    while (performance.now() < until) {
      if (done()) return true;
      await wait(100);
    }
    return done();
  };
  var seconds = (duration) => {
    if (!duration) return void 0;
    let total = 0;
    for (const part of duration.split(":")) total = total * 60 + Number(part);
    return Number.isFinite(total) && total > 0 ? total : void 0;
  };
  var shuffled = (items2) => {
    for (let i = items2.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items2[i], items2[j]] = [items2[j], items2[i]];
    }
    return items2;
  };
  var queueEntries = () => [
    ...document.querySelectorAll(
      "ytmusic-player-queue-item"
    )
  ].map(
    (item) => item.closest(
      "ytmusic-playlist-panel-video-wrapper-renderer"
    ) ?? item
  );
  var queueLength = () => document.querySelectorAll("ytmusic-player-queue-item").length;
  var navigate = (endpoint2) => {
    document.querySelector("ytmusic-app")?.dispatchEvent(
      new CustomEvent("yt-navigate", {
        bubbles: true,
        composed: true,
        detail: { endpoint: endpoint2 }
      })
    );
  };
  var songDetails = async (videoId) => {
    const json = await innertube("player", { videoId });
    const details = json.videoDetails ?? {};
    const thumbnails = details.thumbnail?.thumbnails ?? [];
    const largest = thumbnails.reduce(
      (best, it) => !best || it.width > best.width ? it : best,
      void 0
    );
    return {
      title: details.title ?? "",
      artist: details.author ?? "",
      length: Number(details.lengthSeconds) || 0,
      thumbnail: largest?.url
    };
  };
  var bestPart = async (videoId, length, part) => {
    const graph = await loadReplayGraph(videoId);
    if (!graph || !length) return void 0;
    const span = Math.min(part, length);
    const start = bestPartStart(graph, length, span);
    const end = start + span;
    return { start, end: end >= length - 0.5 ? void 0 : end };
  };
  var runPart = async (track, part) => {
    const length = seconds(track.duration);
    if (!length || length <= part + 20) return { start: 0 };
    const graph = await loadReplayGraph(track.videoId);
    const start = graph ? bestPartStart(graph, length, part) : Math.max(15, Math.round(length * 0.45) - Math.round(part / 2));
    return { start, end: Math.min(length, start + part) };
  };
  var playlistTracks = async (playlistId) => {
    const tracks = [];
    let json = await innertube("browse", {
      browseId: `VL${playlistId.replace(/^VL/, "")}`
    });
    for (let page = 0; page < MAX_PAGES; page++) {
      tracks.push(...parseTracks(json));
      const next = parseContinuation(json);
      if (!next) break;
      json = await innertube("browse", { continuation: next });
    }
    return tracks;
  };
  var Parts = class {
    /** Queued songs and the part of them to play. */
    scheduled = /* @__PURE__ */ new Map();
    /** Songs of a best-parts run that haven't played yet, and their titles. */
    bestParts = /* @__PURE__ */ new Set();
    bestPartTitles = /* @__PURE__ */ new Map();
    /** Play now: the next song that starts is the chosen one. */
    playNow;
    /** The playing song's part, once it has started. */
    active;
    lastVideoId;
    cancelEnsure;
    /** Bumped by every best-parts run, so an older one stops. */
    run = 0;
    /** What a best-parts run is doing (for the app), if one is running. */
    task;
    constructor() {
      for (const type2 of ["loadeddata", "playing", "timeupdate"]) {
        document.addEventListener(type2, this.onProgress, true);
      }
    }
    /** The playing song's part, if one was chosen. */
    current() {
      const videoId = api2()?.getVideoData()?.video_id;
      const active = this.active;
      return active && active.videoId === videoId ? { start: active.start, end: active.end } : void 0;
    }
    /** Play `interval` of `videoId` now. */
    play(videoId, interval2) {
      const player = api2();
      if (player?.getVideoData()?.video_id === videoId) {
        this.active = { videoId, ...interval2 };
        player.seekTo(interval2.start, true);
        return;
      }
      this.playNow = { interval: interval2, key: videoId, at: performance.now() };
      navigate({
        watchEndpoint: { videoId, startTimeSeconds: Math.floor(interval2.start) }
      });
    }
    /** "Play next" / "Add to queue", playing only `interval` when it's up. */
    enqueue(videoId, interval2, position) {
      const item = document.createElement(
        "ytmusic-menu-service-item-renderer"
      );
      item.hidden = true;
      document.body.append(item);
      item.data = {
        serviceEndpoint: {
          queueAddEndpoint: {
            queueTarget: { videoId, onEmptyQueue: { watchEndpoint: { videoId } } },
            queueInsertPosition: position
          }
        }
      };
      try {
        item.onTap?.();
      } finally {
        setTimeout(() => item.remove(), 1e3);
      }
      if (interval2.start >= 1 || interval2.end !== void 0) {
        this.scheduled.set(videoId, interval2);
      } else if (!this.bestParts.has(videoId)) {
        this.scheduled.delete(videoId);
      }
    }
    /** Play up to 50 songs of a playlist, each only for its best part. */
    async playBestParts(playlistId, shuffle, part) {
      const run = ++this.run;
      const stale = () => run !== this.run;
      this.task = "Loading songs\u2026";
      try {
        const all = await playlistTracks(playlistId);
        if (stale()) return;
        const unique = [
          ...new Map(all.map((track) => [track.videoId, track])).values()
        ];
        const tracks = (shuffle ? shuffled(unique) : unique).slice(0, MAX_SONGS);
        if (!tracks.length) throw new Error("This playlist is empty");
        const parts2 = /* @__PURE__ */ new Map();
        let done = 0;
        this.task = `Finding best parts\u2026 0/${tracks.length}`;
        const pending = [...tracks];
        const worker = async () => {
          for (let track = pending.shift(); track; track = pending.shift()) {
            const interval2 = await runPart(track, part).catch(() => ({
              start: 0
            }));
            parts2.set(track.videoId, interval2);
            done++;
            if (!stale()) {
              this.task = `Finding best parts\u2026 ${done}/${tracks.length}`;
            }
          }
        };
        await Promise.all(Array.from({ length: PARALLEL }, worker));
        if (stale()) return;
        this.endBestParts();
        for (const track of tracks) {
          this.scheduled.set(track.videoId, parts2.get(track.videoId));
          this.bestParts.add(track.videoId);
          const title = normalizeTitle(track.title);
          if (title) this.bestPartTitles.set(track.videoId, title);
        }
        const [first, ...rest] = tracks;
        this.play(first.videoId, parts2.get(first.videoId));
        await waitFor(
          () => api2()?.getVideoData()?.video_id === first.videoId,
          15e3
        );
        await wait(1e3);
        let queued = 0;
        for (const track of [...rest].reverse()) {
          if (stale()) return;
          this.task = `Queueing\u2026 ${queued}/${rest.length}`;
          const before = queueLength();
          this.enqueue(
            track.videoId,
            parts2.get(track.videoId),
            "INSERT_AFTER_CURRENT_VIDEO"
          );
          await waitFor(() => queueLength() > before, QUEUE_WAIT);
          queued++;
        }
      } finally {
        if (run === this.run) this.task = void 0;
      }
    }
    endBestParts() {
      for (const videoId of this.bestParts) this.scheduled.delete(videoId);
      this.bestParts.clear();
      this.bestPartTitles.clear();
    }
    /**
     * The scheduled entry for the playing song. Songs can play under another
     * id (song vs. music video version): also look at every id in the
     * playing song's queue entry, then at best-parts titles.
     */
    findScheduled(videoId) {
      const direct = this.scheduled.get(videoId);
      if (direct) return { key: videoId, interval: direct };
      if (!this.scheduled.size) return void 0;
      const ids = /* @__PURE__ */ new Set();
      for (const entry of queueEntries()) {
        const json = JSON.stringify(entry.data ?? {});
        if (!json.includes(`"${videoId}"`)) continue;
        for (const match of json.matchAll(/"videoId":"([\w-]+)"/g)) {
          ids.add(match[1]);
        }
      }
      for (const [key, interval2] of this.scheduled) {
        if (ids.has(key)) return { key, interval: interval2 };
      }
      const title = normalizeTitle(api2()?.getVideoData()?.title);
      if (title) {
        for (const key of this.bestParts) {
          const interval2 = this.scheduled.get(key);
          if (interval2 && this.bestPartTitles.get(key) === title) {
            return { key, interval: interval2 };
          }
        }
      }
      return void 0;
    }
    /** Whether a best-parts song that hasn't played yet is still queued. */
    bestPartsQueued() {
      const json = queueEntries().map((entry) => JSON.stringify(entry.data ?? {})).join();
      return [...this.bestParts].some(
        (videoId) => json.includes(`"${videoId}"`)
      );
    }
    /** A song started: jump to its part. While it plays: stop at its end. */
    onProgress = (event) => {
      if (!(event.target instanceof HTMLMediaElement)) return;
      const player = api2();
      const videoId = player?.getVideoData()?.video_id;
      if (!player || !videoId) return;
      if (videoId === this.lastVideoId) {
        this.checkEnd(player, videoId, event.target);
        return;
      }
      if (!(player.getDuration() > 0)) return;
      this.lastVideoId = videoId;
      let found;
      const playNow = this.playNow;
      this.playNow = void 0;
      if (playNow && performance.now() - playNow.at < ENSURE_TIMEOUT) {
        found = playNow;
      } else {
        found = this.findScheduled(videoId);
      }
      if (found) {
        this.active = { videoId, ...found.interval };
      } else if (this.active?.videoId !== videoId) {
        this.active = void 0;
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
    checkEnd(player, videoId, media) {
      const end = this.active?.videoId === videoId ? this.active.end : void 0;
      if (end === void 0 || media.paused) return;
      const time = player.getCurrentTime();
      if (time < end || time > end + 2) return;
      this.active = void 0;
      document.querySelector(".next-button")?.click();
    }
    /**
     * Make the song actually play from `start`: YouTube Music sometimes
     * ignores the start time, so keep checking until it stays there.
     */
    ensurePosition(videoId, start) {
      this.cancelEnsure?.();
      const started = performance.now();
      let settledSince;
      const timer = setInterval(() => {
        const now = performance.now();
        if (now - started > ENSURE_TIMEOUT) {
          this.cancelEnsure?.();
          return;
        }
        const player = api2();
        const media = document.querySelector("video");
        const playing = media && !media.paused && media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
        if (!player || player.getVideoData()?.video_id !== videoId || !playing) {
          return;
        }
        if (!nearStart(player.getCurrentTime(), start)) {
          player.seekTo(start, true);
          settledSince = void 0;
        } else {
          settledSince ??= now;
          if (now - settledSince > SETTLE_TIME) this.cancelEnsure?.();
        }
      }, 50);
      this.cancelEnsure = () => {
        clearInterval(timer);
        this.cancelEnsure = void 0;
      };
    }
  };
  var parts = new Parts();

  // src/search.ts
  var FILTERS = [
    ["EgWKAQIIAW", "songs"],
    ["EgWKAQIgAW", "artists"],
    ["EgWKAQIQAW", "videos"],
    ["EgWKAQIYAW", "albums"],
    ["EgeKAQQoAEAB", "community"],
    ["EgeKAQQoADgB", "featured"],
    ["EgWKAQJYAW", "profiles"],
    ["EgWKAQJIAW", "episodes"],
    ["EgWKAQJQAW", "podcasts"]
  ];
  var filterOf = (open) => {
    const params = JSON.parse(open).searchEndpoint?.params;
    return FILTERS.find(([prefix]) => params?.startsWith(prefix))?.[1];
  };
  var normalize = (value) => value.normalize("NFD").replace(new RegExp("\\p{Diacritic}", "gu"), "").toLowerCase().replace(/\s+/g, " ").trim();
  var ARTISTS = 3;
  var SONGS = 5;
  var arrangeSearch = (page, query) => {
    if (!page.chips.length || page.chips.some((chip2) => chip2.selected)) return page;
    const chips = new Map(
      page.chips.map((chip2) => [filterOf(chip2.open), chip2])
    );
    const all = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of page.sections.flatMap((section2) => section2.items)) {
      const key = item.videoId ?? item.open ?? item.title;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(item);
    }
    const of = (...kinds) => all.filter((item) => kinds.includes(item.kind));
    const shelf = (filter, style, items2, fallback) => {
      if (!items2.length) return void 0;
      const chip2 = chips.get(filter);
      return { title: chip2?.title ?? fallback, style, items: items2, more: chip2?.open };
    };
    const artists = shelf("artists", "cards", of("artist").slice(0, ARTISTS), "Artists");
    const songs = shelf("songs", "list", of("song").slice(0, SONGS), "Songs");
    const wanted = normalize(query);
    const artistSearch = of("artist").some(
      (artist) => normalize(artist.title).includes(wanted)
    );
    const songFirst = !artistSearch;
    const rest = [
      shelf("videos", "carousel", of("video").map((it) => ({ ...it, wide: true })), "Videos"),
      shelf("albums", "carousel", of("album"), "Albums"),
      shelf("community", "carousel", of("playlist"), "Playlists"),
      shelf("podcasts", "carousel", of("podcast"), "Podcasts"),
      shelf("episodes", "list", of("episode"), "Episodes"),
      shelf("profiles", "carousel", of("profile"), "Profiles")
    ];
    const sections = [
      ...songFirst ? [songs, artists] : [artists, songs],
      ...rest
    ].filter((section2) => Boolean(section2));
    return { ...page, sections, items: [] };
  };

  // src/bridge.ts
  tap.install();
  crossfade.partEnd = () => parts.current()?.end;
  var api3 = () => document.getElementById("movie_player");
  var video2 = () => document.querySelector("video");
  var text3 = (value) => {
    const node = value;
    return node?.runs?.map((run) => run.text ?? "").join("") ?? node?.simpleText ?? "";
  };
  var large = (url, size2 = 544) => url?.replace(/=w\d+-h\d+/, `=w${size2}-h${size2}`);
  var str = (params, name) => {
    const value = params[name];
    if (typeof value !== "string" || !value) throw new Error(`Missing "${name}"`);
    return value;
  };
  var num = (params, name) => {
    const value = params[name];
    if (typeof value !== "number") throw new Error(`Missing "${name}"`);
    return value;
  };
  var queueItems = () => [...document.querySelectorAll("ytmusic-player-queue-item")].filter(
    (item) => item.parentElement?.id !== "counterpart-renderer"
  );
  var isCurrent = (item) => {
    const playing = api3()?.getVideoData()?.video_id;
    const versions = [
      item,
      ...item.closest("ytmusic-playlist-panel-video-wrapper-renderer")?.querySelectorAll(
        "#counterpart-renderer ytmusic-player-queue-item"
      ) ?? []
    ];
    return versions.some(
      (version) => version.hasAttribute("selected") && version.data?.videoId === playing
    );
  };
  var navigate2 = (endpoint2) => {
    document.querySelector("ytmusic-app")?.dispatchEvent(
      new CustomEvent("yt-navigate", {
        bubbles: true,
        composed: true,
        detail: { endpoint: endpoint2 }
      })
    );
  };
  var parseEndpoint = (params) => {
    const value = JSON.parse(str(params, "endpoint"));
    if (!value || typeof value !== "object") throw new Error("Bad endpoint");
    return value;
  };
  var clickButton = (selector) => {
    const button = document.querySelector(selector);
    if (!button) throw new Error("The player is not ready yet");
    button.click();
  };
  var currentCover = () => {
    const img = document.querySelector(
      "ytmusic-player-bar img.image, ytmusic-player-bar .thumbnail-image-wrapper img"
    );
    const src = img?.src;
    if (src && !src.startsWith("data:")) return large(src);
    const id = api3()?.getVideoData()?.video_id;
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : void 0;
  };
  var state = () => {
    const player = api3();
    const data = player?.getVideoData();
    const media = video2();
    return {
      ready: Boolean(player),
      loggedIn: ytcfg.get("LOGGED_IN") === true,
      videoId: data?.video_id || void 0,
      title: data?.title || void 0,
      artist: data?.author || void 0,
      cover: data?.video_id ? currentCover() : void 0,
      position: player?.getCurrentTime() ?? 0,
      duration: player?.getDuration() ?? 0,
      paused: media?.paused ?? true,
      part: parts.current(),
      task: parts.task
    };
  };
  var interval = (params) => ({
    start: typeof params.start === "number" ? params.start : 0,
    end: typeof params.end === "number" ? params.end : void 0
  });
  var methods = {
    state,
    /** Search results, as YouTube Music's search page shows them. */
    search: async (params) => arrangeSearch(
      parsePage(await innertube("search", { query: str(params, "query") })),
      str(params, "query")
    ),
    /** Any page from an "open" or "more" endpoint. */
    page: async (params) => {
      const endpoint2 = parseEndpoint(params);
      if (endpoint2.searchEndpoint) {
        return parsePage(await innertube("search", endpoint2.searchEndpoint));
      }
      const browse = endpoint2.browseEndpoint;
      if (!browse || typeof browse.browseId !== "string") {
        throw new Error("This page cannot be opened");
      }
      return parsePage(
        await innertube("browse", {
          browseId: browse.browseId,
          ...typeof browse.params === "string" ? { params: browse.params } : {}
        }),
        browse.browseId
      );
    },
    /** The next part of a page (`search` for search result pages). */
    more: async (params) => parsePage(
      await innertube(params.search === true ? "search" : "browse", {
        continuation: str(params, "continuation")
      })
    ),
    /** Play from a "play" endpoint (a song in its playlist, an album…). */
    playEndpoint: (params) => {
      const endpoint2 = parseEndpoint(params);
      if (!endpoint2.watchEndpoint && !endpoint2.watchPlaylistEndpoint) {
        throw new Error("Nothing to play");
      }
      crossfade.leave(() => navigate2(endpoint2), "manual");
      return true;
    },
    queue: () => queueItems().map((item) => ({
      videoId: item.data?.videoId ?? "",
      title: text3(item.data?.title),
      artist: text3(item.data?.shortBylineText),
      duration: text3(item.data?.lengthText) || void 0,
      thumbnail: thumbnailOf(item.data?.thumbnail),
      current: isCurrent(item)
    })),
    /** Play a song now; YouTube Music fills the queue with its radio. */
    play: (params) => {
      const videoId = str(params, "videoId");
      crossfade.leave(() => navigate2({ watchEndpoint: { videoId } }), "manual");
      return true;
    },
    /** Jump to a song that's already in the queue. */
    playQueueItem: (params) => {
      const item = queueItems()[num(params, "index")];
      const videoId = item?.data?.videoId;
      if (!item || !videoId) throw new Error("That song is no longer queued");
      const endpoint2 = item.data?.navigationEndpoint?.watchEndpoint ?? { videoId };
      crossfade.leave(() => navigate2({ watchEndpoint: endpoint2 }), "manual");
      return true;
    },
    /** "Play next" / "Add to queue" (optionally only a part of the song). */
    enqueue: (params) => {
      parts.enqueue(
        str(params, "videoId"),
        interval(params),
        params.position === "end" ? "INSERT_AT_END" : "INSERT_AFTER_CURRENT_VIDEO"
      );
      return true;
    },
    /** Play part of a song now. */
    playPart: (params) => {
      const videoId = str(params, "videoId");
      const part = interval(params);
      if (api3()?.getVideoData()?.video_id === videoId) parts.play(videoId, part);
      else crossfade.leave(() => parts.play(videoId, part), "manual");
      return true;
    },
    /** Length, title, cover and best `part`-second window of a song. */
    songInfo: async (params) => {
      const videoId = str(params, "videoId");
      const details = await songDetails(videoId);
      const best = await bestPart(videoId, details.length, num(params, "part"));
      return { ...details, best };
    },
    /** "Play best parts" / "Shuffle best parts" of a playlist or album. */
    bestParts: (params) => {
      parts.playBestParts(
        str(params, "playlistId"),
        params.shuffle === true,
        num(params, "part")
      ).catch((err) => {
        parts.task = err instanceof Error ? err.message : String(err);
        setTimeout(() => {
          parts.task = void 0;
        }, 4e3);
      });
      return true;
    },
    next: () => {
      crossfade.leave(() => clickButton(".next-button"), "manual");
      return true;
    },
    previous: () => {
      crossfade.leave(() => clickButton(".previous-button"), "manual");
      return true;
    },
    /** Crossfade settings from the app. */
    crossfadeConfig: (params) => {
      crossfade.config = { ...crossfade.config, ...params };
      return true;
    },
    /** The app plays the leaving song's end (crossfade). */
    fadeOutStarted: (params) => crossfade.outStarted(num(params, "id")),
    /** The crossfade is over. */
    fadeDone: (params) => crossfade.done(num(params, "id")),
    pause: () => {
      api3()?.pauseVideo();
      return true;
    },
    resume: () => {
      api3()?.playVideo();
      return true;
    },
    seek: (params) => {
      api3()?.seekTo(num(params, "seconds"), true);
      return true;
    }
  };
  var handler = () => window.webkit?.messageHandlers?.ytmrState;
  var lastSent = "";
  var lastAt = 0;
  var send = (force = false) => {
    const now = performance.now();
    const current = state();
    const key = JSON.stringify({ ...current, position: 0 });
    if (!force && key === lastSent && now - lastAt < 500) return;
    lastSent = key;
    lastAt = now;
    handler()?.postMessage(JSON.stringify(current));
  };
  for (const type2 of [
    "play",
    "pause",
    "playing",
    "ended",
    "seeked",
    "loadedmetadata",
    "durationchange",
    "timeupdate"
  ]) {
    document.addEventListener(type2, () => send(type2 !== "timeupdate"), true);
  }
  setInterval(() => send(), 1e3);
  window.__ytmr = {
    async call(method, params = {}) {
      const run = methods[method];
      if (!run) return JSON.stringify({ error: `Unknown method: ${method}` });
      try {
        return JSON.stringify({ result: await run(params) });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  };
})();
