#!/usr/bin/env node

import { appendFile, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateData } from "./generate.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, "data");
const SEARCH_ENDPOINT = "https://sousuo.www.gov.cn/search-gov/data";
const REQUIRED_HOLIDAYS = ["元旦", "春节", "清明节", "劳动节", "端午节", "中秋节", "国庆节"];
const HOLIDAY_IDS = new Map([
  ["元旦", "new-year"],
  ["春节", "spring-festival"],
  ["清明节", "qingming"],
  ["劳动节", "labour-day"],
  ["端午节", "dragon-boat"],
  ["中秋节", "mid-autumn"],
  ["国庆节", "national-day"],
  ["国庆节、中秋节", "national-day-mid-autumn"],
  ["中秋节、国庆节", "mid-autumn-national-day"],
]);

function decodeHtmlEntities(value) {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
    ["ensp", " "],
    ["emsp", " "],
  ]);
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named.get(code.toLowerCase()) ?? entity;
  });
}

export function htmlToText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t\f\v\u00a0\u2002-\u200b\u2028\u2029\u3000]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

function extractContentHtml(html) {
  const start = html.search(/<div\b[^>]*id=["']UCAP-CONTENT["'][^>]*>/i);
  if (start < 0) throw new Error("官方页面中缺少 #UCAP-CONTENT 正文容器");
  const contentStart = html.indexOf(">", start) + 1;
  const end = html.indexOf('<div class="pageInfo', contentStart);
  if (end < 0) throw new Error("无法确定官方通知正文的结束位置");
  return html.slice(contentStart, end);
}

function normalizeTitle(value) {
  return htmlToText(value).replace(/\s+/g, "");
}

function isOfficialGovUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "gov.cn" || url.hostname.endsWith(".gov.cn"));
  } catch {
    return false;
  }
}

export function selectOfficialCandidate(payload, year) {
  const expectedTitle = `国务院办公厅关于${year}年部分节假日安排的通知`;
  const candidates = payload?.searchVO?.catMap?.gongwen?.listVO ?? [];
  return (
    candidates.find(
      (candidate) =>
        normalizeTitle(candidate.title) === expectedTitle &&
        candidate.puborg === "国务院办公厅" &&
        /^国办发明电〔\d{4}〕\d+号$/.test(candidate.pcode) &&
        isOfficialGovUrl(candidate.url),
    ) ?? null
  );
}

function formatDate(year, month, day) {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`通知中出现无效日期：${value}`);
  }
  return value;
}

