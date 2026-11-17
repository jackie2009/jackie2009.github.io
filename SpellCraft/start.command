#!/bin/bash
# 双击运行：启动本地服务器并在浏览器中打开演示
cd "$(dirname "$0")"
PORT=8765
( sleep 1; open "http://localhost:$PORT/index.html" ) &
python3 -m http.server $PORT
