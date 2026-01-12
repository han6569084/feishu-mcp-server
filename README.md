# Feishu MCP Server

这是一个基于 Model Context Protocol (MCP) 的飞书 (Feishu/Lark) 服务端实现，允许 AI 助手创建飞书日程和文档。

## 功能

- `create_schedule`: 创建飞书日程。
- `create_document`: 创建飞书文档 (Docx)。

## 配置

要在 Cline 或其他支持 MCP 的客户端中使用此服务器，请在配置文件中添加以下内容：

```json
{
  "mcpServers": {
    "feishu": {
      "command": "node",
      "args": ["/home/hanzj/workspace/mcp_server/feishu-mcp-server/build/index.js"],
      "env": {
        "FEISHU_APP_ID": "您的飞书 App ID",
        "FEISHU_APP_SECRET": "您的飞书 App Secret"
      }
    }
  }
}
```

### 如何获取 App ID 和 App Secret

1. 访问 [飞书开放平台](https://open.feishu.cn/app).
2. 创建一个企业自建应用。
3. 在“凭证与基础信息”中获取 `App ID` 和 `App Secret`。
4. 在“权限管理”中添加以下权限：
   - `calendar:calendar` (日历)
   - `docx:document` (文档)
5. 发布应用。

### 所需权限详情

为了实现自动授权和发送通知，应用需要以下权限：
- `docx:document` (文档)
- `drive:permission` (云文档权限管理)
- `im:message` (即时消息 - 发送消息)
- `im:message.p2p_msg:readonly` (读取单聊消息，用于获取会话)

## 开发

安装依赖：
```bash
npm install
```

编译：
```bash
npm run build
```
