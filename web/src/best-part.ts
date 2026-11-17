/**
 * The best part of a song from YouTube's "Most replayed" graph: the window
 * listeners rewatch the most, after removing the overall drop-off as they
 * leave the song (so choruses and solos win wherever they are).
 */
export interface Point {
  at: number;
  value: number;
}

/** Listeners always start at 0:00; that peak says nothing about the song. */
const INTRO = 15;
const STEP = 5;
/** Leave a few seconds before the end of the song. */
const OUTRO = 4;

const graphs = new Map<string, Promise<Point[] | undefined>>();

const fetchGraph = async (videoId: string) => {
  const response = await fetch(
    'https://www.youtube.com/youtubei/v1/next?prettyPrint=false',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20251101.00.00',
            hl: 'en',
          },
        },
        videoId,
      }),
    },
  );
  if (!response.ok) return undefined;
  let markers: { startMillis?: string; intensityScoreNormalized?: number }[] =
    [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        const list = (
          value as { markersList?: { markerType?: string; markers?: [] } }
        )?.markersList;
        if (
          key === 'macroMarkersListEntity' &&
          list?.markerType === 'MARKER_TYPE_HEATMAP'
        ) {
          markers = list.markers ?? [];
        } else {
          walk(value);
        }
      }
    }
  };
  walk(await response.json());
  return markers.length
    ? markers.map((marker) => ({
        at: Number(marker.startMillis) / 1000,
        value: marker.intensityScoreNormalized ?? 0,
      }))
    : undefined;
};

/** The replay graph of a song (cached), or `undefined` if it has none. */
export const loadReplayGraph = (videoId: string) => {
  let graph = graphs.get(videoId);
  if (!graph) {
    graph = fetchGraph(videoId).catch(() => undefined);
    graphs.set(videoId, graph);
  }
  return graph;
};

/** Start of the best `seconds`-long part of a `length`-second song. */
export const bestPartStart = (
  graph: Point[],
  length: number,
  seconds: number,
) => {
  if (seconds >= length - INTRO - OUTRO) return 0;
  const body = graph.filter((point) => point.at >= INTRO);
  if (body.length < 2) return 0;
  // A straight line through the curve is the drop-off; keep what's above it.
  const meanAt = body.reduce((sum, point) => sum + point.at, 0) / body.length;
  const meanValue =
    body.reduce((sum, point) => sum + point.value, 0) / body.length;
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
  for (let start = INTRO; start + seconds <= length - OUTRO; start += STEP) {
    const end = start + seconds;
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
