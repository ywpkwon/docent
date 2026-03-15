#!/usr/bin/env bash
# Quick dev start — runs backend and frontend in parallel
set -e

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example → .env and add your GEMINI_API_KEY."
  exit 1
fi

source .env
export GEMINI_API_KEY

echo "Starting PaperPal dev environment..."
echo ""

# Backend
(
  cd backend
  if [ ! -d .venv ]; then
    echo "[backend] Creating virtualenv..."
    python3 -m venv .venv
  fi
  source .venv/bin/activate
  pip install -q -r requirements.txt
  echo "[backend] Starting FastAPI on :8000"
  GEMINI_API_KEY="$GEMINI_API_KEY" uvicorn main:app --host 0.0.0.0 --port 8000 --reload
) &
BACKEND_PID=$!

# Frontend
(
  cd frontend
  if [ ! -d node_modules ]; then
    echo "[frontend] Installing dependencies..."
    npm install
  fi
  if [ ! -f .env.local ]; then
    echo "NEXT_PUBLIC_BACKEND_URL=http://localhost:8000" > .env.local
  fi
  echo "[frontend] Starting Next.js on :3000"
  npm run dev
) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" INT TERM
echo "PaperPal running at http://localhost:3000"
echo "Press Ctrl+C to stop."
wait
