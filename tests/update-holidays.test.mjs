import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseOfficialNotice,
  selectOfficialCandidate,
} from "../scripts/update-holidays.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function candidate(year, documentNumber, publishedAt) {
  return {
    title: `国务院办公厅关于<em>${year}</em>年部分节假日安排的通知`,
    puborg: "国务院办公厅",
    pcode: documentNumber,
    pubtimeStr: publishedAt.replaceAll("-", "."),
    url: `https://www.gov.cn/zhengce/zhengceku/${year}/content_test.htm`,
  };
}

test("只选择标题、机关、文号和域名均符合要求的国务院文件", () => {
  const valid = candidate(2027, "国办发明电〔2026〕8号", "2026-11-05");
  const payload = {
    searchVO: {
      catMap: {
        gongwen: {
          listVO: [
            { ...valid, puborg: "某媒体" },
            { ...valid, url: "https://example.com/fake" },
            valid,
          ],
        },
      },
    },
  };
  assert.deepEqual(selectOfficialCandidate(payload, 2027), valid);
  assert.equal(selectOfficialCandidate(payload, 2028), null);
});

test("解析 2025 年国庆中秋合并假期", async () => {
  const html = await readFile(join(ROOT, "tests/fixtures/2025-notice.html"), "utf8");
  const parsed = parseOfficialNotice(
    html,
    candidate(2025, "国办发明电〔2024〕12号", "2024-11-12"),
    2025,
  );
  assert.equal(parsed.holidays.length, 6);
  const combined = parsed.holidays.at(-1);
  assert.equal(combined.name, "国庆节、中秋节");
  assert.deepEqual(combined.off, [["2025-10-01", "2025-10-08"]]);
  assert.deepEqual(combined.workdays, ["2025-09-28", "2025-10-11"]);
});

test("解析 2026 年通知并与已审核数据一致", async () => {
  const [html, expectedText] = await Promise.all([
    readFile(join(ROOT, "tests/fixtures/2026-notice.html"), "utf8"),
    readFile(join(ROOT, "data/2026.json"), "utf8"),
  ]);
  const parsed = parseOfficialNotice(
    html,
    candidate(2026, "国办发明电〔2025〕7号", "2025-11-04"),
    2026,
  );
  const expected = JSON.parse(expectedText);
  assert.deepEqual(parsed.holidays, expected.holidays);
  assert.equal(parsed.document, expected.document);
  assert.equal(parsed.published_at, expected.published_at);
});

test("正文天数和日期范围不一致时拒绝生成", async () => {
  const html = (
    await readFile(join(ROOT, "tests/fixtures/2026-notice.html"), "utf8")
  ).replace("共9天", "共8天");
  assert.throws(
    () =>
      parseOfficialNotice(
        html,
        candidate(2026, "国办发明电〔2025〕7号", "2025-11-04"),
        2026,
      ),
    /与正文“8天”不一致/,
  );
});
