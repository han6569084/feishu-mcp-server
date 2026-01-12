
const axios = require('axios');

const FEISHU_APP_ID = 'cli_a72db6e3e5b4900c';
const FEISHU_APP_SECRET = 'OqC0Yn867V5rVpXmND8mWhY8XoXmBy1T';

async function getTenantAccessToken() {
    console.log('Fetching tenant_access_token...');
    const response = await axios.post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    });
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data));
    return response.data.tenant_access_token;
}

async function run() {
    try {
        console.log('Getting tenant access token...');
        const token = await getTenantAccessToken();
        console.log(`Token obtained (starts with): ${token.substring(0, 10)}...`);
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        // 1. Create document
        console.log('Creating document...');
        const createRes = await axios.post('https://open.feishu.cn/open-apis/docx/v1/documents', {
            title: 'T3P 自动化工作流集成测试'
        }, { headers });

        const docData = createRes.data.data || createRes.data;
        const documentId = docData.document_id || docData.document.document_id;
        console.log(`Document created: ${documentId}`);

        // 2. Get root block id
        console.log('Fetching root block id...');
        const docInfoRes = await axios.get(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`, { headers });
        const rootBlockId = docInfoRes.data.data.document.block_id;
        console.log(`Root block id: ${rootBlockId}`);

        // 3. Update document content
        console.log('Updating document content...');
        const content = "你好！这是一条由 GitHub Copilot 自动生成的测试文档。\n\n目前我们已经成功集成了：\n1. Gerrit (代码同步与 Review)\n2. Jira (任务管理与状态流转)\n3. 飞书 (文档协作与消息通知)\n\n这标志着 T3P 项目的 AI 辅助开发工作流已正式打通。";
        
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
        console.log('Setting permission for hanzhijian@zepp.com...');
        await axios.post(`https://open.feishu.cn/open-apis/drive/v1/permissions/${documentId}/members`, {
            member_type: 'email',
            member_id: 'hanzhijian@zepp.com',
            perm: 'full_access' // admin
        }, { headers });
        console.log('Permission set.');

        console.log(`SUCCESS: https://zepp.feishu.cn/docx/${documentId}`);
    } catch (error) {
        console.error('ERROR:', error.response ? error.response.data : error.message);
    }
}

run();
