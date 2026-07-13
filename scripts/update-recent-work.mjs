import { readFile, writeFile } from "node:fs/promises";

const username = "Mcxiaocaibug";
const profileRepo = `${username}/${username}`.toLowerCase();
const startMarker = "<!-- RECENT_WORK:START -->";
const endMarker = "<!-- RECENT_WORK:END -->";
const readmePath = new URL("../README.md", import.meta.url);

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": `${username}-profile-readme`,
};

if (process.env.GH_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
}

const response = await fetch(
  `https://api.github.com/users/${username}/events/public?per_page=100`,
  { headers },
);

if (!response.ok) {
  throw new Error(`GitHub API returned ${response.status}`);
}

const events = await response.json();
const seen = new Set();
const entries = [];
const pullRequestTimes = events
  .filter((event) => event.type === "PullRequestEvent")
  .map((event) => ({
    repo: event.repo?.name,
    time: new Date(event.created_at).getTime(),
  }));

for (const event of events) {
  const repo = event.repo?.name;

  if (!repo || repo.toLowerCase() === profileRepo) continue;
  if (isPullRequestMergePush(event, repo, pullRequestTimes)) continue;

  const eventKey = getEventKey(event, repo);
  if (!eventKey || seen.has(eventKey)) continue;

  const entry = await formatEvent(event, repo);
  if (!entry) continue;

  seen.add(eventKey);
  entries.push(entry);

  if (entries.length === 5) break;
}

const fallback = "- 最近没有新的公开提交；可能正在安静地构思下一行。";
const block = `${startMarker}\n${entries.length ? entries.join("\n") : fallback}\n${endMarker}`;
const readme = await readFile(readmePath, "utf8");
const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);

if (!pattern.test(readme)) {
  throw new Error("Recent work markers were not found in README.md");
}

await writeFile(readmePath, readme.replace(pattern, block));

async function formatEvent(event, repo) {
  const time = formatTime(event.created_at);
  const repoLink = `[${repo.replace(`${username}/`, "")}](${`https://github.com/${repo}`})`;

  if (event.type === "PushEvent") {
    const commits = event.payload?.commits ?? [];
    const latest = commits.at(-1);
    const sha = latest?.sha ?? event.payload?.head;
    let message = latest?.message?.split("\n")[0];
    let link = sha ? `https://github.com/${repo}/commit/${sha}` : `https://github.com/${repo}`;

    if (!message && sha) {
      const commit = await fetchJson(`https://api.github.com/repos/${repo}/commits/${sha}`);
      message = commit?.commit?.message?.split("\n")[0];
      link = commit?.html_url ?? link;
    }

    return `- \`${time}\` 在 ${repoLink} 提交 [${clean(message ?? "更新代码")}](${link})`;
  }

  if (event.type === "PullRequestEvent") {
    const pull = event.payload?.pull_request;
    if (!pull) return null;

    const detail = await fetchJson(pull.url);
    const number = pull.number ?? event.payload.number;
    const title = clean(detail?.title ?? `Pull Request #${number}`);
    const link = detail?.html_url ?? `https://github.com/${repo}/pull/${number}`;
    const action =
      event.payload.action === "merged"
        ? "合并"
        : event.payload.action === "opened"
          ? "发起"
          : event.payload.action === "closed"
            ? "关闭"
            : "更新";

    return `- \`${time}\` 在 ${repoLink} ${action} [#${number} ${title}](${link})`;
  }

  if (event.type === "ReleaseEvent") {
    const release = event.payload?.release;
    if (!release) return null;

    return `- \`${time}\` 为 ${repoLink} 发布 [${clean(release.tag_name)}](${release.html_url})`;
  }

  if (event.type === "CreateEvent" && event.payload?.ref_type === "repository") {
    return `- \`${time}\` 创建了 ${repoLink}`;
  }

  return null;
}

function getEventKey(event, repo) {
  if (event.type === "PushEvent") {
    return `push:${repo}:${event.payload?.head ?? event.id}`;
  }

  if (event.type === "PullRequestEvent") {
    return `pr:${repo}:${event.payload?.pull_request?.number ?? event.payload?.number}`;
  }

  if (event.type === "ReleaseEvent") {
    return `release:${repo}:${event.payload?.release?.id ?? event.id}`;
  }

  if (event.type === "CreateEvent" && event.payload?.ref_type === "repository") {
    return `create:${repo}`;
  }

  return null;
}

function isPullRequestMergePush(event, repo, pullRequests) {
  if (event.type !== "PushEvent") return false;

  const pushTime = new Date(event.created_at).getTime();
  return pullRequests.some(
    (pull) => pull.repo === repo && Math.abs(pull.time - pushTime) < 10 * 60 * 1000,
  );
}

async function fetchJson(url) {
  if (!url) return null;

  const detailResponse = await fetch(url, { headers });
  if (!detailResponse.ok) return null;
  return detailResponse.json();
}

function formatTime(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));

  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function clean(value) {
  return String(value)
    .replace(/[\\[\\]`*_<>|]/g, "")
    .replace(/\\s+/g, " ")
    .trim()
    .slice(0, 72);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
