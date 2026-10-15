#!/usr/bin/env bash
# Publishes a desktop release for everyone: copies the installers, the update files and latest.json from the code
# repo's draft release (made by the Desktop workflow for a desktop-vX.Y.Z tag) to a release on the public downloads
# repo, marked Latest. Installed apps read latest.json from there and update themselves; /download lists the
# installers. latest.json's links are rewritten to the downloads repo (the code repo is private).
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
sed -i "s#https://github.com/$CODE_REPO/releases/download/#https://github.com/$DOWNLOADS_REPO/releases/download/#g" "$DIR/latest.json"
if grep -q "github.com/$CODE_REPO/" "$DIR/latest.json"; then
  echo "latest.json still points at $CODE_REPO" >&2
  exit 1
fi

gh release create "$TAG" -R "$DOWNLOADS_REPO" --title "Ctrl Room desktop ${TAG#desktop-v}" --notes-file "$NOTES" --latest "$DIR"/*
echo "Published https://github.com/$DOWNLOADS_REPO/releases/tag/$TAG"
