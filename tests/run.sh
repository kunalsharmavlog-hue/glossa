#!/bin/sh
# End-to-end test: loads the real extension in headless Chrome on a mock Netflix page and checks
# capture, Pause & Pick, saving, phrase and line lookups, the translation backup, the PDF and the popup.
# Needs Google Chrome, Node 22+, openssl and ffmpeg. Uses the internet for dictionary lookups.
set -e
cd "$(dirname "$0")"
mkdir -p .work
[ -f .work/cert.pem ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout .work/key.pem -out .work/cert.pem -days 365 -subj "/CN=www.netflix.com" -addext "subjectAltName=DNS:www.netflix.com" 2>/dev/null
[ -f .work/movie.mp4 ] || ffmpeg -loglevel error -y -f lavfi -i "color=c=0x223344:s=320x180:d=360:r=4" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -movflags +faststart .work/movie.mp4
rm -rf .work/profile
node e2e.mjs ..