function countInclusiveDays(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

function parseHolidaySection(ordinal, name, content, year) {
  const rangePattern = /(\d{1,2})月(\d{1,2})日(?:（[^）]*）)?(?:至(?:(\d{1,2})月)?(\d{1,2})日(?:（[^）]*）)?)?放假/;
  const range = content.match(rangePattern);
  if (!range) throw new Error(`${name}段落中没有找到放假日期`);
  const startMonth = Number(range[1]);
  const startDay = Number(range[2]);
  const endMonth = range[3] ? Number(range[3]) : startMonth;
  const endDay = range[4] ? Number(range[4]) : startDay;
  const start = formatDate(year, startMonth, startDay);
  const end = formatDate(year, endMonth, endDay);
  const off = [[start, end]];

  const declaredDays = content.match(/(?:共|放假)(\d+)天/)?.[1];
  if (declaredDays && countInclusiveDays(start, end) !== Number(declaredDays)) {
    throw new Error(
      `${name}解析为${countInclusiveDays(start, end)}天，与正文“${declaredDays}天”不一致`,
    );
  }

  const workdays = [];
  const workdayPattern = /([^。；;]*?)上班/g;
  for (const workdaySentence of content.matchAll(workdayPattern)) {
    for (const match of workdaySentence[1].matchAll(/(\d{1,2})月(\d{1,2})日/g)) {
      workdays.push(formatDate(year, Number(match[1]), Number(match[2])));
    }
  }

  const id = HOLIDAY_IDS.get(name);
  if (!id) throw new Error(`无法识别节日名称：${name}`);
  return {
    id,
    name,
    notice: `${ordinal}、${name}：${content.trim()}`,
    off,
    workdays: [...new Set(workdays)],
  };
}

function extractMeta(html, name) {
  const pattern = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`, "i");
  return html.match(pattern)?.[1] ?? null;
}

export function parseOfficialNotice(html, candidate, year) {
  const expectedTitle = `国务院办公厅关于${year}年部分节假日安排的通知`;
  if (normalizeTitle(candidate.title) !== expectedTitle) {
    throw new Error(`标题与目标年份不匹配：${normalizeTitle(candidate.title)}`);
  }
  if (candidate.puborg !== "国务院办公厅") throw new Error("发文机关不是国务院办公厅");
  if (!isOfficialGovUrl(candidate.url)) throw new Error("正文 URL 不是 gov.cn 官方 HTTPS 地址");

  const pageTitle = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  if (!normalizeTitle(pageTitle).startsWith(expectedTitle)) throw new Error("详情页标题与搜索结果不一致");
  const content = htmlToText(extractContentHtml(html));
  if (!content.includes("经国务院批准")) throw new Error("正文缺少“经国务院批准”标识");

  const sections = [];
  const sectionPattern = /(?:^|\n)([一二三四五六七])、([^：:\n]+)[：:]([\s\S]*?)(?=\n[一二三四五六七]、|\n(?:鼓励|节假日期间|国务院办公厅)|$)/g;
  for (const match of content.matchAll(sectionPattern)) {
    sections.push(parseHolidaySection(match[1], match[2].replace(/\s+/g, ""), match[3], year));
  }
  if (sections.length < 6 || sections.length > 7) {
    throw new Error(`应解析出 6 或 7 个节日段落，实际为 ${sections.length}`);
  }

  const covered = new Set(sections.flatMap((section) => section.name.split(/[、，]/)));
  const missing = REQUIRED_HOLIDAYS.filter((name) => !covered.has(name));
  if (missing.length > 0) throw new Error(`通知缺少法定节日：${missing.join("、")}`);

  const firstPublished = extractMeta(html, "firstpublishedtime");
  const publishedAt = (firstPublished?.slice(0, 10) ?? candidate.pubtimeStr.replaceAll(".", "-"));
  const documentNumber = content.match(/国办发明电〔\d{4}〕\d+号/)?.[0] ?? candidate.pcode;
  if (documentNumber !== candidate.pcode) throw new Error("正文文号与搜索结果不一致");

  const document = {
    year,
    document: documentNumber,
    published_at: publishedAt,
    updated_at: publishedAt,
    revision: 0,
    source: candidate.url,
    holidays: sections,
  };
  validateData([document]);
  return document;
}

async function fetchWithTimeout(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      "User-Agent": "china-holidays-calendar/1.0 (+https://github.com/)",
      ...options.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`请求失败 ${response.status}：${url}`);
  return response;
}

export async function discoverNotice(year) {
  const query = new URLSearchParams({
    t: "zhengcelibrary",
    q: `${year}年部分节假日安排`,
    searchfield: "title",
    sort: "pubtime",
    p: "0",
    n: "10",
    type: "gwyzcwjk",
    childtype: "gongwen",
  });
  const response = await fetchWithTimeout(`${SEARCH_ENDPOINT}?${query}`);
  const payload = await response.json();
  return selectOfficialCandidate(payload, year);
}

async function listDataYears() {
  return (await readdir(DATA_DIR))
    .filter((filename) => /^\d{4}\.json$/.test(filename))
    .map((filename) => Number(filename.slice(0, 4)))
    .sort((a, b) => a - b);
}

async function setOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""),
  );
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const years = await listDataYears();
  const requestedYear = argumentValue("--year");
  const year = requestedYear ? Number(requestedYear) : Math.max(...years) + 1;
  if (!Number.isInteger(year)) throw new Error("目标年份无效");

  const outputPath = join(DATA_DIR, `${year}.json`);
  if (years.includes(year) && !process.argv.includes("--force")) {
    console.log(`${year} 年数据已存在，无需更新`);
    await setOutput({ found: false, year, reason: "already-exists" });
    return;
  }

  const sourceUrl = argumentValue("--source-url");
  let candidate;
  if (sourceUrl) {
    if (!isOfficialGovUrl(sourceUrl)) throw new Error("--source-url 必须是 gov.cn HTTPS 地址");
    candidate = {
      title: `国务院办公厅关于${year}年部分节假日安排的通知`,
      puborg: "国务院办公厅",
      pcode: argumentValue("--document-number") ?? "",
      pubtimeStr: argumentValue("--published-at")?.replaceAll("-", ".") ?? "",
      url: sourceUrl,
    };
    if (!candidate.pcode || !candidate.pubtimeStr) {
      throw new Error("使用 --source-url 时还必须提供 --document-number 和 --published-at");
    }
  } else {
    candidate = await discoverNotice(year);
  }

  if (!candidate) {
    console.log(`尚未发现 ${year} 年国务院节假日正式通知`);
    await setOutput({ found: false, year, reason: "not-published" });
    return;
  }

  const html = await (await fetchWithTimeout(candidate.url)).text();
  const document = parseOfficialNotice(html, candidate, year);
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify(document, null, 2));
  } else {
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    console.log(`已从国务院正式通知生成 data/${year}.json`);
  }
  await setOutput({ found: true, year, source: candidate.url });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
