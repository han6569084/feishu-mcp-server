const axios = require('axios');

const appId = "cli_a6b21804b52b500b";
const appSecret = "03QDxSBmkr3CexYkZyDsAEFdfq1itLUh";
const userToken = "u-ef203d93-146d-4bb1-a67b-402a11b65da9";
const targetEmail = "hanzhijian@zepp.com";

async function main() {
    try {
        const token = userToken;
        const headers = { Authorization: `Bearer ${token}` };

        // 1. Create document
        console.log("Creating document...");
        const createResp = await axios.post(
            "https://open.feishu.cn/open-apis/docx/v1/documents",
            { title: "T3P Feishu MCP Server 操作指南" },
            { headers }
        );
        const docData = createResp.data.data;
        const documentId = docData.document.document_id;
        console.log(`Document created. ID: ${documentId}`);

        // 2. Add content
        console.log("Adding content...");
        const rootBlockResp = await axios.get(
            `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`,
            { headers }
        );
        const rootBlockId = rootBlockResp.data.data.document.document_id;

        const content = `# T3P Feishu MCP Server 运维手册

本项目集成了飞书长连接（Socket Mode），可以 7x24 小时监听并响应事件。

## 1. 启动与停止指南
所有操作通过本地脚本 start_feishu.sh 完成。

- **启动监听器**：
  /home/hanzj/workspace/mcp_server/feishu-mcp-server/start_feishu.sh
  (该命令会自动设置环境变量并在后台运行 Node.js 进程)

- **停止监听器**：
  /home/hanzj/workspace/mcp_server/feishu-mcp-server/start_feishu.sh stop

- **查看实时日志**：
  tail -f /home/hanzj/workspace/mcp_server/feishu-mcp-server/feishu_log.txt

## 2. 代码更新流程
如果你修改了 src/index.ts 中的逻辑，请执行：
1. npm run build (在 feishu-mcp-server 目录下)
2. ./start_feishu.sh stop
3. ./start_feishu.sh

## 3. 注意事项
- 此后台进程与 Copilot 使用的 MCP 实例互不冲突。
- 飞书长连接支持多连接，推荐保持后台进程运行。`;

        // We use the simple append logic from the index.ts but slightly improved if needed
        // index.ts uses block_type: 2 (Text)
        await axios.post(
            `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${rootBlockId}/children`,
            {
                children: [
                    {
                        block_type: 2,
                        text: {
                            elements: [
                                {
                                    text_run: {
                                        content: content,
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
            { headers }
        );

        // 3. Set permission
        console.log(`Setting admin permission for ${targetEmail}...`);
        await axios.post(
            `https://open.feishu.cn/open-apis/drive/v1/permissions/${documentId}/members`,
            {
                member_type: "email",
                member_id: targetEmail,
                perm: "full_access",
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
            }
        );

        // 4. Send final message
        const docLink = `https://zepp.feishu.cn/docx/${documentId}`;
        const messageText = `您好，我已经为您生成了《T3P Feishu MCP Server 操作指南》，包含启动、停止及维护方法。链接见：${docLink}`;
        console.log(`Sending message to ${targetEmail}...`);
        await axios.post(
            "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=email",
            {
                receive_id: targetEmail,
                msg_type: "text",
                content: JSON.stringify({ text: messageText }),
            },
            { headers }
        );

        console.log("All steps completed successfully.");
        console.log(`Document ID: ${documentId}`);
        console.log(`Document Link: ${docLink}`);

    } catch (error) {
        console.error("Error occurred:");
        if (error.response) {
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
        process.exit(1);
    }
}

main();
