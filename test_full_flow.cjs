const axios = require("axios");

async function run() {
  const appId = "cli_a6b21804b52b500b";
  const appSecret = "03QDxSBmkr3CexYkZyDsAEFdfq1itLUh";
  const userEmail = "hanzhijian@zepp.com";

  console.log("Fetching tenant access token...");
  const tokenResp = await axios.post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    app_id: appId,
    app_secret: appSecret
  });
  console.log("Token Response:", JSON.stringify(tokenResp.data, null, 2));
  const token = tokenResp.data.tenant_access_token;
  if (!token) throw new Error("Failed to get token: " + JSON.stringify(tokenResp.data));

  console.log("Creating document...");
  const docResp = await axios.post(
    "https://open.feishu.cn/open-apis/docx/v1/documents",
    { title: "T3P 自动化工作流集成测试" },
    { headers: { Authorization: "Bearer " + token } }
  );
  
  const docData = docResp.data.data.document;
  const docId = docData.document_id;
  
  console.log("Fetching document to get block_id...");
  const getDocResp = await axios.get(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}`, {
    headers: { Authorization: "Bearer " + token }
  });
  console.log("Full Doc Data:", JSON.stringify(getDocResp.data, null, 2));
  const rootBlockId = getDocResp.data?.data?.document?.document_id || getDocResp.data?.data?.document?.block_id;
  console.log(`Document ID: ${docId}, Root Block ID (used for children): ${rootBlockId}`);

  console.log("Adding content...");
  await axios.post(
    `https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${rootBlockId}/children`,
    {
      children: [{
        block_type: 2, // Text block
        text: {
          elements: [{
            text_run: {
              content: "你好！这是一条由 GitHub Copilot 自动生成的测试文档。\n\n目前我们已经成功集成了：\n1. Gerrit (代码同步与 Review)\n2. Jira (任务管理与状态流转)\n3. 飞书 (文档协作与消息通知)\n\n这标志着 T3P 项目的 AI 辅助开发工作流已正式打通。"
            }
          }]
        }
      }]
    },
    { headers: { Authorization: "Bearer " + token } }
  );

  console.log(`Setting admin permission for ${userEmail}...`);
  await axios.post(
    `https://open.feishu.cn/open-apis/drive/v1/permissions/${docId}/members?type=docx`,
    {
      member_type: "email",
      member_id: userEmail,
      perm: "full_access" // equivalent to admin in drive API
    },
    { headers: { Authorization: "Bearer " + token } }
  );

  console.log("\n--- TEST SUCCESSFUL ---");
  console.log(`Title: T3P 自动化工作流集成测试`);
  console.log(`Link: https://zepp.feishu.cn/docx/${docId}`);
}

run().catch((err) => {
  console.error("Error:");
  console.error(err.response ? JSON.stringify(err.response.data, null, 2) : err.message);
  process.exit(1);
});
