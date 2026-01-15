#!/bin/bash
export FEISHU_APP_ID="cli_a9ecb12099fbdcbb"
export FEISHU_APP_SECRET="lQv032AHmNCKd3nY8MrlQgVbtMl6gIZr"
# export FEISHU_USER_TOKEN="u-ef203d93-146d-4bb1-a67b-402a11b65da9"
export FEISHU_USER_EMAIL="hanzhijian@zepp.com"
node /home/hanzj/workspace/mcp_server/feishu-mcp-server/build/index.js "$@"
