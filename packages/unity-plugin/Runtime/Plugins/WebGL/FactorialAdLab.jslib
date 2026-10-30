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
  PF_GamePaused: function () {
    try { if (window.PF) window.PF.lifecycle.gamePaused(); } catch (e) {}
  },
  PF_GameResumed: function () {
    try { if (window.PF) window.PF.lifecycle.gameResumed(); } catch (e) {}
  },
  PF_GameEnded: function () {
    try { if (window.PF) window.PF.lifecycle.gameEnded(); } catch (e) {}
  },
  PF_LevelChanged: function (level) {
    try { if (window.PF) window.PF.lifecycle.levelChanged(level < 0 ? undefined : level); } catch (e) {}
  },
  PF_LogEvent: function (namePtr, value) {
    try { if (window.PF) window.PF.analytics.logEvent(UTF8ToString(namePtr), value); } catch (e) {}
  },
  PF_SetLoadingProgress: function (p) {
    try { if (window.PF) window.PF.setLoadingProgress(p); } catch (e) {}
  },
  PF_Haptic: function (typePtr) {
    try { if (window.PF) window.PF.haptic(UTF8ToString(typePtr)); } catch (e) {}
  },
  PF_GetPlatform: function () {
    var p = "web";
    try { if (window.PF) p = window.PF.getPlatform(); } catch (e) {}
    return _pf_str(p);
  },
  PF_GetPreferredLanguage: function () {
    var l = "en-US";
    try { l = (window.PF && window.PF.getPreferredLanguage()) || navigator.language || l; } catch (e) {}
    return _pf_str(l);
  },
  PF_GetPreferredLanguagesJson: function () {
    var arr = ["en-US"];
    try { arr = window.PF ? window.PF.getPreferredLanguages() : (navigator.languages ? [].slice.call(navigator.languages) : [navigator.language || "en-US"]); } catch (e) {}
    return _pf_str(JSON.stringify(arr));
  },
  PF_GetVarsJson: function () {
    var json = "{}";
    try { if (window.PF && window.PF.vars) json = JSON.stringify(window.PF.vars); } catch (e) {}
    return _pf_str(json);
  },
  // The shim's pause/resume (MRAID viewableChange, DAPI, …) → LifeCycle.OnPause/OnResume in C#.
  PF_RegisterLifecycle: function (namePtr) {
    var go = UTF8ToString(namePtr);
    function send(method) {
      try {
        if (typeof Module !== "undefined" && Module.SendMessage) Module.SendMessage(go, method);
        else if (typeof SendMessage === "function") SendMessage(go, method);
      } catch (e) {}
    }
    try {
      if (window.PF && window.PF.on) {
        window.PF.on("pause", function () { send("__OnPause"); });
        window.PF.on("resume", function () { send("__OnResume"); });
      }
    } catch (e) {}
  },

  // helper: copy a JS string into the wasm heap for a `string` return (Unity frees it)
  _pf_str: function (s) {
    var size = lengthBytesUTF8(s) + 1;
    var buf = _malloc(size);
    stringToUTF8(s, buf, size);
    return buf;
  },
  _pf_str__deps: [],
  PF_GetPlatform__deps: ["_pf_str"],
  PF_GetPreferredLanguage__deps: ["_pf_str"],
  PF_GetPreferredLanguagesJson__deps: ["_pf_str"],
  PF_GetVarsJson__deps: ["_pf_str"],
});
