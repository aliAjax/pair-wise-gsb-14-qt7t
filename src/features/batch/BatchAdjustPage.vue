<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { BATCH_STATUS_LABELS, FUEL_OPTIONS } from "./types";
import type { BatchRow } from "./types";
import { currentEffectiveDate, currentPrice, exceptionRows, pendingRows, todayString } from "./rules";
import { useBatchStore } from "./store";

const store = useBatchStore();

const fuelOptions: readonly string[] = FUEL_OPTIONS;

const pasteText = ref("");
const feedback = ref<{ ok: boolean; message: string } | null>(null);

const activeBatch = computed(() => store.activeBatch);
const frozenBatches = computed(() => store.frozenBatches);
const activePending = computed(() => (activeBatch.value ? pendingRows(activeBatch.value) : []));
const activeExceptions = computed(() => (activeBatch.value ? exceptionRows(activeBatch.value) : []));

function offsetDate(days: number): string {
  return todayString(new Date(Date.now() + days * 86400000));
}

function fillSample() {
  pasteText.value = [
    `城东加油站	92号汽油	7.62	${offsetDate(2)}`,
    `城东加油站	95号汽油	8.15	${offsetDate(2)}`,
    `城西加油站	92号汽油	7.6	${offsetDate(2)}`,
    `城东加油站	92号汽油	7.65	${offsetDate(2)}`,
    `港区加油站	柴油	7.18	${offsetDate(-3)}`
  ].join("\n");
}

function doImport() {
  feedback.value = store.importText(pasteText.value);
  if (feedback.value.ok) pasteText.value = "";
}

type EditableField = "station" | "fuel" | "priceText" | "effectiveDate";

function onRowEdit(batchId: string, rowId: string, field: EditableField, event: Event) {
  const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
  store.updateRow(batchId, rowId, { [field]: value });
}

function onMerge(batchId: string, rowId: string) {
  feedback.value = store.mergeRow(batchId, rowId);
}

function onSubmit(batchId: string) {
  feedback.value = store.submitBatch(batchId);
}

function onApprove(batchId: string) {
  feedback.value = store.approveBatch(batchId);
}

function onReturn(batchId: string) {
  feedback.value = store.returnBatch(batchId);
}

function onDiscard(batchId: string) {
  if (window.confirm("确定作废当前批次？该批次所有行将被删除。")) {
    store.discardBatch(batchId);
    feedback.value = { ok: true, message: "批次已作废" };
  }
}

const supplementFor = ref<string | null>(null);
const supplementForm = reactive({ priceText: "", dateText: "", reason: "" });
const supplementFeedback = ref<{ ok: boolean; message: string } | null>(null);

function openSupplement(row: BatchRow) {
  supplementFor.value = row.id;
  supplementForm.priceText = currentPrice(row)?.toFixed(2) ?? "";
  supplementForm.dateText = currentEffectiveDate(row);
  supplementForm.reason = "";
  supplementFeedback.value = null;
}

function cancelSupplement() {
  supplementFor.value = null;
  supplementFeedback.value = null;
}

