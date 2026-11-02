import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";

import {
  generateCalendars,
  loadData,
  validateData,
} from "../scripts/generate.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = join(ROOT, "public");
let documents;

before(async () => {
  documents = await loadData();
  validateData(documents);
  await generateCalendars();
});

test("年度数据完整", () => {
  assert.deepEqual(documents.map((item) => item.year), [2025, 2026]);
});

test("生成文件使用 CRLF，且物理行不超过 75 字节", async () => {
  for (const filename of ["china-holidays.ics", "china-holidays-only.ics"]) {
    const content = await readFile(join(PUBLIC_DIR, filename));
    const withoutCrlf = Buffer.from(content.toString("utf8").replaceAll("\r\n", ""));
    assert.equal(withoutCrlf.includes(10), false);
    assert.equal(content.subarray(-2).toString(), "\r\n");
    for (const line of content.toString("utf8").split("\r\n")) {
      assert.ok(Buffer.byteLength(line, "utf8") <= 75, line);
    }
  }
});

test("日历和事件包含必需属性", async () => {
  const text = await readFile(join(PUBLIC_DIR, "china-holidays.ics"), "utf8");
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(text.trimEnd().endsWith("END:VCALENDAR"));
  const events = text.split("BEGIN:VEVENT\r\n").slice(1).map((part) => part.split("END:VEVENT")[0]);
  assert.equal(events.length, 72);
  for (const event of events) {
    for (const propertyName of ["UID:", "DTSTAMP:", "DTSTART", "DTEND", "CREATED:", "SUMMARY:"]) {
      assert.ok(event.includes(propertyName), propertyName);
    }
  }
});

test("仅假期版本不包含调休上班事件", async () => {
  const complete = await readFile(join(PUBLIC_DIR, "china-holidays.ics"), "utf8");
  const holidaysOnly = await readFile(join(PUBLIC_DIR, "china-holidays-only.ics"), "utf8");
  assert.ok(complete.includes("补班 第"));
  assert.equal(holidaysOnly.includes("补班 第"), false);
  assert.equal(holidaysOnly.match(/BEGIN:VEVENT/g)?.length, 61);
});

test("2026 年春节日期正确", async () => {
  const text = await readFile(join(PUBLIC_DIR, "china-holidays.ics"), "utf8");
  assert.ok(text.includes("DTSTART;VALUE=DATE:20260215"));
  assert.ok(text.includes("DTEND;VALUE=DATE:20260224"));
  assert.ok(text.includes("DTSTART:20260214T090000"));
  assert.ok(text.includes("SUMMARY:春节 假期 第9天/共9天"));
});

test("包含上海时区和补班提醒", async () => {
  const text = await readFile(join(PUBLIC_DIR, "china-holidays.ics"), "utf8");
  assert.ok(text.includes("X-WR-TIMEZONE:Asia/Shanghai"));
  assert.ok(text.includes("BEGIN:VTIMEZONE"));
  assert.ok(text.includes("TRIGGER:-PT60M"));
  assert.ok(text.includes("STATUS:TENTATIVE"));
  assert.ok(text.includes("TRANSP:OPAQUE"));
  assert.ok(text.includes("放假通知: https://www.gov.cn/"));
});

test("所有生成事件的 UID 唯一", async () => {
  const text = await readFile(join(PUBLIC_DIR, "china-holidays.ics"), "utf8");
  const uids = [...text.matchAll(/^UID:([^\r]+)/gm)].map((match) => match[1]);
  assert.equal(uids.length, 72);
  assert.equal(new Set(uids).size, uids.length);
});
