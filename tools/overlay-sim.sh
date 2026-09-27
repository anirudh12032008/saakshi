#!/bin/sh
# Starts a capture-excluded window named overlay-sim, and a fake "AnyDesk" (a renamed sleep), for Act 1 on the Mac.
#   sh tools/overlay-sim.sh start | stop
set -e
APP=apps/seat/release/mac-arm64/Saakshi.app; T="${TMPDIR:-/tmp}/saakshi-act1"
case "$1" in
  start) mkdir -p "$T"; rm -rf "$T/overlay-sim.app"; cp -R "$APP" "$T/overlay-sim.app"
         mv "$T/overlay-sim.app/Contents/MacOS/Saakshi" "$T/overlay-sim.app/Contents/MacOS/overlay-sim"
         /usr/libexec/PlistBuddy -c 'Set :CFBundleExecutable overlay-sim' "$T/overlay-sim.app/Contents/Info.plist"; xattr -cr "$T/overlay-sim.app"
         "$T/overlay-sim.app/Contents/MacOS/overlay-sim" --overlay-sim >/dev/null 2>&1 &
         cp /bin/sleep "$T/AnyDesk"; codesign -s - -f "$T/AnyDesk" 2>/dev/null; "$T/AnyDesk" 3600 & echo "started overlay-sim and AnyDesk" ;;
  stop)  pkill -f "$T/overlay-sim.app" || true; pkill -f "$T/AnyDesk" || true; echo stopped ;;
  *) echo "usage: $0 start|stop"; exit 2 ;;
esac
