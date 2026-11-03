import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const outputPath = path.resolve("public/workflow-schedule-test.txt");
const now = new Date();
const beijingTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  dateStyle: "medium",
  timeStyle: "medium",
  hourCycle: "h23",
}).format(now);
const eventName = process.env.GITHUB_EVENT_NAME ?? "local";
const runId = process.env.GITHUB_RUN_ID ?? "local";
const line = `${now.toISOString()} | 北京时间 ${beijingTime} | GitHub Actions 定时测试运行成功（event=${eventName}, run=${runId}）。\n`;

await mkdir(path.dirname(outputPath), { recursive: true });
await appendFile(outputPath, line, "utf8");

process.stdout.write(line);
