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
  const eventCount = text.match(/BEGIN:VEVENT/g)?.length ?? 0;
  assert.ok(eventCount > 0);
  for (const propertyName of ["UID:", "DTSTAMP:", "DTSTART;VALUE=DATE:", "DTEND;VALUE=DATE:"]) {
    assert.equal(text.split(propertyName).length - 1, eventCount, propertyName);
  }
});

test("仅假期版本不包含调休上班事件", async () => {
  const complete = await readFile(join(PUBLIC_DIR, "china-holidays.ics"), "utf8");
  const holidaysOnly = await readFile(join(PUBLIC_DIR, "china-holidays-only.ics"), "utf8");
  assert.ok(complete.includes("班 ·"));
  assert.equal(holidaysOnly.includes("班 ·"), false);
});

test("2026 年春节日期正确", async () => {
  const text = await readFile(join(PUBLIC_DIR, "china-holidays.ics"), "utf8");
  assert.ok(text.includes("DTSTART;VALUE=DATE:20260215"));
  assert.ok(text.includes("DTEND;VALUE=DATE:20260224"));
  assert.ok(text.includes("DTSTART;VALUE=DATE:20260214"));
});
