console.log("sample playable loaded");
window.addEventListener("load", function () {
  if (window.PF && window.PF.lifecycle) {
    window.PF.lifecycle.gameLoaded();
    window.PF.lifecycle.gameStarted();
  }
});
