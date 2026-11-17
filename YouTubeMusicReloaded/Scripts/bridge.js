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
  var thumbnailOf = (node) => {
    const list = findAll(node, "thumbnails")[0];
    return list?.[0]?.url;
  };

  // src/pages.ts
  var SHUFFLE_PARAMS = "wAEB8gECKAE%3D";
  var text = (value) => {
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
  var DURATION = /^\d+:\d{2}(:\d{2})?$/;
  var listItem = (item) => {
    const columns = (item.flexColumns ?? []).map(
      (column) => get(column, "musicResponsiveListItemFlexColumnRenderer", "text")
    );
    const title = text(columns[0]);
    const details = columns.slice(1).map(text).filter(Boolean).join(" \u2022 ");
    const fixed = text(
      get(
        item.fixedColumns?.[0],
        "musicResponsiveListItemFixedColumnRenderer",
        "text"
      )
    );
    const parts = details.split(" \u2022 ").map((part) => part.trim());
    const duration = fixed || parts.find((part) => DURATION.test(part));
    const subtitle = parts.filter((part) => part && part !== duration).join(" \u2022 ");
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
    const title = text(item.title);
    if (!title) return void 0;
    const wide = item.aspectRatio === "MUSIC_TWO_ROW_ITEM_THUMBNAIL_ASPECT_RATIO_RECTANGLE_16_9";
    const watch = get(navigation, "watchEndpoint");
    if (watch) {
      return {
        kind: watchKind(navigation),
        title,
        subtitle: text(item.subtitle),
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
      subtitle: text(item.subtitle),
      thumbnail: thumbnail(item.thumbnailRenderer, 226),
      wide,
      open,
      play
    };
  };
  var navigationButton = (item) => {
    const open = openEndpoint(item.clickCommand);
    const title = text(item.buttonText);
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
      title: text(card.title),
      subtitle: text(card.subtitle),
      thumbnail: thumbnail(card.thumbnail, 226),
      wide: false,
      play: playEndpoint(navigation),
      open: openEndpoint(navigation),
      videoId: get(navigation, "watchEndpoint", "videoId")
    };
    return {
      title: text(get(card, "header", "musicCardShelfHeaderBasicRenderer", "title")),
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
        const title = text(
          get(node, "header", "musicCarouselShelfBasicHeaderRenderer", "title")
        );
        const rows = list.every((it) => it.videoId && !it.wide) && node.contents?.[0]?.musicResponsiveListItemRenderer;
        return { title, style: rows ? "list" : "carousel", items: list, more: moreEndpoint(node) };
      }
      case "musicShelfRenderer":
      case "musicPlaylistShelfRenderer":
        return {
          title: text(node.title) || void 0,
          style: "list",
          items: items(node.contents),
          more: moreEndpoint(node)
        };
      case "gridRenderer":
        return {
          title: text(get(node, "header", "gridHeaderRenderer", "title")) || void 0,
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
        title: text(node.title),
        subtitle: text(node.subtitle),
        secondSubtitle: text(node.secondSubtitle),
        strapline: text(node.straplineTextOne) || void 0,
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
    const title = text(node.text);
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
  var api = () => document.getElementById("movie_player");
  var video = () => document.querySelector("video");
  var text2 = (value) => {
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
    const playing = api()?.getVideoData()?.video_id;
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
  var navigate = (endpoint2) => {
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
    const id = api()?.getVideoData()?.video_id;
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : void 0;
  };
  var state = () => {
    const player = api();
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
      paused: media?.paused ?? true
    };
  };
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
      navigate(endpoint2);
      return true;
    },
    queue: () => queueItems().map((item) => ({
      videoId: item.data?.videoId ?? "",
      title: text2(item.data?.title),
      artist: text2(item.data?.shortBylineText),
      duration: text2(item.data?.lengthText) || void 0,
      thumbnail: thumbnailOf(item.data?.thumbnail),
      current: isCurrent(item)
    })),
    /** Play a song now; YouTube Music fills the queue with its radio. */
    play: (params) => {
      navigate({ watchEndpoint: { videoId: str(params, "videoId") } });
      return true;
    },
    /** Jump to a song that's already in the queue. */
    playQueueItem: (params) => {
      const item = queueItems()[num(params, "index")];
      const videoId = item?.data?.videoId;
      if (!item || !videoId) throw new Error("That song is no longer queued");
      navigate({
        watchEndpoint: item.data?.navigationEndpoint?.watchEndpoint ?? { videoId }
      });
      return true;
    },
    /** "Play next" / "Add to queue", with YouTube Music's own action. */
    enqueue: (params) => {
      const videoId = str(params, "videoId");
      const position = params.position === "end" ? "INSERT_AT_END" : "INSERT_AFTER_CURRENT_VIDEO";
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
      api()?.pauseVideo();
      return true;
    },
    resume: () => {
      api()?.playVideo();
      return true;
    },
    seek: (params) => {
      api()?.seekTo(num(params, "seconds"), true);
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
