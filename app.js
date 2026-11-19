// Draws one square per entry in projects.json. No outside calls, all text escaped.
(function () {
  "use strict";

  // Small line icons, drawn in the card's icon tile. Pick one per project with "icon".
  var ICONS = {
    usb: '<path d="M10 2h4v5h-4z"/><path d="M8 7h8v9a4 4 0 0 1-8 0z"/><path d="M12 20v2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    broom: '<path d="M19 3 11 11"/><path d="M11 11c-3 0-6 2-7 9 5 0 8-2 9-5"/><path d="m9 13 2 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.4-.4-2.4z"/>'
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function safeUrl(u) {
    // Only https links to github.com are allowed on a card.
    return /^https:\/\/github\.com\/[\w.\-\/]+$/.test(u || "") ? u : null;
  }

  function card(p) {
    var url = safeUrl(p.repo);
    var icon = ICONS[p.icon] || ICONS.tool;
    var chips = (p.tags || []).map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("");
    return '<article class="card' + (url ? "" : " card-soon") + '">' +
      '<div class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icon + "</svg></div>" +
      "<h3>" + esc(p.title) + "</h3>" +
      "<p>" + esc(p.blurb) + "</p>" +
      '<div class="chips">' + chips + "</div>" +
      (url ? '<a class="pill" href="' + esc(url) + '" rel="noopener">View on GitHub</a>'
           : '<span class="pill pill-soon">Coming soon</span>') +
      "</article>";
  }

  var grid = document.getElementById("grid");
  fetch("projects.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (list) {
      list = (Array.isArray(list) ? list : []).filter(function (p) { return p && p.title; });
      grid.innerHTML = list.length
        ? list.map(card).join("")
        : '<p class="loading">Projects are on their way.</p>';
    })
    .catch(function () {
      grid.innerHTML = '<p class="loading">Couldn\'t load the project list. Browse them at <a href="https://github.com/RubinITCompTelecom">github.com/RubinITCompTelecom</a>.</p>';
    });
})();
