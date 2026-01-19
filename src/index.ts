import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import * as http from "http";
import * as fs from "fs";
import { z } from "zod";
import * as Lark from '@larksuiteoapi/node-sdk';

// Initialize Feishu configuration
const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;

// Optional: default user email (for notifications)
const defaultUserEmail = process.env.FEISHU_USER_EMAIL || "hanzhijian@zepp.com";

// OAuth callback server settings
const oauthPort = parseInt(process.env.FEISHU_OAUTH_PORT || "8000", 10);
// 在 Remote/容器环境里，推荐配合 VS Code 端口转发，把远端 8000 转发到本机 8000，然后用 127.0.0.1 作为回调地址
const redirectUri = process.env.FEISHU_REDIRECT_URI || `http://127.0.0.1:8000/callback`;
// 监听地址：默认 0.0.0.0，便于端口转发场景（也可通过 env 改为 127.0.0.1）
const oauthHost = process.env.FEISHU_OAUTH_HOST || "0.0.0.0";
// OAuth scope：必须是飞书 OAuth 支持的 scope 名称；不要把“应用权限名”误当成 OAuth scope
// 默认仍给 wiki:wiki（兼容原逻辑），实际要文档/消息请通过 FEISHU_OAUTH_SCOPE 显式配置
const oauthScope = process.env.FEISHU_OAUTH_SCOPE || "wiki:wiki";

const userTokenPath =
  process.env.FEISHU_USER_TOKEN_PATH ||
  `${process.cwd()}/tools/feishu-mcp-server/user_token.json`;
let oauthServerRunning = false;

function extractAccessToken(obj: any): string | undefined {
  if (!obj) return undefined;
  return (
    obj?.access_token ||
    obj?.data?.access_token ||
    obj?.data?.accessToken ||
    obj?.accessToken ||
    obj?.token ||
    obj?.data?.token
  );
}

// User access token (OAuth user token). If provided, we will use this
// token to create documents directly in the user's personal space.
let userAccessToken = process.env.FEISHU_USER_TOKEN;
// Load user token from file if environment variable is not set
if (false && !userAccessToken) {
  const loadedToken = loadUserTokenFromFile();
  const loadedAccessToken = extractAccessToken(loadedToken);
  if (loadedAccessToken) {
    userAccessToken = loadedAccessToken;
  }
}

// If no user token available, provide manual setup option
if (false && !userAccessToken) {
  console.error("No user token found.");
  console.error("Option 1 - OAuth Flow:");
  console.error("Please visit the following URL to authorize:");
  console.error(buildAuthUrl());
  console.error("");
  console.error("Option 2 - Manual Token Setup:");
  console.error("Set FEISHU_USER_TOKEN environment variable or create user_token.json file");
  console.error("Example: FEISHU_USER_TOKEN=your_access_token_here npm start");
  console.error("");
  startOauthServerOnce();
}

if (!appId || !appSecret) {
  console.error("Missing required environment variables: FEISHU_APP_ID, FEISHU_APP_SECRET");
  process.exit(1);
}

async function getTenantAccessToken() {
  const response = await axios.post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    app_id: appId,
    app_secret: appSecret,
  });
  return response.data.tenant_access_token;
}

function loadUserTokenFromFile(): any | null {
  try {
    if (fs.existsSync(userTokenPath)) {
      const rawText = fs.readFileSync(userTokenPath, "utf8");
      const raw = JSON.parse(rawText);
      return raw;
    }
  } catch (e) {
    console.error("Failed to load user token file:", e);
  }
  return null;
}

