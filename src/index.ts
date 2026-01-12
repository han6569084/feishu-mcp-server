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
if (!userAccessToken) {
  const loadedToken = loadUserTokenFromFile();
  const loadedAccessToken = extractAccessToken(loadedToken);
  if (loadedAccessToken) {
    userAccessToken = loadedAccessToken;
  }
}

// If no user token available, provide manual setup option
if (!userAccessToken) {
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
        description: "Create a new Feishu document (Docx)",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const token = await getAccessToken();
  const { name, arguments: args } = request.params;

  try {
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
      return {
        content: [{ type: "text", text: JSON.stringify(response.data) }],
      };
    }

    if (name === "start_oauth") {
      const { force } = StartOAuthSchema.parse(args);
      if (force) {
        userAccessToken = undefined;
      }
      startOauthServerOnce();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
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
            ),
          },
        ],
      };
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                user_token_deleted: true,
                user_token_path: userTokenPath,
              },
              null,
              2
            ),
          },
        ],
      };
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

      return {
        content: [{ type: "text", text: JSON.stringify(response.data) }],
      };
    }

    if (name === "create_document") {
      const { title, folderToken, userEmail } = CreateDocumentSchema.parse(args);
      // Use tenant token by default as requested
      const authToken = await getTenantAccessToken();

      const response = await axios.post(
        "https://open.feishu.cn/open-apis/docx/v1/documents",
        {
          title,
          folder_token: folderToken,
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );

      // Response shape may vary; try different paths
      const docData = response.data?.data || response.data;
      const documentId = docData?.document_id || docData?.document?.document_id || docData?.document_token || docData?.document?.document_token;

      const notifyEmail = userEmail || defaultUserEmail;

      // If using user token, document is created in user's personal space with full access
      // If using tenant token, may need to grant permissions
      if (!userAccessToken && documentId) {
        try {
          await axios.post(
            `https://open.feishu.cn/open-apis/drive/v1/permissions/${documentId}/members?type=docx`,
            {
              member_type: "email",
              member_id: notifyEmail,
              perm: "admin",
            },
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          console.error(`Successfully granted admin permission to ${notifyEmail} for document ${documentId}`);
        } catch (permErr) {
          console.error("Failed to add permission:", (permErr as any)?.response?.data || permErr);
        }
      }

      // Send notification to user with the document link
      try {
        const docLink = documentId ? `https://zepp.feishu.cn/docx/${documentId}` : `文档已创建（无可用链接）`;
        const permissionMsg = userAccessToken ? "（个人空间，全权限访问）" : "权限：管理员";
        await axios.post(
          "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=email",
          {
            receive_id: notifyEmail,
            msg_type: "text",
            content: JSON.stringify({ text: `已为你创建文档：${title}\n链接：${docLink}\n${permissionMsg}` }),
          },
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
      } catch (notifyError) {
        console.error("Failed to send notification:", (notifyError as any)?.response?.data || notifyError);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response.data) }],
      };
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

      return {
        content: [{ type: "text", text: JSON.stringify(response.data) }],
      };
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

      return {
        content: [{ type: "text", text: `Successfully set ${permission} permission for ${email} on document ${documentId}` }],
      };
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

        return {
          content: [{ type: "text", text: `Successfully appended content to document ${documentId}` }],
        };
      } catch (e) {
        throw new Error(`Failed to append content to document ${documentId}: ${formatAxiosError(e)}`);
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message || String(error) }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();

  // Start Feishu Long Connection (Socket Mode)
  if (appId && appSecret) {
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        const { message } = data;
        let textContent = "";
        try {
          const parsed = JSON.parse(message.content);
          textContent = parsed.text || "非文本内容";
        } catch (e) {
          textContent = message.content;
        }

        console.error(`[Event] Received message: ${textContent}`);

        // Auto-reply logic - ALWAYS use tenant token for bot replies
        try {
          const botToken = await getTenantAccessToken();
          await axios.post(
            `https://open.feishu.cn/open-apis/im/v1/messages/${message.message_id}/reply`,
            {
              msg_type: "text",
              content: JSON.stringify({ text: `🤖 机器人已收到您的消息：${textContent}` }),
            },
            {
              headers: { Authorization: `Bearer ${botToken}` },
            }
          );
          console.error(`[Event] Auto-replied to message ${message.message_id}`);
        } catch (replyErr: any) {
          console.error("[Event] Failed to auto-reply:", replyErr.response?.data || replyErr.message);
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