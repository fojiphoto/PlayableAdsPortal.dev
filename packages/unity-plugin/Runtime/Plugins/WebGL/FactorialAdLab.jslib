// Factorial AdLab — Unity WebGL bridge to the packaged playable's runtime shim (window.PF).
// Every call is a no-op when the shim is absent (e.g. a plain WebGL build outside the pipeline).
mergeInto(LibraryManager.library, {
  PF_Install: function () {
    try { if (window.PF) window.PF.install(); } catch (e) {}
  },
  PF_GameLoaded: function () {
    try { if (window.PF) window.PF.lifecycle.gameLoaded(); } catch (e) {}
  },
  PF_GameStarted: function () {
    try { if (window.PF) window.PF.lifecycle.gameStarted(); } catch (e) {}
  },
  PF_GameEnded: function () {
    try { if (window.PF) window.PF.lifecycle.gameEnded(); } catch (e) {}
  },
  PF_LevelChanged: function (level) {
    try { if (window.PF) window.PF.lifecycle.levelChanged(level); } catch (e) {}
  },
  PF_LogEvent: function (namePtr) {
    try { if (window.PF) window.PF.analytics.logEvent(UTF8ToString(namePtr)); } catch (e) {}
  },
  PF_GetPlatform: function () {
    var p = "web";
    try { if (window.PF) p = window.PF.getPlatform(); } catch (e) {}
    var size = lengthBytesUTF8(p) + 1;
    var buf = _malloc(size);
    stringToUTF8(p, buf, size);
    return buf;
  }
});
