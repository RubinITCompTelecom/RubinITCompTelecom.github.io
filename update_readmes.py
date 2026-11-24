#!/usr/bin/env python3
"""Rebuild readmes.json: GitHub's rendered README (HTML) for every project in projects.json that has a "repo".
The page shows it under "Screenshots and instructions". Links and images are made absolute in the browser
(app.js), and the HTML is sanitised there before it is shown. If a fetch fails, the old entry is kept."""
import json, re, sys, urllib.request, urllib.error, os

def get(url, token):
    h = {"Accept": "application/vnd.github.html", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rubinit-showcase"}
    if token:
        h["Authorization"] = "Bearer " + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r:
            return r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise

def repo_of(url):
    m = re.match(r"^https://github\.com/([\w.\-]+/[\w.\-]+)/?$", url or "")
    return m.group(1) if m else None

token = os.environ.get("GITHUB_TOKEN", "")
projects = json.load(open("projects.json", encoding="utf-8"))
try:
    old = json.load(open("readmes.json", encoding="utf-8"))
except Exception:
    old = {"projects": {}}

out = {"projects": {}}
for p in projects:
    repo = repo_of(p.get("repo"))
    if not repo:
        continue
    try:
        html = get("https://api.github.com/repos/%s/readme" % repo, token)
        if html is None:
            continue
        m = re.search(r'data-path="([^"]*)"', html)
        out["projects"][p["name"]] = {"repo": repo, "path": m.group(1) if m else "README.md", "html": html}
    except Exception as e:
        print("README fetch failed for %s: %s" % (repo, e), file=sys.stderr)
        if p["name"] in old.get("projects", {}):
            out["projects"][p["name"]] = old["projects"][p["name"]]

with open("readmes.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("readmes.json written:", ", ".join(sorted(out["projects"])) or "(none)")
