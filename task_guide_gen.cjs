const axios = require('axios');

const FEISHU_APP_ID = "cli_a6b21804b52b500b";
const FEISHU_APP_SECRET = "03QDxSBmkr3CexYkZyDsAEFdfq1itLUh";
const FEISHU_USER_TOKEN = "u-ef203d93-146d-4bb1-a67b-402a11b65da9";
const targetEmail = "hanzhijian@zepp.com";

async function getTenantAccessToken() {
    const response = await axios.post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
    });
    return response.data.tenant_access_token;
}

async function run() {
    try {
        console.log('Fetching tenant access token...');
        const token = await getTenantAccessToken();
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        // 1. Create document
        console.log('Creating document "T3P Feishu MCP Server 操作指南"...');
        const createRes = await axios.post('https://open.feishu.cn/open-apis/docx/v1/documents', {
            title: 'T3P Feishu MCP Server 操作指南'
        }, { headers });

        if (createRes.data.code !== 0) {
            throw new Error(`Failed to create document: ${JSON.stringify(createRes.data)}`);
        }

        const docData = createRes.data.data;
        const documentId = docData.document.document_id;
        console.log(`Document created: ${documentId}`);

        // 2. Get root block id
        const docInfoRes = await axios.get(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`, { headers });
        const rootBlockId = docInfoRes.data.data.document.document_id; 

        // 3. Update document content
        const content = `# T3P 飞书 MCP Server 指引

## 服务管理命令
- **启动服务**: \`/home/hanzj/workspace/mcp_server/feishu-mcp-server/start_feishu.sh\`
- **停止服务**: \`/home/hanzj/workspace/mcp_server/feishu-mcp-server/start_feishu.sh stop\`
- **实时日志**: \`tail -f /home/hanzj/workspace/mcp_server/feishu-mcp-server/feishu_log.txt\`

## 注意事项
- 修改代码后请先执行 \`npm run build\` 再重启脚本。
- 文档操作默认已切换为应用 Token 身份，并自动同步管理员权限。`;

        await axios.post(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${rootBlockId}/children`, {
            children: [
                {
                    block_type: 2,
                    text: {
                        elements: [
                            {
                                text_run: {
                                    content: content
                                }
                            }
                        ]
                    }
                }
            ]
        }, { headers });
        console.log('Content updated.');

        // 4. Set permission
        console.log(`Setting admin permission for ${targetEmail}...`);
        await axios.post(`https://open.feishu.cn/open-apis/drive/v1/permissions/${documentId}/members?type=docx`, {
            member_type: 'email',
            member_id: targetEmail,
            perm: 'full_access'
        }, { headers });
        console.log('Permission set.');

        // 5. Send message
        const docLink = `https://zepp.feishu.cn/docx/${documentId}`;
        const messageText = `您好！T3P Feishu MCP Server 操作指南已生成。\n链接：${docLink}`;
        
        console.log(`Sending message to ${targetEmail}...`);
        await axios.post('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=email', {
            receive_id: targetEmail,
            msg_type: 'text',
            content: JSON.stringify({ text: messageText })
        }, { headers });
        console.log('Message sent.');

        console.log(`FINAL_LINK: ${docLink}`);
    } catch (error) {
        console.error('ERROR:', error.response ? error.response.data : error.message);
        process.exit(1);
    }
}

run();
