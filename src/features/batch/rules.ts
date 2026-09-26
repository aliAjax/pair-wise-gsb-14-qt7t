import { FUEL_OPTIONS } from "./types";
import type { BatchRow, PriceBatch, PriceVersion, RowIssue } from "./types";

export interface ParsedLine {
  lineNo: number;
  station: string;
  fuel: string;
  priceText: string;
  dateText: string;
  formatIssue: RowIssue | null;
}

export function todayString(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function splitCells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
  if (/[,，、]/.test(line)) return line.split(/[,，、]/).map((cell) => cell.trim());
  return line.split(/\s+/).map((cell) => cell.trim());
}

export function parsePasteText(text: string, startLineNo = 1): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cells = splitCells(line);
      return {
        lineNo: startLineNo + index,
        station: cells[0] ?? "",
        fuel: cells[1] ?? "",
        priceText: cells[2] ?? "",
        dateText: cells[3] ?? "",
        formatIssue:
          cells.length === 4
            ? null
            : {
                code: "FORMAT",
                message: `应为 4 列（站点、油品、挂牌价、生效日），实际 ${cells.length} 列`
              }
      };
    });
}

export function validatePriceText(text: string): { price: number | null; issues: RowIssue[] } {
  const value = text.trim();
  if (!value) {
    return { price: null, issues: [{ code: "PRICE_NUMBER", message: "挂牌价不能为空" }] };
  }
  if (!/^\d+(\.\d+)?$/.test(value)) {
    return { price: null, issues: [{ code: "PRICE_NUMBER", message: "挂牌价不是有效数字" }] };
  }
  const decimals = value.includes(".") ? value.split(".")[1].length : 0;
  if (decimals !== 2) {
    return { price: Number(value), issues: [{ code: "PRICE_DECIMAL", message: "小数位不对，挂牌价需保留两位小数" }] };
  }
  const price = Number(value);
  if (price <= 0) {
    return { price, issues: [{ code: "PRICE_RANGE", message: "挂牌价必须大于 0" }] };
  }
  return { price, issues: [] };
}

export function normalizeDate(text: string): string | null {
  const match = text.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function validateEffectiveDate(text: string, today: string): { date: string | null; issues: RowIssue[] } {
  const value = text.trim();
  if (!value) {
    return { date: null, issues: [{ code: "DATE_FORMAT", message: "生效日不能为空" }] };
  }
  const normalized = normalizeDate(value);
  if (!normalized) {
    return { date: null, issues: [{ code: "DATE_FORMAT", message: "生效日格式应为 YYYY-MM-DD" }] };
  }
  if (normalized < today) {
    return { date: normalized, issues: [{ code: "DATE_PAST", message: "生效日早于当天" }] };
  }
  return { date: normalized, issues: [] };
}

export function validateBatchRows(rows: BatchRow[], today: string): void {
  for (const row of rows) {
    const issues: RowIssue[] = [];
    if (row.formatIssue) issues.push(row.formatIssue);
    if (!row.station.trim()) issues.push({ code: "STATION_EMPTY", message: "站点不能为空" });
    if (!FUEL_OPTIONS.includes(row.fuel.trim() as (typeof FUEL_OPTIONS)[number])) {
      issues.push({ code: "FUEL_UNKNOWN", message: `未知油品，可选：${FUEL_OPTIONS.join("、")}` });
    }
    const priceResult = validatePriceText(row.priceText);
    issues.push(...priceResult.issues);
    row.price = priceResult.price;
    const dateResult = validateEffectiveDate(row.effectiveDate, today);
    issues.push(...dateResult.issues);
    if (dateResult.date) row.effectiveDate = dateResult.date;
    row.issues = issues;
  }
  markDuplicates(rows);
}

function markDuplicates(rows: BatchRow[]): void {
  const firstByKey = new Map<string, BatchRow>();
  for (const row of rows) {
    const station = row.station.trim();
    const fuel = row.fuel.trim();
    if (!station || !fuel) continue;
    const key = `${station}｜${fuel}`;
    const first = firstByKey.get(key);
    if (first) {
      row.issues.push({
        code: "DUPLICATE",
        message: `重复站点油品：与第 ${first.lineNo} 行（${station} ${fuel}）相同`
      });
    } else {
      firstByKey.set(key, row);
    }
  }
}

export function isExceptionRow(row: BatchRow): boolean {
  return row.issues.length > 0;
}

export function pendingRows(batch: PriceBatch): BatchRow[] {
  return batch.rows.filter((row) => !isExceptionRow(row));
}

export function exceptionRows(batch: PriceBatch): BatchRow[] {
  return batch.rows.filter(isExceptionRow);
}

export function currentVersion(row: BatchRow): PriceVersion | null {
  return row.versions.length > 0 ? row.versions[row.versions.length - 1] : null;
}

export function currentPrice(row: BatchRow): number | null {
  return currentVersion(row)?.price ?? row.price;
}

export function currentEffectiveDate(row: BatchRow): string {
  return currentVersion(row)?.effectiveDate ?? row.effectiveDate;
}

export function validateSupplement(
  input: { priceText: string; dateText: string; reason: string },
  today: string
): { ok: boolean; issues: string[]; price: number | null; date: string | null } {
  const issues: string[] = [];
  if (!input.reason.trim()) issues.push("补录原因不能为空");
  const priceResult = validatePriceText(input.priceText);
  const dateResult = validateEffectiveDate(input.dateText, today);
  issues.push(...priceResult.issues.map((issue) => issue.message));
  issues.push(...dateResult.issues.map((issue) => issue.message));
  return { ok: issues.length === 0, issues, price: priceResult.price, date: dateResult.date };
}