function saveSupplement(batchId: string, rowId: string) {
  const result = store.addSupplement(batchId, rowId, { ...supplementForm });
  if (result.ok) {
    cancelSupplement();
    feedback.value = result;
  } else {
    supplementFeedback.value = result;
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <section class="batch-page">
    <p v-if="feedback" class="feedback" :class="{ error: !feedback.ok }">{{ feedback.message }}</p>

    <div class="panel">
      <h2>批量调价导入</h2>
      <p class="hint">
        每行一条，依次为：站点、油品、挂牌价（两位小数）、生效日（YYYY-MM-DD），支持 Tab、逗号或空格分隔。
        格式正确的行进入待审区；重复站点油品、小数位不对、生效日早于当天的行留在异常区并写明原因，改完可并入同一批。
      </p>
      <textarea v-model="pasteText" rows="6" :placeholder="`城东加油站	92号汽油	7.62	${offsetDate(2)}`" />
      <div class="actions">
        <button type="button" @click="doImport">解析并导入</button>
        <button type="button" class="secondary" @click="fillSample">填入示例</button>
        <button type="button" class="secondary" @click="pasteText = ''">清空</button>
      </div>
    </div>

    <div v-if="activeBatch" class="panel">
      <div class="toolbar">
        <h2>{{ activeBatch.name }}</h2>
        <span class="status">{{ BATCH_STATUS_LABELS[activeBatch.status] }}</span>
      </div>
      <p class="batch-meta">
        创建于 {{ formatTime(activeBatch.createdAt) }}
        <template v-if="activeBatch.submittedAt"> · 送审于 {{ formatTime(activeBatch.submittedAt) }}</template>
      </p>

      <h3 class="section-title">待审区（{{ activePending.length }}）</h3>
      <div v-if="activePending.length" class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>行号</th>
              <th>站点</th>
              <th>油品</th>
              <th>挂牌价</th>
              <th>生效日</th>
              <th v-if="activeBatch.status === 'draft'">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in activePending" :key="row.id">
              <td>{{ row.lineNo }}</td>
              <td>{{ row.station }}</td>
              <td>{{ row.fuel }}</td>
              <td>{{ row.price?.toFixed(2) }}</td>
              <td>{{ row.effectiveDate }}</td>
              <td v-if="activeBatch.status === 'draft'">
                <button type="button" class="danger small" @click="store.removeRow(activeBatch.id, row.id)">移除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">待审区为空</p>

      <template v-if="activeBatch.status === 'draft'">
        <h3 class="section-title">异常区（{{ activeExceptions.length }}）</h3>
        <div v-if="activeExceptions.length" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>行号</th>
                <th>站点</th>
                <th>油品</th>
                <th>挂牌价</th>
                <th>生效日</th>
                <th>异常原因</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in activeExceptions" :key="row.id" class="exception-row">
                <td>{{ row.lineNo }}</td>
                <td>
                  <input class="row-input" :value="row.station" @change="onRowEdit(activeBatch.id, row.id, 'station', $event)" />
                </td>
                <td>
                  <select class="row-input" :value="row.fuel" @change="onRowEdit(activeBatch.id, row.id, 'fuel', $event)">
                    <option v-if="!fuelOptions.includes(row.fuel)" :value="row.fuel">{{ row.fuel || "（空）" }}</option>
                    <option v-for="option in fuelOptions" :key="option" :value="option">{{ option }}</option>
                  </select>
                </td>
                <td>
                  <input
                    class="row-input"
                    :value="row.priceText"
                    placeholder="如 7.62"
                    @change="onRowEdit(activeBatch.id, row.id, 'priceText', $event)"
                  />
                </td>
                <td>
                  <input
                    class="row-input"
                    :value="row.effectiveDate"
                    placeholder="YYYY-MM-DD"
                    @change="onRowEdit(activeBatch.id, row.id, 'effectiveDate', $event)"
                  />
                </td>
                <td>
                  <ul class="issue-list">
                    <li v-for="issue in row.issues" :key="issue.code">{{ issue.message }}</li>
                  </ul>
                </td>
                <td class="row-actions">
                  <button type="button" class="small" @click="onMerge(activeBatch.id, row.id)">检查并并入</button>
                  <button type="button" class="danger small" @click="store.removeRow(activeBatch.id, row.id)">移除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty">异常区为空，可以送审</p>

        <div class="actions">
          <button type="button" :disabled="activeExceptions.length > 0 || activePending.length === 0" @click="onSubmit(activeBatch.id)">
            送审
          </button>
          <span v-if="activeExceptions.length > 0" class="warn-inline">
            异常区仍有 {{ activeExceptions.length }} 行，仍异常时不能送审
          </span>
          <button type="button" class="danger" @click="onDiscard(activeBatch.id)">作废批次</button>
        </div>
      </template>

      <div v-else class="actions">
        <button type="button" @click="onApprove(activeBatch.id)">通过并冻结</button>
        <button type="button" class="secondary" @click="onReturn(activeBatch.id)">退回修改</button>
        <span class="hint-inline">通过后整批价格与生效日期将冻结，后续只能补录</span>
      </div>
    </div>

    <div v-for="batch in frozenBatches" :key="batch.id" class="panel">
      <div class="toolbar">
        <h2>{{ batch.name }}</h2>
        <span class="status frozen">{{ BATCH_STATUS_LABELS[batch.status] }}</span>
      </div>
      <p class="batch-meta">冻结于 {{ formatTime(batch.frozenAt) }} · 价格与生效日期已冻结，补录将另建带原因版本并保留旧值</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>站点</th>
              <th>油品</th>
              <th>当前挂牌价</th>
              <th>当前生效日</th>
              <th>版本</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in batch.rows" :key="row.id">
              <tr>
                <td>{{ row.station }}</td>
                <td>{{ row.fuel }}</td>
                <td>{{ currentPrice(row)?.toFixed(2) }}</td>
                <td>{{ currentEffectiveDate(row) }}</td>
                <td>
                  V{{ row.versions.length }}
                  <span v-if="row.versions.length > 1" class="pill">含补录</span>
                </td>
                <td>
                  <button
                    type="button"
                    class="secondary small"
                    @click="supplementFor === row.id ? cancelSupplement() : openSupplement(row)"
                  >
                    {{ supplementFor === row.id ? "收起" : "补录" }}
                  </button>
                </td>
              </tr>
              <tr v-if="supplementFor === row.id">
                <td colspan="6">
                  <div class="supplement-form">
                    <label>
                      新挂牌价
                      <input v-model="supplementForm.priceText" placeholder="两位小数，如 7.65" />
                    </label>
                    <label>
                      新生效日
                      <input v-model="supplementForm.dateText" placeholder="YYYY-MM-DD" />
                    </label>
                    <label>
                      补录原因
                      <input v-model="supplementForm.reason" placeholder="必填，如：总部补充通知" />
                    </label>
                    <div class="actions">
                      <button type="button" class="small" @click="saveSupplement(batch.id, row.id)">保存补录</button>
                      <button type="button" class="secondary small" @click="cancelSupplement">取消</button>
                    </div>
                    <p v-if="supplementFeedback" class="feedback error">{{ supplementFeedback.message }}</p>
                  </div>
                </td>
              </tr>
              <tr class="version-row">
                <td colspan="6">
                  <ol class="version-list">
                    <li v-for="(version, index) in [...row.versions].reverse()" :key="version.id">
                      V{{ row.versions.length - index }} · {{ version.price.toFixed(2) }} 元 · 生效
                      {{ version.effectiveDate }} · {{ version.kind === "frozen" ? "冻结基线" : "补录" }}：{{ version.reason }}（{{
                        formatTime(version.createdAt)
                      }}）
                    </li>
                  </ol>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="!activeBatch && frozenBatches.length === 0" class="panel empty">暂无批次，请先粘贴调价清单并导入</div>
  </section>
</template>
