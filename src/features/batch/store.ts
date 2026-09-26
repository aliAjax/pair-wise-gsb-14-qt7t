import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { BatchRow, PriceBatch } from "./types";
import {
  exceptionRows,
  parsePasteText,
  pendingRows,
  todayString,
  validateBatchRows,
  validateSupplement
} from "./rules";

const STORAGE_KEY = "dfwlfront-9-price-batches";

export interface ActionResult {
  ok: boolean;
  message: string;
}

function loadBatches(): PriceBatch[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PriceBatch[];
  } catch {
    return [];
  }
}

export const useBatchStore = defineStore("price-batches", () => {
  const batches = ref<PriceBatch[]>(loadBatches());

  const activeBatch = computed(() => batches.value.find((batch) => batch.status !== "frozen") ?? null);
  const frozenBatches = computed(() => batches.value.filter((batch) => batch.status === "frozen"));

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(batches.value));
  }

  function findBatch(batchId: string): PriceBatch | null {
    return batches.value.find((batch) => batch.id === batchId) ?? null;
  }

  function revalidate(batch: PriceBatch) {
    validateBatchRows(batch.rows, todayString());
  }

  function importText(text: string): ActionResult {
    if (!text.trim()) return { ok: false, message: "请先粘贴调价清单" };
    let batch = activeBatch.value;
    if (batch && batch.status === "submitted") {
      return { ok: false, message: "当前批次已送审，需退回修改后才能继续导入" };
    }
    if (!batch) {
      batch = {
        id: crypto.randomUUID(),
        name: `调价批次 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
        status: "draft",
        createdAt: new Date().toISOString(),
        submittedAt: null,
        frozenAt: null,
        rows: []
      };
      batches.value.unshift(batch);
    }
    const startLineNo = batch.rows.reduce((max, row) => Math.max(max, row.lineNo), 0) + 1;
    const parsed = parsePasteText(text, startLineNo);
    const newRows: BatchRow[] = parsed.map((line) => ({
      id: crypto.randomUUID(),
      lineNo: line.lineNo,
      station: line.station,
      fuel: line.fuel,
      priceText: line.priceText,
      price: null,
      effectiveDate: line.dateText,
      formatIssue: line.formatIssue,
      issues: [],
      versions: []
    }));
    batch.rows.push(...newRows);
    revalidate(batch);
    persist();
    const exceptions = newRows.filter((row) => row.issues.length > 0).length;
    return {
      ok: true,
      message: `已导入 ${newRows.length} 行：${newRows.length - exceptions} 行进入待审区，${exceptions} 行进入异常区`
    };
  }

  function updateRow(
    batchId: string,
    rowId: string,
    patch: Partial<Pick<BatchRow, "station" | "fuel" | "priceText" | "effectiveDate">>
  ): void {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "draft") return;
    const row = batch.rows.find((item) => item.id === rowId);
    if (!row) return;
    Object.assign(row, patch);
    row.formatIssue = null;
    persist();
  }

  function mergeRow(batchId: string, rowId: string): ActionResult {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "draft") return { ok: false, message: "批次不存在或不在编辑中" };
    revalidate(batch);
    persist();
    const row = batch.rows.find((item) => item.id === rowId);
    if (!row) return { ok: false, message: "该行不存在" };
    if (row.issues.length === 0) {
      return { ok: true, message: `第 ${row.lineNo} 行检查通过，已并入待审区` };
    }
    return {
      ok: false,
      message: `第 ${row.lineNo} 行仍有 ${row.issues.length} 项异常：${row.issues.map((issue) => issue.message).join("；")}`
    };
  }

  function removeRow(batchId: string, rowId: string): void {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "draft") return;
    batch.rows = batch.rows.filter((row) => row.id !== rowId);
    revalidate(batch);
    persist();
  }

  function discardBatch(batchId: string): void {
    const batch = findBatch(batchId);
    if (!batch || batch.status === "frozen") return;
    batches.value = batches.value.filter((item) => item.id !== batchId);
    persist();
  }

  function submitBatch(batchId: string): ActionResult {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "draft") return { ok: false, message: "批次不存在或已送审" };
    revalidate(batch);
    const exceptions = exceptionRows(batch);
    if (exceptions.length > 0) {
      persist();
      return { ok: false, message: `异常区仍有 ${exceptions.length} 行，不能送审` };
    }
    if (pendingRows(batch).length === 0) {
      persist();
      return { ok: false, message: "待审区为空，不能送审" };
    }
    batch.status = "submitted";
    batch.submittedAt = new Date().toISOString();
    persist();
    return { ok: true, message: `批次已送审，共 ${batch.rows.length} 行，等待审核` };
  }

  function returnBatch(batchId: string): ActionResult {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "submitted") return { ok: false, message: "批次不在待审核状态" };
    batch.status = "draft";
    batch.submittedAt = null;
    persist();
    return { ok: true, message: "批次已退回，可继续修改" };
  }

  function approveBatch(batchId: string): ActionResult {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "submitted") return { ok: false, message: "批次不在待审核状态" };
    batch.status = "frozen";
    batch.frozenAt = new Date().toISOString();
    for (const row of batch.rows) {
      row.versions.push({
        id: crypto.randomUUID(),
        kind: "frozen",
        price: row.price ?? 0,
        effectiveDate: row.effectiveDate,
        reason: "整批审核通过，价格与生效日期冻结",
        createdAt: batch.frozenAt
      });
    }
    persist();
    return { ok: true, message: "批次已通过，整批价格与生效日期已冻结" };
  }

  function addSupplement(
    batchId: string,
    rowId: string,
    input: { priceText: string; dateText: string; reason: string }
  ): ActionResult {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "frozen") return { ok: false, message: "仅已冻结批次支持补录" };
    const row = batch.rows.find((item) => item.id === rowId);
    if (!row) return { ok: false, message: "该行不存在" };
    const result = validateSupplement(input, todayString());
    if (!result.ok || result.price === null || !result.date) {
      return { ok: false, message: result.issues.join("；") || "补录内容不完整" };
    }
    row.versions.push({
      id: crypto.randomUUID(),
      kind: "supplement",
      price: result.price,
      effectiveDate: result.date,
      reason: input.reason.trim(),
      createdAt: new Date().toISOString()
    });
    persist();
    return { ok: true, message: `第 ${row.lineNo} 行补录成功，已生成带原因的新版本并保留旧值` };
  }

  return {
    batches,
    activeBatch,
    frozenBatches,
    importText,
    updateRow,
    mergeRow,
    removeRow,
    discardBatch,
    submitBatch,
    returnBatch,
    approveBatch,
    addSupplement
  };
});
