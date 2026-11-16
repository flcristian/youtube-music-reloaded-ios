// Checks for the Diagnostics screen (window.__ytmr.*).
(() => {
  const video = () => document.querySelector('video');

  window.__ytmr = {
    /** What this WebKit supports and how YouTube Music is playing. */
    diagnose() {
      const v = video();
      const result = {
        page: location.href,
        MediaSource: typeof window.MediaSource !== 'undefined',
        ManagedMediaSource: typeof window.ManagedMediaSource !== 'undefined',
        AudioContext:
          typeof (window.AudioContext ?? window.webkitAudioContext) !==
          'undefined',
        player: Boolean(document.querySelector('#movie_player')),
        video: Boolean(v),
      };
      if (v) {
        result.stream = v.src.startsWith('blob:')
          ? 'blob (MediaSource streaming)'
          : v.src
            ? 'direct URL (Web Audio may be silent: cross-origin)'
            : 'none';
        result.paused = v.paused;
        // On iPhone, volume is read-only: setting it is ignored.
        const before = v.volume;
        v.volume = before > 0.5 ? 0.3 : 0.9;
        result.volumeWritable = Math.abs(v.volume - before) > 0.01;
        v.volume = before;
      }
      return JSON.stringify(result, null, 2);
    },

    /**
     * Routes the player through Web Audio (once; can't be undone until the
     * page reloads) and dips the volume for ~3 s.
     */
    async testWebAudio() {
      const v = video();
      if (!v) return 'No player yet: play a song first.';
      const Context = window.AudioContext ?? window.webkitAudioContext;
      if (!Context) return 'No Web Audio in this WebKit.';
      window.__ytmrAudio ??= new Context();
      const context = window.__ytmrAudio;
      if (!window.__ytmrGain) {
        try {
          const source = context.createMediaElementSource(v);
          const gain = context.createGain();
          source.connect(gain).connect(context.destination);
          window.__ytmrGain = gain;
        } catch (error) {
          return `createMediaElementSource failed: ${error}`;
        }
      }
      await context.resume();
      const gain = window.__ytmrGain.gain;
      const now = context.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(1, now);
      gain.linearRampToValueAtTime(0.1, now + 1);
      gain.setValueAtTime(0.1, now + 2);
      gain.linearRampToValueAtTime(1, now + 3);
      return (
        `Audio context: ${context.state}. The music should dip for ~3 s. ` +
        'If it did (and did not go silent), we can crossfade with Web Audio. ' +
        'Now lock the phone: if it keeps playing, that works in the background too.'
      );
    },
  };
})();
