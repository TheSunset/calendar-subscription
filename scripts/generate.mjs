#!/usr/bin/env node

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, "data");
const OUTPUT_DIR = join(ROOT, "public");
const UID_DOMAIN = "thesunset.github.io";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`日期格式无效：${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    throw new Error(`日期无效：${value}`);
  }
  return result;
}

function yearOf(value) {
  return parseDate(value).getUTCFullYear();
}

function addDays(value, days) {
  return new Date(value.getTime() + days * DAY_IN_MS);
}

function icalDate(value) {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

function icalTimestamp(value) {
  return `${value.replaceAll("-", "")}T000000Z`;
}

export function escapeText(value) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

export function foldLine(line) {
  const result = [];
  let current = "";
  for (const character of line) {
    const candidate = current + character;
    if (Buffer.byteLength(candidate, "utf8") > 75) {
      result.push(current);
      current = ` ${character}`;
    } else {
      current = candidate;
    }
  }
  result.push(current);
  return result;
}

export async function loadData() {
  const filenames = (await readdir(DATA_DIR))
    .filter((filename) => filename.endsWith(".json"))
    .sort();
  return Promise.all(
    filenames.map(async (filename) => {
      const content = await readFile(join(DATA_DIR, filename), "utf8");
      return JSON.parse(content);
    }),
  );
}

export function validateData(documents) {
  if (documents.length === 0) {
    throw new Error("data 目录中没有年度数据");
  }

  const years = new Set();
  const uids = new Set();
  for (const document of documents) {
    const { year } = document;
    if (years.has(year)) throw new Error(`年份重复：${year}`);
    years.add(year);
    parseDate(document.published_at);
    parseDate(document.updated_at);
    if (!Number.isInteger(document.revision) || document.revision < 0) {
      throw new Error(`${year} 年 revision 必须是非负整数`);
    }
    if (!document.source.startsWith("https://")) {
      throw new Error(`${year} 年 source 必须使用 HTTPS`);
    }

    const holidayIds = new Set();
    const offDates = new Set();
    const workdays = new Set();
    for (const holiday of document.holidays) {
      if (typeof holiday.notice !== "string" || holiday.notice.trim() === "") {
        throw new Error(`${year}/${holiday.id} 缺少国务院通知原文`);
      }
      if (holidayIds.has(holiday.id)) {
        throw new Error(`${year} 年节日 ID 重复：${holiday.id}`);
      }
      holidayIds.add(holiday.id);

      holiday.off.forEach((period, index) => {
        if (period.length !== 2) {
          throw new Error(`${year}/${holiday.id} 放假区间必须包含起止日期`);
        }
        const [startText, endText] = period;
        const start = parseDate(startText);
        const end = parseDate(endText);
        if (yearOf(startText) !== year || yearOf(endText) !== year || end < start) {
          throw new Error(`${year}/${holiday.id} 放假区间无效：${period.join(",")}`);
        }
        const uid = `${year}-${holiday.id}-off-${index}@${UID_DOMAIN}`;
        if (uids.has(uid)) throw new Error(`UID 重复：${uid}`);
        uids.add(uid);
        for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
          const dateKey = icalDate(cursor);
          if (offDates.has(dateKey)) throw new Error(`${startText} 被多个假期重复覆盖`);
          offDates.add(dateKey);
        }
      });

      for (const workday of holiday.workdays) {
        parseDate(workday);
        if (yearOf(workday) !== year) {
          throw new Error(`调休上班日不属于 ${year} 年：${workday}`);
        }
        const uid = `${year}-${holiday.id}-work-${workday.replaceAll("-", "")}@${UID_DOMAIN}`;
        if (uids.has(uid)) throw new Error(`UID 重复：${uid}`);
        uids.add(uid);
        workdays.add(workday.replaceAll("-", ""));
      }
    }

    const overlap = [...workdays].filter((day) => offDates.has(day));
    if (overlap.length > 0) {
      throw new Error(`${year} 年日期同时标记为休息和上班：${overlap.join(", ")}`);
    }
  }
}

function dateRange(start, end) {
  const days = [];
  for (let current = start; current <= end; current = addDays(current, 1)) {
    days.push(current);
  }
  return days;
}

function holidayEventLines({ day, index, total, holiday, source, timestamp, sequence }) {
  const summary = `${holiday.name} 假期 第${index}天/共${total}天`;
  return [
    "BEGIN:VEVENT",
    `DTSTART;VALUE=DATE:${icalDate(day)}`,
    `DTEND;VALUE=DATE:${icalDate(addDays(day, 1))}`,
    `DTSTAMP:${icalDate(day)}T000000Z`,
    `UID:${icalDate(day)}T000001_holiday${index}@${UID_DOMAIN}`,
    `CREATED:${timestamp}`,
    `DESCRIPTION:${escapeText(`${holiday.notice}\n\n放假通知: ${source}`)}`,
    `LAST-MODIFIED:${timestamp}`,
    `SEQUENCE:${sequence}`,
    "STATUS:CONFIRMED",
    `SUMMARY:${escapeText(summary)}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}

