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
    const type = get(
      endpoint2,
      "browseEndpoint",
      "browseEndpointContextSupportedConfigs",
      "browseEndpointContextMusicConfig",
      "pageType"
    );
    return typeof type === "string" && pageKinds[type] || "page";
  };
  var watchKind = (endpoint2) => {
    const type = get(
      endpoint2,
      "watchEndpoint",
      "watchEndpointMusicSupportedConfigs",
      "watchEndpointMusicConfig",
      "musicVideoType"
    );
    if (type === "MUSIC_VIDEO_TYPE_PODCAST_EPISODE") return "episode";
    return type === "MUSIC_VIDEO_TYPE_ATV" ? "song" : "video";
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
  var api = () => document.getElementById("movie_player");
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
      for (const type of ["loadeddata", "playing", "timeupdate"]) {
        document.addEventListener(type, this.onProgress, true);
      }
    }
    /** The playing song's part, if one was chosen. */
    current() {
      const videoId = api()?.getVideoData()?.video_id;
      const active = this.active;
      return active && active.videoId === videoId ? { start: active.start, end: active.end } : void 0;
    }
    /** Play `interval` of `videoId` now. */
    play(videoId, interval2) {
      const player = api();
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
          () => api()?.getVideoData()?.video_id === first.videoId,
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
      const title = normalizeTitle(api()?.getVideoData()?.title);
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
      const player = api();
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
        const player = api();
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
  var api2 = () => document.getElementById("movie_player");
  var video = () => document.querySelector("video");
  var text3 = (value) => {
    const node = value;
    return node?.runs?.map((run) => run.text ?? "").join("") ?? node?.simpleText ?? "";
  };
  var large = (url, size = 544) => url?.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);
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
    const playing = api2()?.getVideoData()?.video_id;
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
    const id = api2()?.getVideoData()?.video_id;
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : void 0;
  };
  var state = () => {
    const player = api2();
    const data = player?.getVideoData();
    const media = video();
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
      navigate2(endpoint2);
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
      navigate2({ watchEndpoint: { videoId: str(params, "videoId") } });
      return true;
    },
    /** Jump to a song that's already in the queue. */
    playQueueItem: (params) => {
      const item = queueItems()[num(params, "index")];
      const videoId = item?.data?.videoId;
      if (!item || !videoId) throw new Error("That song is no longer queued");
      navigate2({
        watchEndpoint: item.data?.navigationEndpoint?.watchEndpoint ?? { videoId }
      });
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
      parts.play(str(params, "videoId"), interval(params));
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
      clickButton(".next-button");
      return true;
    },
    previous: () => {
      clickButton(".previous-button");
      return true;
    },
    pause: () => {
      api2()?.pauseVideo();
      return true;
    },
    resume: () => {
      api2()?.playVideo();
      return true;
    },
    seek: (params) => {
      api2()?.seekTo(num(params, "seconds"), true);
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
  for (const type of [
    "play",
    "pause",
    "playing",
    "ended",
    "seeked",
    "loadedmetadata",
    "durationchange",
    "timeupdate"
  ]) {
    document.addEventListener(type, () => send(type !== "timeupdate"), true);
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
