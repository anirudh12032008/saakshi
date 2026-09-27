#!/bin/sh
# electron-builder >= 26.0.13's own ad-hoc path breaks camera frames; sign ad-hoc ourselves after fuses are flipped.
set -e
APP=$(ls -d release/mac*/Saakshi.app | head -1)
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "ad-hoc signed: $APP"
