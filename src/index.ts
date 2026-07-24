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

let appSlug: string | undefined;

async function getAppSlug(): Promise<string> {
  if (appSlug) return appSlug;
  const { data } = await app.octokit.request("GET /app");
  if (!data?.slug) {
    throw new Error("Failed to fetch app slug");
  }
  appSlug = data.slug;
  return appSlug;
}

function isMentioned(text: string, slug: string): boolean {
  const mentionPattern = new RegExp(`@${slug}(\\[bot\\])?\\b`, "i");
  return mentionPattern.test(text);
}

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

  const slug = await getAppSlug();
  const body = payload.issue.body ?? "";
  if (isMentioned(body, slug)) {
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.issue.number,
        body: `@${payload.issue.user?.login} 收到你的 @ 了！`,
      }
    );
    return;
  }

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

app.webhooks.on("issue_comment.created", async ({ octokit, payload }) => {
  const slug = await getAppSlug();
  const commentBody = payload.comment.body;
  const commenter = payload.comment.user?.login;

  if (!isMentioned(commentBody, slug)) {
    return;
  }

  console.log(
    `[issue_comment.created] mentioned by ${commenter} in ${payload.repository.full_name}#${payload.issue.number}`
  );

  await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: `@${commenter} 收到你的 @ 了！`,
    }
  );
});

app.webhooks.on("issues.labeled", async ({ octokit, payload }) => {
  const label = payload.label?.name;
  const actor = payload.sender.login;
  console.log(
    `[issues.labeled] ${payload.repository.full_name}#${payload.issue.number} "${label}" by ${actor}`
  );
  await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: `@${actor} 你添加了 \`${label}\``,
    }
  );
});

app.webhooks.on("issues.unlabeled", async ({ octokit, payload }) => {
  const label = payload.label?.name;
  const actor = payload.sender.login;
  console.log(
    `[issues.unlabeled] ${payload.repository.full_name}#${payload.issue.number} "${label}" by ${actor}`
  );
  await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: `@${actor} 你移除了 \`${label}\``,
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
