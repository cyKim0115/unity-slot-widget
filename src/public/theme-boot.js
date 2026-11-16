// Applies the saved theme choice before the first paint, so a dark window never flashes light.
// The choice is mirrored by src/shell/theme.ts; settings arrive later from widget.json.
// A classic script in <head>: the page's CSP allows scripts from 'self' only, so it cannot be inline.
// ?theme=light|dark|system overrides it in the browser preview.
(function () {
  try {
    var choice = new URLSearchParams(location.search).get("theme");
    if (choice !== "light" && choice !== "dark" && choice !== "system") {
      var raw = localStorage.getItem("unity-slot-widget.theme");
      choice = raw ? JSON.parse(raw) : "system";
    }
    if (choice === "light" || choice === "dark") document.documentElement.setAttribute("data-theme", choice);
  } catch (e) {
    // a blocked store: the CSS follows the system
  }
})();
