#!/bin/zsh
cd "$(dirname "$0")"
echo "Starting Application Tracker..."
echo "Opening http://localhost:4174 in your browser."
(sleep 2; open "http://localhost:4174") &
npm start
