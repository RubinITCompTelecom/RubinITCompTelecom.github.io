// Draws one square per entry in projects.json.
// A square with a "releases" repo (owner/name) shows its latest GitHub release:
//   - the square has a direct download link taken from the release's files,
//   - clicking the square opens the release notes.
// Release data works like it.aygross.xyz: a shared snapshot (releases.json, rebuilt hourly by a
// GitHub Action) is shown first; if it is older than 30 minutes the visit asks GitHub for the
// newest release itself. If GitHub cannot be reached, the last saved data stays on screen.
(function () {
  "use strict";

  var STALE_MS = 30 * 60 * 1000;
  var STORE_KEY = "rit-releases-v1";
  var API = "https://api.github.com/repos/";

  // Small line icons, drawn in the card's icon tile. Pick one per project with "icon".
  var ICONS = {
    usb: '<path d="M10 2h4v5h-4z"/><path d="M8 7h8v9a4 4 0 0 1-8 0z"/><path d="M12 20v2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    broom: '<path d="M19 3 11 11"/><path d="M11 11c-3 0-6 2-7 9 5 0 8-2 9-5"/><path d="m9 13 2 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.4-.4-2.4z"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>'
  };

  var grid = document.getElementById("grid");
  var projects = [];
  var snapshot = { checkedAt: null, projects: {} };
  var note = "";
  var openName = null;
  var lastFocus = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function safeRepoUrl(u) {
    // Only https links to github.com are allowed on a card.
    return /^https:\/\/github\.com\/[\w.\-\/]+$/.test(u || "") ? u : null;
  }

  // A release link is only trusted when it is an https github.com link inside the configured repo.
  function safeReleaseUrl(u, repo) {
    try {
      var x = new URL(u);
      var ok = x.protocol === "https:" && x.hostname === "github.com" &&
        x.pathname.toLowerCase().indexOf("/" + String(repo).toLowerCase() + "/releases/") === 0;
      return ok ? x.href : null;
    } catch (e) { return null; }
  }

  function fmtDate(iso) { return iso ? String(iso).slice(0, 10) : ""; }
  function fmtStamp(iso) { return iso ? String(iso).slice(0, 16).replace("T", " ") : ""; }
  function fmtSize(n) {
    if (!n) return "";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }

  // The file a visitor most likely wants: the first .zip, else the first file that is not a checksum.
  function mainAsset(rel, repo) {
    if (!rel || !rel.assets) return null;
    var list = rel.assets.filter(function (a) { return safeReleaseUrl(a.url, repo); });
    var zip = list.filter(function (a) { return /\.zip$/i.test(a.name); })[0];
    if (zip) return zip;
    return list.filter(function (a) { return !/\.(sha256|sha1|md5|txt|asc|sig)$/i.test(a.name); })[0] || null;
  }

  // ---- release data: snapshot + local copy + live check ----

  function normalize(r) {
    return {
      tag: r.tag_name,
      name: r.name || r.tag_name,
      url: r.html_url,
      published: r.published_at || r.created_at,
      prerelease: !!r.prerelease,
      body_html: r.body_html || "",
      assets: (r.assets || []).map(function (a) {
        return { name: a.name, url: a.browser_download_url, size: a.size };
      })
    };
  }

  function newer(a, b) {
    if (!a || !a.checkedAt) return b;
    if (!b || !b.checkedAt) return a;
    return a.checkedAt >= b.checkedAt ? a : b;
  }

  function readLocal() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (s && typeof s.checkedAt === "string" && s.projects) return s;
    } catch (e) {}
    return null;
  }
  function saveLocal(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }

  function checkOne(p) {
    return fetch(API + p.releases + "/releases?per_page=5", {
      cache: "no-store",
      headers: { Accept: "application/vnd.github.html+json" }
    }).then(function (r) {
      if (r.status === 404) return null; // repo has no releases (or is not public)
      if (!r.ok) throw new Error(r.status);
      return r.json().then(function (list) {
        var pick = (Array.isArray(list) ? list : []).filter(function (x) { return !x.draft; })[0];
        return pick ? normalize(pick) : null;
      });
    });
  }

  function refreshLive() {
    var withRel = projects.filter(function (p) { return p.releases; });
    if (!withRel.length) return Promise.resolve();
    note = "Checking GitHub for newer releases…";
    refreshOpenModal();
    return Promise.all(withRel.map(function (p) {
      return checkOne(p).then(function (rel) { return { name: p.name, rel: rel, ok: true }; },
                              function () { return { name: p.name, ok: false }; });
    })).then(function (results) {
      var failed = results.some(function (x) { return !x.ok; });
      var next = { checkedAt: snapshot.checkedAt, projects: JSON.parse(JSON.stringify(snapshot.projects || {})) };
      results.forEach(function (x) { if (x.ok) next.projects[x.name] = x.rel; });
      if (!failed) next.checkedAt = new Date().toISOString();
      if (results.some(function (x) { return x.ok; })) {
        snapshot = next;
        saveLocal(snapshot);
      }
      note = failed ? "The latest GitHub check failed; showing the last saved release data." : "";
      render();
    });
  }

  // ---- cards ----

  function card(p) {
    var repoUrl = safeRepoUrl(p.repo);
    var icon = ICONS[p.icon] || ICONS.tool;
    var chips = (p.tags || []).map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("");
    var head = '<div class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icon + "</svg></div>" +
      "<h3>" + esc(p.title) + "</h3>" +
      "<p>" + esc(p.blurb) + "</p>" +
      '<div class="chips">' + chips + "</div>";

    if (p.releases) {
      var rel = snapshot.projects ? snapshot.projects[p.name] : undefined;
      var asset = mainAsset(rel, p.releases);
      var ver;
      if (rel) {
        ver = '<span class="ver">' + esc(rel.tag) + (rel.prerelease ? " · prerelease" : "") + "</span>";
      } else if (rel === null) {
        ver = '<span class="ver ver-none">No release yet</span>';
      } else {
        ver = '<span class="ver ver-none">Checking…</span>';
      }
      var action = asset
        ? '<a class="pill pill-dl" href="' + esc(safeReleaseUrl(asset.url, p.releases)) + '" rel="noopener" title="' + esc(asset.name) + '">Download</a>'
        : '<span class="pill pill-notes">Release notes</span>';
      return '<article class="card card-open" tabindex="0" role="button" data-name="' + esc(p.name) + '" aria-label="' + esc(p.title) + ': show latest release and notes">' +
        head + '<div class="card-foot">' + ver + action + "</div></article>";
    }

    return '<article class="card' + (repoUrl ? "" : " card-soon") + '">' + head +
      (repoUrl ? '<a class="pill" href="' + esc(repoUrl) + '" rel="noopener">View on GitHub</a>'
               : '<span class="pill pill-soon">Coming soon</span>') +
      "</article>";
  }

  function render() {
    grid.innerHTML = projects.length
      ? projects.map(card).join("")
      : '<p class="loading">Projects are on their way.</p>';
  }

  // ---- release window (modal) ----

  function cleanHtml(html) {
    var doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    var root = doc.body.firstChild;
    root.querySelectorAll("script,style,iframe,object,embed,form,link,meta,base").forEach(function (n) { n.remove(); });
    root.querySelectorAll("*").forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        var name = a.name.toLowerCase();
        if (name.indexOf("on") === 0 || name === "style") n.removeAttribute(a.name);
        else if ((name === "href" || name === "src") && !/^(https?:|#|mailto:)/i.test(a.value.trim())) n.removeAttribute(a.name);
      });
      if (n.tagName === "A" && n.getAttribute("href") && n.getAttribute("href").charAt(0) !== "#") {
        n.setAttribute("target", "_blank");
        n.setAttribute("rel", "noopener noreferrer nofollow");
      }
    });
    return root.innerHTML;
  }

  function modalBody(p) {
    var rel = snapshot.projects ? snapshot.projects[p.name] : undefined;
    var repoUrl = safeRepoUrl(p.repo);
    var srcUrl = "https://github.com/" + p.releases;
    var out = "<h2 id=\"rel-title\">" + esc(p.title) + "</h2>";

    if (!rel) {
      out += '<p class="rel-meta">' + (rel === null ? "No published release yet." : "Release information not checked yet.") + "</p>";
    } else {
      var relUrl = safeReleaseUrl(rel.url, p.releases);
      out += '<p class="rel-meta"><span class="rel-kind' + (rel.prerelease ? " rel-kind-pre" : "") + '">' +
        (rel.prerelease ? "Prerelease" : "Latest release") + "</span> " +
        (relUrl ? '<a href="' + esc(relUrl) + '" rel="noopener">' + esc(rel.tag) + " ↗</a>" : esc(rel.tag)) +
        " · " + esc(fmtDate(rel.published)) + "</p>";
      if (rel.prerelease) out += '<p class="rel-warn">This is a prerelease intended for testing, not a stable release.</p>';

      var files = (rel.assets || []).filter(function (a) { return safeReleaseUrl(a.url, p.releases); });
      var zips = files.filter(function (a) { return /\.zip$/i.test(a.name); });
      var show = zips.length ? zips : files;
      if (show.length) {
        out += '<ul class="rel-files" aria-label="Downloads">' + show.map(function (a) {
          return '<li><a class="pill pill-dl" href="' + esc(safeReleaseUrl(a.url, p.releases)) + '" rel="noopener">Download</a> ' +
            "<span>" + esc(a.name) + (a.size ? ' <em>(' + esc(fmtSize(a.size)) + ")</em>" : "") + "</span></li>";
        }).join("") + "</ul>";
      } else {
        out += '<p class="rel-meta">No downloadable files are attached to this release. See GitHub for source archives and instructions.</p>';
      }

      out += "<h3>Release notes</h3>";
      out += rel.body_html
        ? '<div class="rel-notes">' + cleanHtml(rel.body_html) + "</div>"
        : '<p class="rel-meta">This release has no notes.</p>';
    }

    out += '<p class="rel-links">' +
      (rel && safeReleaseUrl(rel.url, p.releases) ? '<a href="' + esc(safeReleaseUrl(rel.url, p.releases)) + '" rel="noopener">Release notes on GitHub ↗</a> ' : "") +
      (repoUrl ? '<a href="' + esc(repoUrl) + '" rel="noopener">View repository ↗</a> ' : "") +
      '<a href="' + esc(srcUrl) + '" rel="noopener">Release source ↗</a></p>';

    out += '<p class="rel-checked">' +
      (note ? esc(note) + " " : "") +
      (snapshot.checkedAt ? "Checked " + esc(fmtStamp(snapshot.checkedAt)) + " UTC · " : "") +
      "checked on visits when the saved data is older than 30 minutes; hourly fallback.</p>";
    return out;
  }

  function ensureModal() {
    var m = document.getElementById("rel-modal");
    if (m) return m;
    m = document.createElement("div");
    m.id = "rel-modal";
    m.className = "rel-modal";
    m.hidden = true;
    m.innerHTML = '<div class="rel-backdrop" data-close="1"></div>' +
      '<div class="rel-dialog" role="dialog" aria-modal="true" aria-labelledby="rel-title">' +
      '<button type="button" class="rel-close" data-close="1" aria-label="Close">×</button>' +
      '<div class="rel-content"></div></div>';
    m.addEventListener("click", function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute("data-close")) closeModal();
    });
    document.body.appendChild(m);
    return m;
  }

  function findProject(name) {
    return projects.filter(function (p) { return p.name === name; })[0];
  }

  function openModal(name) {
    var p = findProject(name);
    if (!p) return;
    openName = name;
    lastFocus = document.activeElement;
    var m = ensureModal();
    m.querySelector(".rel-content").innerHTML = modalBody(p);
    m.hidden = false;
    document.body.classList.add("rel-open");
    m.querySelector(".rel-close").focus();
    // Like it.aygross.xyz: opening a project checks again when the saved data is stale.
    maybeRefresh();
  }

  function refreshOpenModal() {
    if (!openName) return;
    var p = findProject(openName);
    var m = document.getElementById("rel-modal");
    if (p && m && !m.hidden) {
      var box = m.querySelector(".rel-content");
      var top = box.scrollTop;
      box.innerHTML = modalBody(p);
      box.scrollTop = top;
    }
  }

  function closeModal() {
    var m = document.getElementById("rel-modal");
    if (m) m.hidden = true;
    document.body.classList.remove("rel-open");
    openName = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openName) closeModal();
    if ((e.key === "Enter" || e.key === " ") && e.target && e.target.classList && e.target.classList.contains("card-open")) {
      e.preventDefault();
      openModal(e.target.getAttribute("data-name"));
    }
  });

  grid.addEventListener("click", function (e) {
    var el = e.target;
    if (el.closest && el.closest("a")) return; // the Download link is a real link
    var c = el.closest ? el.closest(".card-open") : null;
    if (c) openModal(c.getAttribute("data-name"));
  });

  // ---- start ----

  var refreshing = null;
  function isStale() {
    if (!snapshot.checkedAt) return true;
    return Date.now() - Date.parse(snapshot.checkedAt) > STALE_MS;
  }
  function maybeRefresh() {
    if (refreshing || !isStale()) return;
    refreshing = refreshLive().then(function () { refreshing = null; refreshOpenModal(); },
                                    function () { refreshing = null; });
  }

  Promise.all([
    fetch("projects.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch("releases.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    projects = (Array.isArray(res[0]) ? res[0] : []).filter(function (p) { return p && p.title; });
    var shared = res[1] && typeof res[1].checkedAt === "string" && res[1].projects ? res[1] : null;
    snapshot = newer(shared, readLocal()) || snapshot;
    render();
    maybeRefresh();
  }).catch(function () {
    grid.innerHTML = '<p class="loading">Couldn\'t load the project list. Browse them at <a href="https://github.com/RubinITCompTelecom">github.com/RubinITCompTelecom</a>.</p>';
  });
})();