function workdayEventLines({ day, index, total, holiday, source, timestamp, sequence }) {
  const date = icalDate(day);
  const summary = `${holiday.name} 补班 第${index}天/共${total}天`;
  return [
    "BEGIN:VEVENT",
    `DTSTART:${date}T090000`,
    `DTEND:${date}T180000`,
    `DTSTAMP:${date}T000000Z`,
    `UID:${date}T000001_compensateday${index}@${UID_DOMAIN}`,
    `CREATED:${timestamp}`,
    `DESCRIPTION:${escapeText(`${holiday.notice}\n\n放假通知: ${source}`)}`,
    `LAST-MODIFIED:${timestamp}`,
    `SEQUENCE:${sequence}`,
    "STATUS:TENTATIVE",
    `SUMMARY:${escapeText(summary)}`,
    "TRANSP:OPAQUE",
    "BEGIN:VALARM",
    "TRIGGER:-PT60M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(`补班提醒：${summary}`)}`,
    "END:VALARM",
    "END:VEVENT",
  ];
}

export function calendarLines(documents, includeWorkdays) {
  const title = includeWorkdays ? "中国节假日" : "中国节假日（仅假期）";
  const firstYear = Math.min(...documents.map((document) => document.year));
  const lastYear = Math.max(...documents.map((document) => document.year));
  const updatedAt = documents
    .map((document) => document.updated_at)
    .sort()
    .at(-1);
  const scope = includeWorkdays ? "放假、调休和补班" : "放假";
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//TheSunset//China Public Holidays 1.0//CN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(title)}`,
    "X-WR-TIMEZONE:Asia/Shanghai",
    `X-WR-CALDESC:${firstYear}~${lastYear}年中国${scope}日历 更新时间${updatedAt}`,
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Shanghai",
    "X-LIC-LOCATION:Asia/Shanghai",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:CST",
    "DTSTART:19700101T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const document of documents) {
    const timestamp = icalTimestamp(document.updated_at);
    for (const holiday of document.holidays) {
      const daysOff = holiday.off.flatMap(([start, end]) =>
        dateRange(parseDate(start), parseDate(end)),
      );
      daysOff.forEach((day, index) => {
        lines.push(...holidayEventLines({
          day,
          index: index + 1,
          total: daysOff.length,
          holiday,
          source: document.source,
          timestamp,
          sequence: document.revision,
        }));
      });
      if (includeWorkdays) {
        holiday.workdays.forEach((workday, index) => {
          lines.push(...workdayEventLines({
            day: parseDate(workday),
            index: index + 1,
            total: holiday.workdays.length,
            holiday,
            source: document.source,
            timestamp,
            sequence: document.revision,
          }));
        });
      }
    }
  }
  lines.push("END:VCALENDAR");
  return lines;
}

export async function writeCalendar(path, documents, includeWorkdays) {
  const physicalLines = calendarLines(documents, includeWorkdays).flatMap(foldLine);
  await writeFile(path, `${physicalLines.join("\r\n")}\r\n`, "utf8");
}

export async function generateCalendars() {
  const documents = await loadData();
  validateData(documents);
  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    writeCalendar(join(OUTPUT_DIR, "china-holidays.ics"), documents, true),
    writeCalendar(join(OUTPUT_DIR, "china-holidays-only.ics"), documents, false),
  ]);
  return documents.length;
}

async function main() {
  const documents = await loadData();
  validateData(documents);
  if (process.argv.includes("--check")) {
    console.log(`已校验 ${documents.length} 个年度的数据`);
    return;
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    writeCalendar(join(OUTPUT_DIR, "china-holidays.ics"), documents, true),
    writeCalendar(join(OUTPUT_DIR, "china-holidays-only.ics"), documents, false),
  ]);
  console.log(`已生成 ${documents.length} 个年度的日历订阅文件`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