function saveUserTokenToFile(obj: any) {
  try {
    fs.writeFileSync(userTokenPath, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save user token file:", e);
  }
}

async function exchangeCodeForToken(code: string) {
  console.error(`Exchanging code for token with app_id: ${appId}, app_secret: ${appSecret ? 'present' : 'missing'}`);
  const resp = await axios.post("https://open.feishu.cn/open-apis/authen/v1/access_token", {
    grant_type: "authorization_code",
    code: code,
    app_id: appId,
    app_secret: appSecret,
    redirect_uri: redirectUri,
  });
  return resp.data;
}

function buildAuthUrl(state = "mcp_auth") {
  const params = new URLSearchParams();
  if (appId) params.set("app_id", appId);
  params.set("redirect_uri", redirectUri);
  params.set("response_type", "code");
  params.set("scope", oauthScope);
  params.set("state", state);
  return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}`;
}

function startOauthServerOnce() {
  if (oauthServerRunning) return;
  const server = http.createServer(async (req, res) => {
    if (!req.url) return;
    const u = new URL(req.url, `http://localhost:${oauthPort}`);
    console.error(`Received callback request: ${u.pathname}${u.search}`);

    if (u.pathname === "/callback" || u.pathname === "/oauth/callback") {
      const code = u.searchParams.get("code");
      const state = u.searchParams.get("state");
      console.error(`Processing callback with code: ${code ? 'present' : 'missing'}, state: ${state}`);

      if (code) {
        try {
          console.error("Exchanging code for token...");
          const tokenResp = await exchangeCodeForToken(code);
          console.error("Token exchange response:", JSON.stringify(tokenResp, null, 2));

          // tokenResp typically: { code, msg, data: { access_token, refresh_token, ... } }
          userAccessToken = extractAccessToken(tokenResp);
          if (userAccessToken) {
            saveUserTokenToFile(tokenResp);
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`<html><body>授权成功！可以关闭此窗口。state=${state}</body></html>`);
            console.error("OAuth: received token and saved to file.");
          } else {
            console.error("No access token found in response");
            res.writeHead(500, { "Content-Type": "text/html" });
            res.end(`<html><body>获取token失败，请查看服务端日志。</body></html>`);
          }
        } catch (e) {
          console.error("OAuth token exchange failed:", e);
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<html><body>授权失败，请查看服务端日志。错误: ${(e as Error).message}</body></html>`);
        }
      } else {
        console.error("No code parameter in callback");
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<html><body>缺少 code 参数</body></html>`);
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on("error", (err: any) => {
    if (err?.code === "EADDRINUSE") {
      console.error(
        `OAuth server failed to listen on http://${oauthHost}:${oauthPort} (EADDRINUSE). ` +
          `Please set FEISHU_OAUTH_PORT/FEISHU_REDIRECT_URI to a free port, or stop the process using this port.`
      );
      oauthServerRunning = false;
      return;
    }
    console.error("OAuth server error:", err);
    oauthServerRunning = false;
  });

  server.listen(oauthPort, oauthHost, () => {
    oauthServerRunning = true;
    console.error(`OAuth server listening on http://${oauthHost}:${oauthPort}`);
    console.error(`Accepting callbacks on /callback and /oauth/callback`);
    console.error(`redirect_uri=${redirectUri}`);
    console.error(`scope=${oauthScope}`);
  });
}

const server = new Server(
  {
    name: "feishu-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tool schemas
const CreateScheduleSchema = z.object({
  summary: z.string(),
  description: z.string().optional(),
  startTime: z.string().describe("ISO 8601 format, e.g., 2023-10-01T10:00:00Z"),
  endTime: z.string().describe("ISO 8601 format, e.g., 2023-10-01T11:00:00Z"),
  calendarId: z.string().default("primary"),
});

const CreateDocumentSchema = z.object({
  title: z.string(),
  content: z.string().optional().describe("Initial content for the document"),
  folderToken: z.string().optional().describe("The token of the folder where the document will be created"),
  // optional: email of the user who should be the owner / receiver of the notification
  userEmail: z.string().optional().describe("Email of the user to receive the doc and notification"),
});

const CreateWikiSchema = z.object({
  title: z.string(),
  spaceId: z.string().optional().describe("The ID of the space where the wiki will be created"),
  // optional: email of the user who should be the owner / receiver of the notification
  userEmail: z.string().optional().describe("Email of the user to receive the wiki and notification"),
});

const SetDocumentPermissionSchema = z.object({
  documentId: z.string(),
  email: z.string(),
  permission: z.enum(["edit", "view", "admin"]).default("admin"),
});

const UpdateDocumentSchema = z.object({
  documentId: z.string(),
  content: z.string(),
});

const CreateTaskSchema = z.object({
  summary: z.string(),
  description: z.string().optional(),
  dueTime: z.string().optional().describe("ISO 8601 format or timestamp in seconds"),
  assigneeEmail: z.string().optional().describe("Email of the person to assign the task to"),
});

const SendMessageSchema = z.object({
  email: z.string(),
  text: z.string(),
});

const StartOAuthSchema = z.object({
  force: z.boolean().optional().default(false).describe("Force start OAuth even if user token exists"),
});

const ResetUserTokenSchema = z.object({});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_schedule",
        description: "Create a new schedule (event) in Feishu Calendar",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            description: { type: "string" },
            startTime: { type: "string", description: "ISO 8601 format" },
            endTime: { type: "string", description: "ISO 8601 format" },
            calendarId: { type: "string", default: "primary" },
          },
          required: ["summary", "startTime", "endTime"],
        },
      },
      {
        name: "create_document",
        description: "Create a new Feishu document (Docx) with optional content",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
            folderToken: { type: "string" },
          },
          required: ["title"],
        },
      },
      {
        name: "create_wiki",
        description: "Create a new Feishu wiki page",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            spaceId: { type: "string", description: "The ID of the space where the wiki will be created" },
          },
          required: ["title"],
        },
      },
      {
        name: "set_document_permission",
        description: "Set permission for a Feishu document",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The document ID or token" },
            email: { type: "string", description: "Email address of the user" },
            permission: { type: "string", enum: ["edit", "view", "admin"], default: "admin" },
          },
          required: ["documentId", "email"],
        },
      },
      {
        name: "update_document",
        description: "Add content to a Feishu document",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The document ID or token" },
            content: { type: "string", description: "The content to add" },
          },
          required: ["documentId", "content"],
        },
      },
      {
        name: "create_task",
        description: "Create a new Feishu task (Todo)",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            description: { type: "string" },
            dueTime: { type: "string", description: "ISO 8601 or timestamp" },
            assigneeEmail: { type: "string", description: "Assignee email" },
          },
          required: ["summary"],
        },
      },
      {
        name: "send_message",
        description: "Send a text message to a user by email",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", description: "Email address of the user" },
            text: { type: "string", description: "The content of the message" },
          },
          required: ["email", "text"],
        },
      },
      {
        name: "get_user_info",
        description: "Get user information (including phone number) by email",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", description: "Email address of the user" },
          },
          required: ["email"],
        },
      },
      {
        name: "list_department_users",
        description: "List all users in a specific department",
        inputSchema: {
          type: "object",
          properties: {
            departmentId: { type: "string" },
          },
          required: ["departmentId"],
        },
      },
      {
        name: "search_user",
        description: "Search for a user by name or query string",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query (name, email, etc.)" },
          },
          required: ["query"],
        },
      },
      {
        name: "start_oauth",
        description: "Start OAuth callback server and return the authorization URL (for user token)",
        inputSchema: {
          type: "object",
          properties: {
            force: { type: "boolean", default: false, description: "Force start OAuth even if user token exists" },
          },
        },
      },
      {
        name: "reset_user_token",
        description: "Delete local cached user token file (user_token.json) so you can re-authorize",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
});

