# Feishu MCP Server

这是一个基于 Model Context Protocol (MCP) 的飞书 (Feishu/Lark) 服务端实现，专为 AI 助手（如 GitHub Copilot、Cline）设计，使其具备深度集成飞书办公生态的能力。

## 核心功能

### 1. 文档与知识库管理
*   **创建文档** (`create_document`): 快速生成飞书 Docx 文档，支持指定保存目录。
*   **插入/更新内容** (`update_document`): 向现有文档内追加文本块。
*   **创建 Wiki** (`create_wiki`): 在指定知识库空间内创建页面，并自动配置公开访问权限。
*   **权限控制** (`set_document_permission`): 自动化管理文档的协作权限（阅读、编辑、全权限）。

### 2. 日程与协同
*   **会议日程** (`create_schedule`): 给指定日历（默认主日历）创建日程，包含摘要、描述及时间跨度。

### 3. 即时通讯与自动化
*   **发送消息** (`send_message`): 通过机器人向指定用户（Email 标识）发送私聊。
*   **智能卡片通知**: 在 AI 完成文档/Wiki 创建后，会自动向用户推送私聊消息，附带直达链接。
*   **双向互动**: 支持飞书消息订阅（Socket Mode），当用户在飞书内给机器人发消息时，机器人能自动实时回复。

### 4. 授权与管理
*   **双重 Token 机制**:
    *   **Tenant Access Token**: 适合后台静默操作，由管理员预先授权。
    *   **User Access Token (OAuth)**: 支持以用户本人身份操作。
*   **动态 OAuth 流程** (`start_oauth`): 允许 AI 在需要时动态开启一个轻量级回调服务端，引导用户完成授权。
*   **Token 重置** (`reset_user_token`): 快速清除本地缓存的授权信息。

---

## 快速开始：在 VS Code GitHub Copilot 中使用

GitHub Copilot 现在支持通过 MCP 协议连接自定义工具，使 AI 能够直接操作你的飞书应用。

### 1. 环境准备
确保你已安装 **VS Code** 且启用了 **GitHub Copilot Chat** 插件（建议使用最新 Pre-release 版本以获得更好的 MCP 支持）。

### 2. 配置 MCP 服务
在 VS Code 的 `settings.json` 中添加以下配置（快捷键 `Cmd+Shift+P` -> `Open User Settings (JSON)`）：

```json
{
  "github.copilot.chat.mcp.servers": [
    {
      "name": "feishu",
      "command": "node",
      "args": ["/home/hanzj/workspace/mcp_server/feishu-mcp-server/build/index.js"],
      "env": {
        "FEISHU_APP_ID": "您的飞书 App ID",
        "FEISHU_APP_SECRET": "您的飞书 App Secret",
        "FEISHU_USER_EMAIL": "您的邮箱(用于接收通知)"
      }
    }
  ]
}
```
> **注意**: 请务必使用 `build/index.js` 的 **绝对路径**。

### 3. 飞书应用权限配置
前往 [飞书开放平台](https://open.feishu.cn/app)，进入你的应用，在“权限管理”中开通以下范围：
- **日历**: `calendar:calendar`
- **文档**: `docx:document`
- **云文档**: `drive:permission`
- **即时消息**: `im:message`, `im:message.p2p_msg:readonly`

在“事件订阅”中，开启 **机器人能力**。

---

## 常用操作指令示例

在 GitHub Copilot Chat 侧边栏中，你可以尝试：

*   *“帮我创建一个飞书文档，标题是'下周项目计划'，内容包括进度同步和风险点。”*
*   *“在飞书里发个消息给 [your-email]，告诉他会议改到 3 点了。”*
*   *“帮我订一个明天下午 2 点的飞书日程，主题是‘架构评审’。”*

---

## 开发与维护

### 安装依赖
```bash
npm install
```

### 编译
```bash
npm run build
```

### 本地监听测试 (Socket Mode)
项目提供了一个便捷脚本用于在后台运行长连接监听：
```bash
./start_feishu.sh       # 启动
./start_feishu.sh stop  # 停止
tail -f feishu_log.txt  # 查看实时日志
```
