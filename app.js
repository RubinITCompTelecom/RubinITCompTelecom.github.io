// Two pages share this script:
//   index.html   - one square per entry in projects.json. Clicking a square opens that project's page.
//   project.html - ?p=<name>: the project's latest release (downloads + notes) and its README
//                  (screenshots and instructions), like the project pages on it.aygross.xyz.
// Release data: a shared snapshot (releases.json, rebuilt hourly by a GitHub Action) is shown first;
// if it is older than 30 minutes the visit asks GitHub for the newest release itself. If GitHub cannot
// be reached, the last saved data stays on screen.
// READMEs come from readmes.json (rebuilt by the same hourly Action), or are fetched live for a project
// that is not in the snapshot yet. Links and images are made absolute and the HTML is sanitised before use.
(function () {
  "use strict";

  var STALE_MS = 30 * 60 * 1000;
  var STORE_KEY = "rit-releases-v2"; // v2 adds prereleases
  var API = "https://api.github.com/repos/";

  // Small line icons, drawn in the card's icon tile. Pick one per project with "icon".
  var ICONS = {
    usb: '<path d="M10 2h4v5h-4z"/><path d="M8 7h8v9a4 4 0 0 1-8 0z"/><path d="M12 20v2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    broom: '<path d="M19 3 11 11"/><path d="M11 11c-3 0-6 2-7 9 5 0 8-2 9-5"/><path d="m9 13 2 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.4-.4-2.4z"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>'
  };

  var grid = document.getElementById("grid");          // home page
  var detail = document.getElementById("project");      // project page
  var pageName = detail ? new URLSearchParams(location.search).get("p") : null;
  var readmes = {};
  var projects = [];
  var snapshot = { checkedAt: null, projects: {}, prereleases: {} };
  var note = "";

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
  function iconSvg(p) {
    return '<div class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[p.icon] || ICONS.tool) + "</svg></div>";
  }
  function pageUrl(p) { return "project.html?p=" + encodeURIComponent(p.name); }

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
      if (s && typeof s.checkedAt === "string" && s.projects) { s.prereleases = s.prereleases || {}; return s; }
    } catch (e) {}
    return null;
  }
  function saveLocal(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }

  function checkOne(p) {
    return fetch(API + p.releases + "/releases?per_page=30", {
      cache: "no-store",
      headers: { Accept: "application/vnd.github.html+json" }
    }).then(function (r) {
      if (r.status === 404) return { rel: null, pre: null }; // repo has no releases (or is not public)
      if (!r.ok) throw new Error(r.status);
      return r.json().then(function (list) {
        // Same choice as update_releases.py: the latest stable release, plus the newest prerelease when it is newer.
        list = (Array.isArray(list) ? list : []).filter(function (x) { return !x.draft; });
        var stable = list.filter(function (x) { return !x.prerelease; })[0];
        var pre = list.filter(function (x) { return x.prerelease; })[0];
        if (!stable) return { rel: pre ? normalize(pre) : null, pre: null };
        var newerPre = pre && String(pre.created_at || "") > String(stable.created_at || ""); // commit date: survives mirroring
        return { rel: normalize(stable), pre: newerPre ? normalize(pre) : null };
      });
    });
  }

  function refreshLive() {
    // On a project page only that project is checked.
    var withRel = projects.filter(function (p) { return p.releases && (!pageName || p.name === pageName); });
    if (!withRel.length) return Promise.resolve();
    note = "Checking GitHub for newer releases…";
    render();
    return Promise.all(withRel.map(function (p) {
      return checkOne(p).then(function (r) { return { name: p.name, rel: r.rel, pre: r.pre, ok: true }; },
                              function () { return { name: p.name, ok: false }; });
    })).then(function (results) {
      var failed = results.some(function (x) { return !x.ok; });
      var next = { checkedAt: snapshot.checkedAt, projects: JSON.parse(JSON.stringify(snapshot.projects || {})),
                   prereleases: JSON.parse(JSON.stringify(snapshot.prereleases || {})) };
      results.forEach(function (x) { if (x.ok) { next.projects[x.name] = x.rel; next.prereleases[x.name] = x.pre; } });
      // The shared timestamp only moves forward when every project was checked.
      if (!failed && !pageName) next.checkedAt = new Date().toISOString();
      if (results.some(function (x) { return x.ok; })) {
        snapshot = next;
        saveLocal(snapshot);
      }
      note = failed ? "The latest GitHub check failed; showing the last saved release data." : "";
      render();
    });
  }

  // ---- sanitising GitHub HTML ----

  function cleanHtml(html) {
    var doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    var root = doc.body.firstChild;
    sanitize(root);
    return root.innerHTML;
  }

  function sanitize(root) {
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
  }

  function repoOf(url) {
    var m = /^https:\/\/github\.com\/([\w.\-]+\/[\w.\-]+)\/?$/.exec(url || "");
    return m ? m[1] : null;
  }

  // GitHub's rendered README -> safe HTML for this page: no duplicate title, no permalink icons,
  // relative images/links pointed at the repo, in-page anchors kept working under a "readme-" prefix.
  function readmeHtml(entry) {
    var doc = new DOMParser().parseFromString(String(entry.html || ""), "text/html");
    var root = doc.querySelector("article.markdown-body") || doc.body;
    var dir = String(entry.path || "README.md").replace(/[^\/]*$/, "");
    var blobBase = "https://github.com/" + entry.repo + "/blob/HEAD/" + dir;
    var rawBase = "https://raw.githubusercontent.com/" + entry.repo + "/HEAD/" + dir;
    var pre = "readme-";
    root.querySelectorAll("a.anchor, source").forEach(function (n) { n.remove(); });
    var h1 = root.querySelector("h1");
    if (h1) (h1.closest(".markdown-heading") || h1).remove();
    root.querySelectorAll("[id]").forEach(function (n) { n.id = pre + n.id.replace(/^user-content-/, ""); });
    root.querySelectorAll("[srcset]").forEach(function (n) { n.removeAttribute("srcset"); });
    root.querySelectorAll("img[src]").forEach(function (n) {
      var v = n.getAttribute("src").trim();
      try { if (!/^https?:/i.test(v)) n.setAttribute("src", new URL(v, rawBase).href); } catch (e) { n.removeAttribute("src"); }
      n.setAttribute("loading", "lazy");
    });
    root.querySelectorAll("a[href]").forEach(function (n) {
      var v = n.getAttribute("href").trim();
      var img = n.children.length === 1 && n.firstElementChild.tagName === "IMG" ? n.firstElementChild : null;
      if (img && img.getAttribute("src")) n.setAttribute("href", img.getAttribute("src")); // a picture opens full size
      else if (v.charAt(0) === "#") n.setAttribute("href", "#" + pre + v.slice(1).replace(/^user-content-/, ""));
      else if (!/^(https?:|mailto:)/i.test(v)) {
        try { n.setAttribute("href", new URL(v, blobBase).href); } catch (e) { n.removeAttribute("href"); }
      }
    });
    sanitize(root);
    return root.innerHTML;
  }

  // A project that is not in readmes.json yet (new square, the hourly job has not run): ask GitHub.
  function fetchMissingReadmes() {
    var missing = projects.filter(function (p) {
      return repoOf(p.repo) && !readmes[p.name] && (!pageName || p.name === pageName);
    });
    if (!missing.length) return;
    Promise.all(missing.map(function (p) {
      var repo = repoOf(p.repo);
      return fetch(API + repo + "/readme", { headers: { Accept: "application/vnd.github.html" } })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) {
          if (!html) return;
          var m = /data-path="([^"]*)"/.exec(html);
          readmes[p.name] = { repo: repo, path: m ? m[1] : "README.md", html: html };
        }, function () {});
    })).then(function () { render(); });
  }

  // ---- home page: squares ----

  function card(p) {
    var repoUrl = safeRepoUrl(p.repo);
    var chips = (p.tags || []).map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("");
    // The title link stretches over the whole square, so a click anywhere opens the project page.
    var title = repoUrl
      ? '<a class="card-link" href="' + esc(pageUrl(p)) + '">' + esc(p.title) + "</a>"
      : esc(p.title);
    var head = iconSvg(p) + "<h3>" + title + "</h3>" +
      "<p>" + esc(p.blurb) + "</p>" +
      '<div class="chips">' + chips + "</div>";

    if (!repoUrl) {
      return '<article class="card card-soon">' + head + '<span class="pill pill-soon">Coming soon</span></article>';
    }

    var ver = "", action = '<span class="pill pill-notes" aria-hidden="true">Details</span>';
    if (p.releases) {
      var rel = snapshot.projects ? snapshot.projects[p.name] : undefined;
      var asset = mainAsset(rel, p.releases);
      var preRel = snapshot.prereleases ? snapshot.prereleases[p.name] : null;
      if (rel) ver = '<span class="ver">' + esc(rel.tag) + (rel.prerelease ? " · prerelease" : "") +
        (preRel ? '<span class="ver-pre">Prerelease ' + esc(preRel.tag) + "</span>" : "") + "</span>";
      else if (rel === null) ver = '<span class="ver ver-none">No release yet</span>';
      else ver = '<span class="ver ver-none">Checking…</span>';
      if (asset) action = '<a class="pill pill-dl" href="' + esc(safeReleaseUrl(asset.url, p.releases)) + '" rel="noopener" title="' + esc(asset.name) + '">Download</a>';
    }
    return '<article class="card card-open">' + head + '<div class="card-foot">' + ver + action + "</div></article>";
  }

  // ---- project page ----

  // Version line, prerelease warning and download buttons for one release.
  function releaseBlock(p, rel) {
    var relUrl = safeReleaseUrl(rel.url, p.releases);
    var out = '<p class="rel-meta"><span class="rel-kind' + (rel.prerelease ? " rel-kind-pre" : "") + '">' +
      (rel.prerelease ? "Prerelease" : "Latest release") + "</span> " +
      (relUrl ? '<a href="' + esc(relUrl) + '" rel="noopener">' + esc(rel.tag) + " ↗</a>" : esc(rel.tag)) +
      " · " + esc(fmtDate(rel.published)) + "</p>";
    if (rel.prerelease) out += '<p class="rel-warn">This is a prerelease intended for testing, not a stable release.</p>';
    var files = (rel.assets || []).filter(function (a) { return safeReleaseUrl(a.url, p.releases); });
    var zips = files.filter(function (a) { return /\.zip$/i.test(a.name); });
    var show = zips.length ? zips : files;
    if (show.length) {
      out += '<ul class="rel-files" aria-label="' + esc(rel.tag) + ' downloads">' + show.map(function (a) {
        return '<li><a class="pill ' + (rel.prerelease ? "pill-ghost" : "pill-dl") + '" href="' + esc(safeReleaseUrl(a.url, p.releases)) + '" rel="noopener">Download</a> ' +
          "<span>" + esc(a.name) + (a.size ? ' <em>(' + esc(fmtSize(a.size)) + ")</em>" : "") + "</span></li>";
      }).join("") + "</ul>";
    } else {
      out += '<p class="rel-meta">No downloadable files are attached to this release. See GitHub for source archives.</p>';
    }
    return out;
  }

  function notesBlock(rel, id) {
    return '<section class="pj-box" aria-labelledby="' + id + '"><h2 id="' + id + '">' +
      (rel.prerelease ? "Prerelease notes · " : "Release notes · ") + esc(rel.tag) + "</h2>" +
      (rel.body_html ? '<div class="rel-notes">' + cleanHtml(rel.body_html) + "</div>"
                     : '<p class="rel-meta">This release has no notes.</p>') + "</section>";
  }

  function projectPage(p) {
    var rel = p.releases && snapshot.projects ? snapshot.projects[p.name] : undefined;
    var pre = rel && snapshot.prereleases ? snapshot.prereleases[p.name] : null;
    var repoUrl = safeRepoUrl(p.repo);
    var entry = readmes[p.name];
    var chips = (p.tags || []).map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("");
    var out = '<header class="pj-head">' + iconSvg(p) +
      '<div class="pj-title"><h1>' + esc(p.title) + "</h1>" +
      '<div class="chips">' + chips + "</div></div></header>" +
      '<p class="pj-blurb">' + esc(p.blurb) + "</p>";

    // Downloads
    out += '<section class="pj-box" aria-labelledby="pj-rel">';
    out += '<h2 id="pj-rel">Download</h2>';
    if (!p.releases) {
      out += '<p class="rel-meta">This project has no packaged releases. Get it from the repository.</p>';
    } else if (!rel) {
      out += '<p class="rel-meta">' + (rel === null ? "No published release yet." : "Release information not checked yet.") + "</p>";
    } else {
      out += releaseBlock(p, rel);
      if (pre) out += '<div class="rel-pre-block">' + releaseBlock(p, pre) + "</div>";
    }
    out += '<p class="rel-links">' +
      (repoUrl ? '<a href="' + esc(repoUrl) + '" rel="noopener">View repository on GitHub ↗</a>' : "") +
      (p.releases ? '<a href="https://github.com/' + esc(p.releases) + '/releases" rel="noopener">All releases ↗</a>' : "") +
      "</p>";
    if (p.releases) {
      out += '<p class="rel-checked">' + (note ? esc(note) + " " : "") +
        (snapshot.checkedAt ? "Checked " + esc(fmtStamp(snapshot.checkedAt)) + " UTC." : "") + "</p>";
    }
    out += "</section>";

    // Screenshots and instructions
    var body = "";
    if (entry) { try { body = readmeHtml(entry); } catch (e) { body = ""; } }
    out += '<section class="pj-box" aria-labelledby="pj-readme"><h2 id="pj-readme">Screenshots and instructions</h2>' +
      '<div class="readme">' + (body || (entry === undefined && repoOf(p.repo) ? '<p class="rel-meta">Loading…</p>'
        : '<p>See the README on GitHub.</p>')) + "</div></section>";

    // Release notes
    if (rel) out += notesBlock(rel, "pj-notes");
    if (pre) out += notesBlock(pre, "pj-pre-notes");
    return out;
  }

  // ---- drawing ----

  function render() {
    if (grid) {
      grid.innerHTML = projects.length
        ? projects.map(card).join("")
        : '<p class="loading">Projects are on their way.</p>';
    }
    if (detail) {
      var p = projects.filter(function (x) { return x.name === pageName && safeRepoUrl(x.repo); })[0];
      if (!p) {
        detail.innerHTML = '<h1 class="pj-missing">Project not found</h1><p><a href="./">← All projects</a></p>';
        return;
      }
      document.title = p.title + " · Rubin IT on GitHub";
      // Keep the reader's place when the page is redrawn after a live check.
      var y = window.scrollY;
      detail.innerHTML = projectPage(p);
      window.scrollTo(0, y);
    }
  }

  // ---- start ----

  function isStale() {
    if (!snapshot.checkedAt) return true;
    return Date.now() - Date.parse(snapshot.checkedAt) > STALE_MS;
  }

  Promise.all([
    fetch("projects.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch("releases.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch("readmes.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    readmes = res[2] && res[2].projects && typeof res[2].projects === "object" ? res[2].projects : {};
    projects = (Array.isArray(res[0]) ? res[0] : []).filter(function (p) { return p && p.title; });
    var shared = res[1] && typeof res[1].checkedAt === "string" && res[1].projects ? res[1] : null;
    if (shared) shared.prereleases = shared.prereleases || {};
    snapshot = newer(shared, readLocal()) || snapshot;
    render();
    if (isStale()) refreshLive().catch(function () {});
    fetchMissingReadmes();
    if (detail && location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
  }).catch(function () {
    var msg = '<p class="loading">Couldn\'t load the project list. Browse them at <a href="https://github.com/RubinITCompTelecom">github.com/RubinITCompTelecom</a>.</p>';
    if (grid) grid.innerHTML = msg;
    if (detail) detail.innerHTML = msg;
  });
})();
