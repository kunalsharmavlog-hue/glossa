// Runs inside Netflix's page to read the movie name and turn on English subtitles.
// Netflix does not document this player API, so every step fails quietly if it changes.
(function () {
  if (window.__netflixVocabBridge) return; // Already running after an extension reload.
  window.__netflixVocabBridge = true;
  let enabledByUs = null;

  function getPlayer() {
    const app = window.netflix?.appContext?.state?.playerApp;
    const api = app?.getAPI?.().videoPlayer;
    // The home page runs muted preview players too; only the "watch-" session is the movie.
    const sessionId = api?.getAllPlayerSessionIds?.().find((s) => s.startsWith("watch"));
    return sessionId ? { app, player: api.getVideoPlayerBySessionId(sessionId) } : null;
  }

  function readTitle(app, movieId) {
    const entry = app.getState?.().videoPlayer?.videoMetadata?.[movieId];
    const video = entry?._metadataObject?.video;
    if (!video?.title) return entry?.getTitle?.() || "";
    if (video.type !== "show") return video.title;
    for (const season of video.seasons || []) {
      const ep = (season.episodes || []).find((e) => String(e.id ?? e.episodeId) === String(movieId));
      if (ep) return `${video.title} S${season.seq}E${ep.seq} - ${ep.title}`;
    }
    return video.title;
  }

  const isEnglish = (t) => /^en\b/i.test(t?.bcp47 || "") && !t.isForcedNarrative && !t.isNoneTrack;

  function syncSubtitles(player, movieId) {
    const current = player.getTextTrack?.();
    if (isEnglish(current)) return enabledByUs === movieId ? "enabled-by-extension" : "english-on";
    if (current && !current.isNoneTrack && !current.isForcedNarrative) return "other-language";
    const tracks = player.getTextTrackList?.() || [];
    if (!tracks.length) return "loading"; // Empty while the player starts, which is not a missing track.
    const english = tracks.find(isEnglish);
    if (!english) return "no-english";
    player.setTextTrack(english);
    enabledByUs = movieId;
    return "enabled-by-extension";
  }

  setInterval(() => {
    if (!location.pathname.startsWith("/watch/")) return;
    try {
      const found = getPlayer();
      if (!found) return;
      const movieId = found.player.getMovieId?.();
      if (!movieId) return;
      window.postMessage({
        source: "netflix-vocab",
        movieId,
        title: readTitle(found.app, movieId),
        subtitleState: syncSubtitles(found.player, movieId),
      }, location.origin);
    } catch {}
  }, 3000);
})();
