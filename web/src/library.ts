/**
 * Likes, playlists and the library, through YouTube Music's own API (the
 * calls its menus make).
 */
import { findAll, innertube } from './innertube';

type Json = Record<string, unknown>;

const text = (value: unknown) => {
  const node = value as { runs?: { text?: string }[]; simpleText?: string } | undefined;
  return node?.runs?.map((run) => run.text ?? '').join('') ?? node?.simpleText ?? '';
};

export type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';

/** The song's page in the player ("next"): its like status and menu. */
const watchNext = (videoId: string) => innertube('next', { videoId });

/** Whether the song is liked. */
export const likeStatus = async (videoId: string): Promise<LikeStatus> => {
  const json = await watchNext(videoId);
  const status = findAll(json, 'likeStatus').find(
    (value): value is LikeStatus => typeof value === 'string',
  );
  return status ?? 'INDIFFERENT';
};

/** Like (or un-like) a song. */
export const rate = async (videoId: string, like: boolean) => {
  await innertube(like ? 'like/like' : 'like/removelike', { target: { videoId } });
  return true;
};

export interface PlaylistOption {
  playlistId: string;
  title: string;
  /** The song is in it already. */
  contains: boolean;
}

/** The user's playlists a song can be added to. */
export const playlistsFor = async (videoId: string): Promise<PlaylistOption[]> => {
  const json = await innertube('playlist/get_add_to_playlist', { videoIds: [videoId] });
  return findAll(json, 'playlistAddToOptionRenderer').flatMap((raw) => {
    const option = raw as Json;
    const playlistId = option.playlistId;
    if (typeof playlistId !== 'string') return [];
    return [
      {
        playlistId,
        title: text(option.title),
        contains: option.containsSelectedVideos === 'ALL',
      },
    ];
  });
};

export const addToPlaylist = async (playlistId: string, videoId: string) => {
  await innertube('browse/edit_playlist', {
    playlistId,
    actions: [
      { action: 'ACTION_ADD_VIDEO', addedVideoId: videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' },
    ],
  });
  return true;
};

/** A new (private) playlist with the song in it. */
export const createPlaylist = async (title: string, videoId: string) => {
  const json = await innertube('playlist/create', {
    title,
    privacyStatus: 'PRIVATE',
    videoIds: [videoId],
  });
  return typeof json.playlistId === 'string' ? json.playlistId : '';
};

/**
 * Save a song to the library (or remove it): the token behind the song
 * menu's "Save to library" / "Remove from library".
 */
export const saveSong = async (videoId: string, save: boolean) => {
  const json = await watchNext(videoId);
  for (const raw of findAll(json, 'toggleMenuServiceItemRenderer')) {
    const toggle = raw as Json;
    const icon = (toggle.defaultIcon as Json | undefined)?.iconType;
    if (icon !== 'LIBRARY_ADD' && icon !== 'LIBRARY_SAVED') continue;
    // The default action is what the menu offers now.
    const saved = icon === 'LIBRARY_SAVED';
    if (saved === save) return true;
    const token = findAll(toggle.defaultServiceEndpoint, 'feedbackToken')[0];
    if (typeof token !== 'string') break;
    await innertube('feedback', { feedbackTokens: [token] });
    return true;
  }
  throw new Error('This song cannot be saved to the library');
};

/** Save a playlist or album to the library (or remove it). */
export const savePlaylist = async (playlistId: string, save: boolean) => {
  await innertube(save ? 'like/like' : 'like/removelike', { target: { playlistId } });
  return true;
};

/** The endpoint of a song's or a playlist's radio. */
export const radioEndpoint = (target: { videoId?: string; playlistId?: string }) =>
  target.videoId
    ? { watchEndpoint: { videoId: target.videoId, playlistId: `RDAMVM${target.videoId}` } }
    : { watchPlaylistEndpoint: { playlistId: `RDAMPL${target.playlistId}` } };