async function getAccessToken() {
  // Priority: user token > tenant token
  if (userAccessToken) {
    console.error("Using user access token for API calls");
    return userAccessToken;
  } else {
    console.error("Using tenant access token for API calls");
    return await getTenantAccessToken();
  }
}

async function executeTool(name: string, args: any): Promise<string> {
  const token = await getAccessToken();
  if (name === "create_task") {
    const { summary, description, dueTime, assigneeEmail } = CreateTaskSchema.parse(args);
    const authToken = await getTenantAccessToken();

    const taskData: any = {
      summary,
      description,
      origin: {
        platform_i18n_name: "{\"zh_cn\":\"MCP助手\",\"en_us\":\"MCP Assistant\"}",
        href: {
          url: "https://zepp.feishu.cn",
          title: "MCP"
        }
      }
    };

    if (dueTime) {
      const ts = isNaN(Number(dueTime)) ? Math.floor(new Date(dueTime).getTime() / 1000) : Number(dueTime);
      taskData.due = {
        time: ts.toString(),
        timezone: "Asia/Shanghai",
      };
    }

    if (assigneeEmail) {
      taskData.assignee = {
        id: assigneeEmail,
        id_type: "email",
      };
    }

    const response = await axios.post(
      "https://open.feishu.cn/open-apis/task/v1/tasks",
      taskData,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    return JSON.stringify(response.data, null, 2);
  }

  if (name === "send_message") {
    const { email, text } = SendMessageSchema.parse(args);
    const response = await axios.post(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=email",
      {
        receive_id: email,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    return JSON.stringify(response.data, null, 2);
  }

  if (name === "get_user_info") {
    const { email } = z.object({ email: z.string() }).parse(args);
    const authToken = await getTenantAccessToken();
    
    // 1. Get open_id from email
    const idResp = await axios.post(
      "https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id",
      { emails: [email] },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    const openId = idResp.data?.data?.user_list?.[0]?.user_id;
    if (!openId) {
      return JSON.stringify({ error: "User not found by email", details: idResp.data }, null, 2);
    }

    // 2. Get user details using open_id
    const userResp = await axios.get(
      `https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );
    return JSON.stringify(userResp.data, null, 2);
  }

  if (name === "list_department_users") {
    const { departmentId } = z.object({ departmentId: z.string() }).parse(args);
    const authToken = await getTenantAccessToken();
    const response = await axios.get(
      `https://open.feishu.cn/open-apis/contact/v3/users/find_by_department?department_id=${departmentId}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );
    return JSON.stringify(response.data, null, 2);
  }

  if (name === "search_user") {
    const { query } = z.object({ query: z.string() }).parse(args);
    const authToken = await getTenantAccessToken();
    const response = await axios.get(
      "https://open.feishu.cn/open-apis/contact/v3/users/search",
      {
        params: { 
          query: query,
          user_id_type: "open_id" 
        },
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );
    return JSON.stringify(response.data, null, 2);
  }

  if (name === "start_oauth") {
    const { force } = StartOAuthSchema.parse(args);
    if (force) {
      userAccessToken = undefined;
    }
    startOauthServerOnce();
    return JSON.stringify(
      {
        authorization_url: buildAuthUrl(),
        redirect_uri: redirectUri,
        scope: oauthScope,
        oauth_listen: { host: oauthHost, port: oauthPort },
        has_user_token: Boolean(userAccessToken),
        user_token_path: userTokenPath,
      },
      null,
      2
    );
  }

  if (name === "reset_user_token") {
    ResetUserTokenSchema.parse(args);
    try {
      if (fs.existsSync(userTokenPath)) {
        fs.unlinkSync(userTokenPath);
      }
    } catch (e) {
      console.error("Failed to delete user token file:", e);
    }
    userAccessToken = undefined;
    return JSON.stringify(
      {
        ok: true,
        user_token_deleted: true,
        user_token_path: userTokenPath,
      },
      null,
      2
    );
  }

  if (name === "create_schedule") {
    const { summary, description, startTime, endTime, calendarId } = CreateScheduleSchema.parse(args);
    
    // Convert ISO string to Feishu timestamp (seconds)
    const startTimestamp = Math.floor(new Date(startTime).getTime() / 1000).toString();
    const endTimestamp = Math.floor(new Date(endTime).getTime() / 1000).toString();

    const response = await axios.post(
      `https://open.feishu.cn/open-apis/calendar/v4/calendars/${calendarId}/events`,
      {
        summary,
        description,
        start_time: { timestamp: startTimestamp },
        end_time: { timestamp: endTimestamp },
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    return JSON.stringify(response.data, null, 2);
  }

  if (name === "create_document") {
    const { title, content, folderToken, userEmail } = CreateDocumentSchema.parse(args);
    const authToken = await getTenantAccessToken();

    const response = await axios.post(
      "https://open.feishu.cn/open-apis/docx/v1/documents",
      { title, folder_token: folderToken },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );

    const docData = response.data?.data || response.data;
    const documentId = docData?.document_id || docData?.document?.document_id || docData?.document_token || docData?.document?.document_token;

    // Handle initial content if provided
    if (documentId && content) {
      try {
        const headers = { Authorization: `Bearer ${authToken}` };
        const docResponse = await axios.get(
          `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`,
          { headers }
        );
        const rootBlockId = docResponse.data?.data?.document?.document_id || docResponse.data?.data?.document?.block_id;
        if (rootBlockId) {
          await axios.post(
            `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${rootBlockId}/children`,
            {
              children: [{
                block_type: 2,
                text: { elements: [{ text_run: { content } }] }
              }]
            },
            { headers }
          );
        }
      } catch (appendErr: any) {
        console.error("Failed to append initial content:", appendErr.response?.data || appendErr.message);
      }
    }

    const notifyEmail = userEmail || defaultUserEmail;

    // Standard Automation: Always grant Full Access and Notify
    if (documentId && notifyEmail) {
      try {
        // Use 'full_access' for docx permissions
        await axios.post(
          `https://open.feishu.cn/open-apis/drive/v1/permissions/${documentId}/members?type=docx`,
          {
            member_type: "email",
            member_id: notifyEmail,
            perm: "full_access",
          },
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        console.error(`Automated: Granted full_access to ${notifyEmail}`);
      } catch (permErr: any) {
        console.error("Automated Permission Failed:", permErr.response?.data || permErr.message);
      }

      try {
        const docLink = `https://zepp.feishu.cn/docx/${documentId}`;
        await axios.post(
          "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=email",
          {
            receive_id: notifyEmail,
            msg_type: "text",
            content: JSON.stringify({ text: `📝 新文档已创建：${title}\n链接：${docLink}\n权限：已自动授予管理员` }),
          },
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        console.error(`Automated: Sent notification to ${notifyEmail}`);
      } catch (notifyError: any) {
        console.error("Automated Notification Failed:", notifyError.response?.data || notifyError.message);
      }
    }

    return JSON.stringify(response.data, null, 2);
  }

  if (name === "create_wiki") {
    const { title, spaceId, userEmail } = CreateWikiSchema.parse(args);

    // Use tenant token directly for wiki creation
    const authToken = token;

    // Try to get the app's wiki space first
    let appSpace;
    try {
      const spacesResponse = await axios.get(
        "https://open.feishu.cn/open-apis/wiki/v2/spaces",
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );

      const spaces = spacesResponse.data?.data?.spaces || [];
      appSpace = spaces.find((space: any) => space.name === "应用空间") || spaces[0];
    } catch (spaceErr) {
      console.error("Failed to get wiki spaces:", (spaceErr as any)?.response?.data || spaceErr);
    }

    // If no space found, create a new wiki directly (this might work for some apps)
    let response;
    if (appSpace) {
      response = await axios.post(
        `https://open.feishu.cn/open-apis/wiki/v2/spaces/${appSpace.space_id}/nodes`,
        {
          node_type: "origin",
          obj_type: "doc",
          title,
          parent_node_token: "", // root level
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );
    } else {
      // Try creating wiki without specifying space (some APIs allow this)
      response = await axios.post(
        "https://open.feishu.cn/open-apis/wiki/v2/nodes",
        {
          node_type: "origin",
          obj_type: "doc",
          title,
          parent_node_token: "", // root level
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );
    }

    // Response shape may vary; try different paths
    const wikiData = response.data?.data || response.data;
    const nodeToken = wikiData?.node?.node_token || wikiData?.node_token;

    // Grant admin permission to the user by making it public
    const notifyEmail = userEmail || defaultUserEmail;
    if (nodeToken && appSpace) {
      try {
        await axios.patch(
          `https://open.feishu.cn/open-apis/wiki/v2/spaces/${appSpace.space_id}/nodes/${nodeToken}`,
          {
            public_setting: "open", // Make it public so admin can access
            comment_setting: "allow",
          },
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
      } catch (permErr) {
        console.error("Failed to set wiki permissions:", (permErr as any)?.response?.data || permErr);
      }
    }

    // Send notification to user with the wiki link
    try {
      const wikiLink = nodeToken ? `https://zepp.feishu.cn/wiki/${nodeToken}` : `Wiki已创建（无可用链接）`;
      await axios.post(
        "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=email",
        {
          receive_id: notifyEmail,
          msg_type: "text",
          content: JSON.stringify({ text: `已为你创建Wiki：${title}\n链接：${wikiLink}\n权限：管理员` }),
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
    } catch (notifyError) {
      console.error("Failed to send notification:", (notifyError as any)?.response?.data || notifyError);
    }

    return JSON.stringify(response.data, null, 2);
  }

  if (name === "set_document_permission") {
    const { documentId, email, permission } = SetDocumentPermissionSchema.parse(args);
    // Use tenant token by default as requested
    const authToken = await getTenantAccessToken();

    // Map permission to Feishu permission values
    const permMap: Record<string, string> = {
      "view": "read",
      "edit": "write",
      "admin": "full_access"
    };

    const feishuPerm = permMap[permission] || "full_access";

    const response = await axios.post(
      `https://open.feishu.cn/open-apis/drive/v1/permissions/${documentId}/members`,
      {
        member_type: "email",
        member_id: email,
        perm: feishuPerm,
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json"
        },
      }
    );

    return `Successfully set ${permission} permission for ${email} on document ${documentId}`;
  }

  if (name === "update_document") {
    const { documentId, content } = UpdateDocumentSchema.parse(args);
    // Use tenant token by default as requested
    const authToken = await getTenantAccessToken();
    const headers = { Authorization: `Bearer ${authToken}` };

    const formatAxiosError = (e: any) => {
      const status = e?.response?.status;
      const data = e?.response?.data;
      if (status) {
        return `status=${status} data=${JSON.stringify(data)}`;
      }
      return e?.message || String(e);
    };

    // 1) Fetch document to determine root block id
    let rootBlockId: string | undefined;
    try {
      const docResponse = await axios.get(
        `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`,
        { headers }
      );

      rootBlockId =
        docResponse.data?.data?.document?.document_id ||
        docResponse.data?.data?.document?.block_id ||
        docResponse.data?.data?.document?.blocks?.[0]?.block_id;
    } catch (e) {
      throw new Error(`Failed to fetch document ${documentId}: ${formatAxiosError(e)}`);
    }

    if (!rootBlockId) {
      throw new Error(`Failed to determine root block id for document ${documentId}`);
    }

    // 2) Append a new text block under root block
    try {
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
                      content,
                    },
                  },
                ],
              },
            },
          ],
        },
        { headers }
      );

      return `Successfully appended content to document ${documentId}`;
    } catch (e) {
      throw new Error(`Failed to append content to document ${documentId}: ${formatAxiosError(e)}`);
    }
  }

  throw new Error(`Unknown tool: ${name}`);
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await executeTool(name, args);
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message || String(error) }],
    };
  }
});

async function main() {
  // --- Start CLI Support ---
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0) {
    const [toolName, ...toolParams] = cliArgs;
    try {
      let parsedArgs = {};
      if (toolParams[0]) {
        try {
          parsedArgs = JSON.parse(toolParams.join(" "));
        } catch (e) {
          toolParams.forEach(arg => {
            const [k, v] = arg.split("=");
            if (k && v) (parsedArgs as any)[k] = v;
          });
        }
      }
      const result = await executeTool(toolName, parsedArgs);
      console.log(result);
      process.exit(0);
    } catch (error: any) {
      if (error.response?.data) {
        console.error(`CLI Error Details: ${JSON.stringify(error.response.data)}`);
      }
      console.error(`CLI Error: ${error.message}`);
      process.exit(1);
    }
  }
  // --- End CLI Support ---

const transport = new StdioServerTransport();

// Record server start time to ignore history messages
const SERVER_START_TIME = Date.now();

// Dedup map to prevent double processing in current session
const processedMessages = new Set<string>();

// Start Feishu Long Connection (Socket Mode)
if (appId && appSecret) {
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        const { message } = data;
        
        // 1. Ignore old messages (history)
        const msgCreateTime = parseInt(message.create_time);
        if (msgCreateTime < SERVER_START_TIME - 5000) { // 5s buffer
          console.error(`[Event] Ignored old message: ${message.message_id}`);
          return;
        }

        // 2. Dedup by message_id
        if (processedMessages.has(message.message_id)) {
          console.error(`[Event] Duplicate message detected (ID: ${message.message_id}), skipping.`);
          return;
        }
        processedMessages.add(message.message_id);
        
        // Limit Set size to prevent memory growth
        if (processedMessages.size > 1000) {
          const first = processedMessages.values().next().value;
          if (first) processedMessages.delete(first);
        }

        // 3. Scenario filtering
        const isP2P = message.chat_type === 'p2p';
        
        // Check if Bot or Roger is mentioned
        const botMention = message.mentions?.find((m: any) => m.name === 'VSCode 助手');
        const rogerMention = message.mentions?.find((m: any) => m.name.includes('Roger') || m.id === 'ou_376e61b2acf14f6ef1f48095c27139ee');

        if (!isP2P && !botMention && !rogerMention) {
          return;
        }

        // Handle Roger's proxy reply (priority)
        if (rogerMention) {
          console.error(`[Event] Replying on behalf of Roger for message: ${message.message_id}`);
          const botToken = await getTenantAccessToken();
          await axios.post(
            `https://open.feishu.cn/open-apis/im/v1/messages/${message.message_id}/reply`,
            {
              msg_type: "text",
              content: JSON.stringify({ text: "Roger正在Coding...，我是Roger的私人助理，有什么问题可以先和我说。" }),
            },
            { headers: { Authorization: `Bearer ${botToken}` } }
          );
          // If ONLY Roger was mentioned, we stop here. 
          // If BOTH were mentioned, we might want to continue to AI reply, 
          // but sending two replies to one message is usually not ideal. 
          // For now, let's stop if Roger is mentioned.
          return;
        }

        let textContent = "";
        try {
          const parsed = JSON.parse(message.content);
          textContent = parsed.text || "";
        } catch (e) {
          textContent = message.content;
        }

        // Clean @ mentions
        if (botMention) {
          textContent = textContent.replace(/@_user_\w+\s?/g, '').trim();
          textContent = textContent.replace(/@VSCode 助手\s?/g, '').trim();
          textContent = textContent.replace(/@Roger HAN 韩志坚\s?/g, '').trim();
        }

        if (!textContent) return;

        console.error(`[Event] Processing message: ${textContent}`);

        // Use VSCode LLM (MCP Sampling)
        try {
          const botToken = await getTenantAccessToken();
          
          console.error(`[Event] Sending sampling request to VS Code for: ${textContent}`);
          const result = await server.createMessage({
            messages: [
              {
                role: "user",
                content: { type: "text", text: textContent }
              }
            ],
            systemPrompt: "你是一个有用的助手。请简洁地回复用户。",
            maxTokens: 500,
          });

          const aiReply = (result.content as any).text || "抱歉，我现在无法回答。";

          await axios.post(
            `https://open.feishu.cn/open-apis/im/v1/messages/${message.message_id}/reply`,
            {
              msg_type: "text",
              content: JSON.stringify({ text: aiReply }),
            },
            { headers: { Authorization: `Bearer ${botToken}` } }
          );
          console.error(`[Event] VSCode-LLM-replied to ${message.message_id}`);
        } catch (replyErr: any) {
          console.error(`[Event] Error: ${replyErr.message}`);
          if (replyErr.message.includes("timeout")) {
            const botToken = await getTenantAccessToken();
            await axios.post(
              `https://open.feishu.cn/open-apis/im/v1/messages/${message.message_id}/reply`,
              {
                msg_type: "text",
                content: JSON.stringify({ text: "❌ AI 响应超时。请检查 VS Code 底部是否有授权弹窗，或重启 MCP Server。" }),
              },
              { headers: { Authorization: `Bearer ${botToken}` } }
            );
          }
        }
      },
    });

    const wsClient = new Lark.WSClient({
      appId: appId!,
      appSecret: appSecret!,
    });

    wsClient.start({ eventDispatcher })
      .then(() => console.error("Feishu Long Connection client started successfully"))
      .catch((err) => console.error("Failed to start Feishu Long Connection:", err));
  }

  await server.connect(transport);
  console.error("Feishu MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});