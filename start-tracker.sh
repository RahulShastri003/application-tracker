#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
echo "Starting Application Tracker..."
echo "Opening http://localhost:4174 in your browser."
(sleep 2; command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:4174" >/dev/null 2>&1) &
npm start
