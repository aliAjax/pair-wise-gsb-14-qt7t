# 油品价格维护

- 行业：石油
- 技术栈：Vue3、Vite、TypeScript、Pinia、Naive UI
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

这是一个功能最小闭环前端项目，数据默认保存在浏览器localStorage中，方便后续扩展接口、权限、图表或地图能力。

## 批量调价

顶部页签切换到「批量调价」，可将总部调价清单（站点、油品、挂牌价、生效日）一次粘贴导入：

- 格式正确的行进入待审区；重复站点油品、小数位不对（需两位小数）、生效日早于当天的行留在异常区并写明原因
- 异常行改完后点「检查并并入」回到同一批；异常区未清空时不能送审
- 审核通过后整批价格与生效日期冻结；补录会另建带原因的版本并保留旧值

代码按职责拆分在 `src/features/batch/`：`rules.ts`（导入规则）、`store.ts`（批次保存，Pinia + localStorage）、`BatchAdjustPage.vue`（页面）。
