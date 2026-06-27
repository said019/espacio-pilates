#!/bin/sh
# Arranque compartido para los dos servicios de Railway desde el mismo repo.
# Backend (API): SERVE_MODE != frontend  -> node server/index.js
# Frontend (estático SPA): SERVE_MODE = frontend -> sirve dist/ con fallback SPA
set -e
if [ "$SERVE_MODE" = "frontend" ]; then
  echo "▶ Frontend estático en :$PORT"
  exec npx serve -s dist -l "${PORT:-3000}"
else
  echo "▶ Backend API"
  exec node server/index.js
fi
