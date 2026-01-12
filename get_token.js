// 手动获取飞书用户token的脚本
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 配置
const appId = 'cli_a6b21804b52b500b';
const appSecret = '03QDxSBmkr3CexYkZyDsAEFdfq1itLUh';
const redirectUri = 'https://httpbin.org/get'; // 使用在线服务作为回调地址

// 从命令行参数获取授权码
const code = process.argv[2];
if (!code) {
  console.error('请提供授权码作为参数');
  console.error('用法: node get_token.js <authorization_code>');
  process.exit(1);
}

async function exchangeCodeForToken(code) {
  try {
    console.log('正在交换授权码获取token...');
    const response = await axios.post('https://open.feishu.cn/open-apis/authen/v1/access_token', {
      grant_type: 'authorization_code',
      code: code,
      app_id: appId,
      app_secret: appSecret,
      redirect_uri: redirectUri,
    });

    const tokenData = response.data;
    console.log('Token获取成功！');

    // 保存token到文件
    const tokenPath = path.join(__dirname, 'user_token.json');
    fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));
    console.log(`Token已保存到: ${tokenPath}`);

    return tokenData;
  } catch (error) {
    console.error('获取token失败:', error.response?.data || error.message);
    process.exit(1);
  }
}

exchangeCodeForToken(code);