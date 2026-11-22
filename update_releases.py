#!/usr/bin/env python3
"""Rebuild releases.json: the newest GitHub release for every project in projects.json that has a "releases" repo.
Same data the page fetches itself when the snapshot is older than 30 minutes."""
import json, os, sys, datetime, urllib.request, urllib.error

def get(url, token):
    h = {"Accept": "application/vnd.github.html+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rubinit-showcase"}
    if token:
        h["Authorization"] = "Bearer " + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise

def norm(r):
    return {
        "tag": r["tag_name"], "name": r.get("name") or r["tag_name"], "url": r["html_url"],
        "published": r.get("published_at") or r.get("created_at"), "prerelease": bool(r.get("prerelease")),
        "body_html": r.get("body_html") or "",
        "assets": [{"name": a["name"], "url": a["browser_download_url"], "size": a["size"]} for a in r.get("assets", [])],
    }

token = os.environ.get("GITHUB_TOKEN", "")
projects = json.load(open("projects.json", encoding="utf-8"))
try:
    old = json.load(open("releases.json", encoding="utf-8"))
except Exception:
    old = {"checkedAt": None, "projects": {}}

out = {"checkedAt": None, "projects": dict(old.get("projects", {}))}
failed = False
for p in projects:
    repo = p.get("releases")
    if not repo:
        continue
    try:
        lst = get("https://api.github.com/repos/%s/releases?per_page=5" % repo, token)
        pick = next((x for x in (lst or []) if not x.get("draft")), None)
        out["projects"][p["name"]] = norm(pick) if pick else None
    except Exception as e:
        failed = True
        print("check failed for %s: %s" % (repo, e), file=sys.stderr)

if failed:
    # Keep the old snapshot (and its old time) so the page knows it is stale and checks for itself.
    out["checkedAt"] = old.get("checkedAt")
else:
    out["checkedAt"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# Always rewrite: the checkedAt time is what tells the page the snapshot is fresh (hourly fallback).
with open("releases.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("releases.json written, checked at", out["checkedAt"])
