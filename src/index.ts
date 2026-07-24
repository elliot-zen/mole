import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { App } from "@octokit/app";
import { createNodeMiddleware } from "@octokit/webhooks";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const appId = requireEnv("GITHUB_APP_ID");
const webhookSecret = requireEnv("GITHUB_WEBHOOK_SECRET");
const privateKeyPath =
  process.env.GITHUB_PRIVATE_KEY_PATH ?? "./github-app.private-key.pem";
const port = Number(process.env.PORT ?? 3000);

const app = new App({
  appId,
  privateKey: readFileSync(privateKeyPath, "utf8"),
  webhooks: { secret: webhookSecret },
});

app.webhooks.on("ping", async ({ payload }) => {
  console.log(`[ping] ${payload.zen ?? ""}`);
});

app.webhooks.on("installation.created", async ({ payload }) => {
  const account = payload.installation.account;
  const login = account && "login" in account ? account.login : account?.name;
  console.log(`[installation.created] id=${payload.installation.id} account=${login}`);
});

app.webhooks.on("issues.opened", async ({ octokit, payload }) => {
  console.log(
    `[issues.opened] ${payload.repository.full_name}#${payload.issue.number} "${payload.issue.title}" by ${payload.issue.user?.login}`
  );
  await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: "Thanks for opening this issue!",
    }
  );
});

app.webhooks.onError((error) => {
  console.error(`[webhook error] ${error.name}: ${error.message}`);
});

const middleware = createNodeMiddleware(app.webhooks, {
  path: "/api/github/webhooks",
});

const server = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  middleware(req, res);
});

server.listen(port, () => {
  console.log(`GitHub App listening on http://localhost:${port}`);
  console.log(`Webhook endpoint: /api/github/webhooks`);
});
