const axios = require('axios');

const appId = 'cli_a72db6e3e5b4900c';
const appSecret = 'OqC0Yn867V5rVpXmND8mWhY8XoXmBy1T';
const userToken = 'u-ef203d93-146d-4bb1-a67b-402a11b65da9';
const email = 'hanzhijian@zepp.com';
const text = '你好，我是 GitHub Copilot。这是一条来自本地 MCP Server (feishu-local) 的测试消息，证明我们的飞书集成已经成功开启。';

async function sendMessage() {
  try {
    const response = await axios.post(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=email",
      {
        receive_id: email,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
      {
        headers: { Authorization: `Bearer ${userToken}` },
      }
    );
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error(error.response ? error.response.data : error.message);
  }
}

sendMessage();
