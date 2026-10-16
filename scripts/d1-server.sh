#!/bin/bash
# d1 判定サーバの起動/停止。dGPU は cardwire 経由でしか使わない。
#
#   scripts/d1-server.sh start [3b|600m]   既定は 3b
#   scripts/d1-server.sh stop  [3b|600m]
#   scripts/d1-server.sh status [3b|600m]
#   scripts/d1-server.sh logs  [3b|600m]
#   scripts/d1-server.sh probe [3b|600m]   1 件投げて動作確認
#
# ポート/モデルを差し替える場合:
#   D1_MODEL_PATH=... D1_PORT=9000 scripts/d1-server.sh start
set -euo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LLAMA_DIR="${D1_LLAMA_DIR:-/home/neutron42/dev/LLM/d1/llama.cpp}"
LLAMA_SERVER="$LLAMA_DIR/build/bin/llama-server"
MODELS_DIR="${D1_MODELS_DIR:-/home/neutron42/LocalLLMs/LiquidAI}"
RUN_DIR="$PROJ/.run"

cmd="${1:-status}"
variant="${2:-3b}"

case "$variant" in
  3b)
    D1_MODEL_PATH="${D1_MODEL_PATH:-$MODELS_DIR/d1-3B-GGUF/d1-3B-Q4_K_M.gguf}"
    D1_PORT="${D1_PORT:-8081}"
    ;;
  600m | omni)
    D1_MODEL_PATH="${D1_MODEL_PATH:-$MODELS_DIR/d1-omni-600M-GGUF/d1-omni-600M-Q8_0.gguf}"
    D1_PORT="${D1_PORT:-8082}"
    ;;
  *)
    echo "unknown variant: $variant (3b | 600m)" >&2
    exit 2
    ;;
esac

PIDFILE="$RUN_DIR/d1-server-$variant.pid"
LOGFILE="$RUN_DIR/d1-server-$variant.log"

is_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

case "$cmd" in
  start)
    if curl -fsS --max-time 2 "http://127.0.0.1:$D1_PORT/health" >/dev/null 2>&1; then
      echo "port $D1_PORT is already serving (not started by this script)"
      exit 0
    fi
    [ -x "$LLAMA_SERVER" ] || {
      echo "llama-server not found: $LLAMA_SERVER" >&2
      exit 1
    }
    [ -f "$D1_MODEL_PATH" ] || {
      echo "model not found: $D1_MODEL_PATH" >&2
      exit 1
    }
    mkdir -p "$RUN_DIR"
    cd "$LLAMA_DIR"
    nohup cardwire launch --gpu 1 "$LLAMA_SERVER" \
      -m "$D1_MODEL_PATH" \
      --host 127.0.0.1 --port "$D1_PORT" \
      --n-gpu-layers 99 -b 4096 -ub 4096 \
      >"$LOGFILE" 2>&1 &
    echo $! >"$PIDFILE"
    for _ in $(seq 1 120); do
      if curl -fsS --max-time 2 "http://127.0.0.1:$D1_PORT/health" >/dev/null 2>&1; then
        echo "started: http://127.0.0.1:$D1_PORT/v1/systemone (model $(basename "$D1_MODEL_PATH"))"
        exit 0
      fi
      sleep 1
    done
    echo "server did not become ready; see $LOGFILE" >&2
    tail -20 "$LOGFILE" >&2 || true
    exit 1
    ;;
  stop)
    if is_running; then
      pid="$(cat "$PIDFILE")"
      # cardwire launch とその子 (llama-server) を止める
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      pkill -KILL -f "llama-server .*--port $D1_PORT" 2>/dev/null || true
      rm -f "$PIDFILE"
      echo "stopped (port $D1_PORT)"
    else
      rm -f "$PIDFILE"
      echo "not running (port $D1_PORT)"
    fi
    ;;
  status)
    if curl -fsS --max-time 3 "http://127.0.0.1:$D1_PORT/props" >/tmp/d1x-props.json 2>/dev/null; then
      echo "serving on $D1_PORT"
      python3 -c 'import json; d=json.load(open("/tmp/d1x-props.json")); print("  model:", d.get("model_path"))' 2>/dev/null ||
        echo "  (props unreadable)"
      is_running && echo "  pid $(cat "$PIDFILE") (started by this script)"
    else
      echo "not serving on $D1_PORT"
    fi
    ;;
  logs)
    tail -n 40 "$LOGFILE"
    ;;
  probe)
    curl -fsS --max-time 60 "http://127.0.0.1:$D1_PORT/v1/systemone" \
      -H 'Content-Type: application/json' \
      -d '{
        "state": "名前: さくら🌸カフェ巡り (@sakura_cafe_love)\n自己紹介: はじめまして！相互フォロー歓迎です。フォロバします！\nフォロー数: 4820\nフォロワー数: 312",
        "questions": {
          "followback": {"type": "noul", "instructions": "プロフィールでフォロバ(相互フォロー)やいいね周りを求めているか"}
        }
      }' | python3 -m json.tool
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
