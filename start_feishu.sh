#!/bin/bash
# 飞书离线监听启动脚本

export FEISHU_APP_ID="cli_a6b21804b52b500b"
export FEISHU_APP_SECRET="03QDxSBmkr3CexYkZyDsAEFdfq1itLUh"
export FEISHU_USER_TOKEN="u-ef203d93-146d-4bb1-a67b-402a11b65da9"

SERVER_PATH="/home/hanzj/workspace/mcp_server/feishu-mcp-server/build/index.js"

if [ "$1" == "stop" ]; then
    echo "正在停止飞书监听进程..."
    pkill -f "$SERVER_PATH"
    exit 0
fi

echo "正在后台启动飞书监听器 (Socket Mode)..."
# 使用 nohup 让进程在终端关闭后继续运行，日志重定向到 feishu_log.txt
nohup node "$SERVER_PATH" > /home/hanzj/workspace/mcp_server/feishu-mcp-server/feishu_log.txt 2>&1 &

echo "启动成功！"
echo "你可以通过执行 'tail -f /home/hanzj/workspace/mcp_server/feishu-mcp-server/feishu_log.txt' 查看运行日志。"
echo "如果不想要它运行了，请执行 './start_feishu.sh stop'。"
