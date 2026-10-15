#!/usr/bin/env bash
# Publishes a desktop release for everyone: copies the installers, the update files and latest.json from the code
# repo's draft release (made by the Desktop workflow for a desktop-vX.Y.Z tag) to a release on the public downloads
# repo, marked Latest. Installed apps read latest.json from there and update themselves; /download lists the
# installers. The draft's latest.json links to the private repo's assets by id, so every link is rewritten to the
# same file on the downloads repo, and its notes become the release notes.
# Usage: desktop/scripts/publish.sh desktop-v0.1.2 notes.md
set -euo pipefail
TAG="${1:?usage: publish.sh desktop-vX.Y.Z notes.md}"
NOTES="${2:?usage: publish.sh desktop-vX.Y.Z notes.md}"
CODE_REPO="${CODE_REPO:-claycovyn/ctrlroom}"
DOWNLOADS_REPO="${DOWNLOADS_REPO:-claycovyn/ctrlroom-downloads}"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

gh release download "$TAG" -R "$CODE_REPO" -D "$DIR" \
  -p '*-setup.exe' -p '*-setup.exe.sig' -p '*.msi' -p '*.msi.sig' \
  -p '*.dmg' -p '*.app.tar.gz' -p '*.app.tar.gz.sig' \
  -p '*.AppImage' -p '*.AppImage.sig' -p '*.deb' -p '*.deb.sig' -p '*.rpm' -p '*.rpm.sig' \
  -p 'latest.json'
test -s "$DIR/latest.json" || { echo "no latest.json on $TAG: was it built with the updater key?" >&2; exit 1; }
gh release view "$TAG" -R "$CODE_REPO" --json assets > "$DIR/assets.json.tmp"

node - "$DIR" "$DOWNLOADS_REPO" "$TAG" "$NOTES" <<'JS'
const fs = require("fs");
const path = require("path");
const [dir, repo, tag, notesFile] = process.argv.slice(2);
const file = path.join(dir, "latest.json");
const feed = JSON.parse(fs.readFileSync(file, "utf8"));
const byUrl = new Map();
for (const a of JSON.parse(fs.readFileSync(path.join(dir, "assets.json.tmp"), "utf8")).assets) {
  byUrl.set(a.apiUrl.toLowerCase(), a.name);
  byUrl.set(a.url.toLowerCase(), a.name);
}
for (const [key, p] of Object.entries(feed.platforms)) {
  const name = byUrl.get(p.url.toLowerCase()) ?? decodeURIComponent(p.url.split("/").pop());
  if (!fs.existsSync(path.join(dir, name))) throw new Error(`${key}: ${name} isn't in the release`);
  p.url = `https://github.com/${repo}/releases/download/${tag}/${name}`;
}
feed.notes = fs.readFileSync(notesFile, "utf8").split(/\n\s*\n/)[0].trim();
fs.writeFileSync(file, JSON.stringify(feed, null, 2) + "\n");
fs.unlinkSync(path.join(dir, "assets.json.tmp"));
console.log(Object.entries(feed.platforms).map(([k, p]) => `${k} -> ${p.url}`).join("\n"));
JS

gh release create "$TAG" -R "$DOWNLOADS_REPO" --title "Ctrl Room desktop ${TAG#desktop-v}" --notes-file "$NOTES" --latest "$DIR"/*
echo "Published https://github.com/$DOWNLOADS_REPO/releases/tag/$TAG"
