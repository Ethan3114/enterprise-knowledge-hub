#!/bin/sh
# 同时启动本机 API 和页面。页面把 /api 转发到 8000 端口。
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ ! -x backend/.venv/bin/uvicorn ]; then
  echo "还没有安装后端依赖。请先执行：backend/.venv/bin/pip install -r backend/requirements.txt" >&2
  exit 1
fi

backend/.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 &
API_PID=$!
VITE_PID=

cleanup() {
  if [ -n "${VITE_PID:-}" ]; then
    pkill -P "$VITE_PID" 2>/dev/null || true
    kill "$VITE_PID" 2>/dev/null || true
  fi
  pkill -P "$API_PID" 2>/dev/null || true
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=0
i=0
while [ "$i" -lt 40 ]; do
  if curl -sf http://127.0.0.1:8000/api/health >/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    exit 1
  fi
  i=$((i + 1))
  sleep 0.25
done

if [ "$ready" -ne 1 ]; then
  echo "本机服务没有在 8000 端口启动" >&2
  exit 1
fi

npm run dev &
VITE_PID=$!
wait "$VITE_PID"
