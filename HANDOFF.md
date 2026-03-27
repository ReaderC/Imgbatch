# Imgbatch handoff

## Current goal

当前最优先要修的是：**`预览效果` / `查看结果` 只能预览，不能直接保存；只有点顶部 `开始处理` 后，队列按钮才变成 `保存`，并出现 `全部保存`。**

用户已经多次明确了正确流程：

1. 默认每张图显示 `预览效果`
2. 点击 `预览效果`
   - 只处理当前这一张图
   - 只展示处理结果
   - 不保存到最终目录
3. 用户确认效果后，点击顶部 `开始处理`
   - 按当前配置批量处理整个队列
   - 处理完成后，队列按钮从 `预览效果` 变成 `保存`
   - 顶部出现 `全部保存`
4. 点击 `保存` / `全部保存`
   - 才写入正式输出目录
5. `查看结果` 也应该只是打开预览图，不是保存动作
6. 切到别的工具页时，按钮状态必须按当前工具隔离，不能串页

## User feedback that matters

用户最近几轮最核心的反馈：

- “默认一个预览效果按钮，点击之后直接对这张图进行处理，然后直接把结果展示给用户，不保存”
- “用户觉得效果对了，就可以按照当前的配置来处理，然后点击开始处理按钮，处理完之后预览效果按钮变成保存按钮，同时出现全部保存按钮”
- “现在点击预览效果直接就给我保存了”
- “预览效果和查看结果都会直接保存，而不是把图片给我看”
- “换页倒是会刷新按钮状态了”

结论：**工具间状态串页问题基本已经修过了，但“预览仍像保存”这个问题还要继续盯。**

## What has already been changed

### 1. Frontend preview/save state split

已经把前端交互分成两种模式：

- `preview-only`：单张预览，只给当前图片看效果
- `preview-save`：顶部 `开始处理` 后批量生成可保存结果

关键文件：

- `assets/app/main.js`
- `assets/app/state/store.js`
- `assets/app/components/ImageQueueList.js`
- `assets/app/components/TopBar.js`
- `assets/app/components/AppShell.js`
- `assets/app/services/ztools-bridge.js`

### 2. Queue button logic was corrected

当前队列按钮逻辑已经往用户要求靠拢：

- 默认：`预览效果`
- 当前工具下有 staged 结果：`保存`
- 当前工具下已保存：`查看结果`
- stale：`重新预览`

重点是 **按当前工具隔离**，避免压缩页的状态串到尺寸页。

关键点在：

- `assets/app/components/ImageQueueList.js`
- `assets/app/components/TopBar.js`
- `assets/app/main.js`

### 3. Preview modal was added

已经补了真正的图片预览弹层，而不是只弹通知。

关键文件：

- `assets/app/components/AppShell.js`
- `assets/app/state/store.js`
- `assets/app/main.js`
- `assets/styles/app.css`

相关状态：

- `state.previewModal`
- `setPreviewModal(...)`
- `openPreviewModal(...)`
- `closePreviewModal(...)`

### 4. preload preview path was partially corrected

`preload.js` 里已经加了预览目录概念：

- `PREVIEW_DIR_NAME = 'Imgbatch Preview'`
- `createPreviewDirectory(toolId, createdAt)`

最近又补了一次关键修改：

- `createPreviewPayload(...)` 中，`mode === 'preview-only'` 时改用临时预览目录，而不是正式输出目录
- `executeSingleAssetTool(...)` 中，非 `direct` 模式统一走 `stageResultToProcessed(...)`

也就是：

- `preview-only` 应该返回 `previewUrl`
- 不应该返回“已保存”的 direct 结果状态

## Most important files to inspect next

### `preload.js`

优先看这几个位置：

- `createPreviewPayload(...)`
- `prepareRunPayload(...)`
- `executeSingleAssetTool(...)`
- `stageResultToProcessed(...)`
- `directResultToProcessed(...)`
- `normalizePreviewResult(...)`
- `savePreviewResult(...)`
- `executeSaveFlow(...)`

当前最新改动的重点是：

- `preview-only` 现在应写到临时目录
- `preview-only` 结果应标成 `previewed`，不是 `saved`

### `assets/app/main.js`

优先看：

- `previewAsset(assetId)`
- `processCurrentTool()`
- `saveCurrentAssetResult(...)`
- `saveAllCurrentResults()`
- `openPreviewModal(...)`
- `getPreviewMessage(...)`

要确认：

- 点 `预览效果` 时只传 `[asset]`
- 用的是 `stageToolPreview(..., 'preview-only')`
- 如果已有当前工具的 `previewUrl`，点击 `查看结果` 时只是开 modal

### `assets/app/state/store.js`

优先看：

- `applyRunResult(...)`
- `applyProcessedAsset(...)`
- `markAssetPreviewStale(...)`

要确认：

- `preview-only` -> `previewStatus: 'previewed'`
- `preview-save` -> `previewStatus: 'staged'`
- `save` -> `previewStatus: 'saved'`
- 配置改变后，当前工具旧结果会变 `stale`

### `assets/app/components/ImageQueueList.js`

优先看：

- `renderPrimaryAction(asset, tool)`
- `getToolPreviewStatus(asset, toolId)`
- `renderResultMeta(...)`

要确认：

- 默认仍显示 `预览效果`
- 只有当前工具的 `staged` 结果才显示 `保存`
- `saved` 时显示 `查看结果`

## Current known status

### Already likely fixed

1. 顶部主按钮文案已经改回 `开始处理`
2. 工具切换时按钮状态串页的问题已经基本修好
3. 预览弹层已经存在
4. `preview-only` 与 `preview-save` 的状态模型已经拆开
5. `preload.js` 里 `preview-only` 的输出路径已被改向临时目录

### Still needs real verification

以下问题**不能只看代码，要实际验**：

1. 点 `预览效果` 后，宿主环境里是否还会把文件显示成“已保存”
2. 点 `查看结果` 是否真的只打开弹层
3. 单张预览后，是否只更新当前图片，不影响整列
4. 顶部 `开始处理` 后，是否才生成 `staged` 结果
5. `保存` / `全部保存` 是否只在 batch `preview-save` 后才可用
6. 正式输出目录里，点单张 `预览效果` 后是否完全没有新增文件

## Likely next debugging direction if bug still exists

如果用户继续反馈“还是会保存”，优先沿这个方向查：

1. **先确认真实落盘位置**
   - 预览后到底写到了：
     - 临时目录 `os.tmpdir()/Imgbatch Preview/...`
     - 还是正式输出目录 `Imgbatch Output/...`
2. **看前端是否把 `previewed` 误当成 `saved`**
   - 查 `applyRunResult(...)`
   - 查 `renderPrimaryAction(...)`
   - 查 `getPreviewMessage(...)`
3. **看宿主是否会把 file:// 预览也让用户误以为“保存成功”**
   - 如果是文案误导，就收紧通知和状态展示
4. **看 `savePreviewResult(...)` 是否被误触发**
   - 重点排查 `save-asset-result` / `save-all-results` 的点击路径是否被意外触发
5. **确认 `previewAsset(assetId)` 真的是单张**
   - 用户之前报过“会先把所有图片都进行处理”
   - 必须确认传给 `stageToolPreview(...)` 的确实是 `[asset]`

## Validation checklist for the next thread

新线程里最该直接跑的回归检查：

### A. 单张预览
- 导入多张图
- 不点击 `开始处理`
- 直接点其中一张的 `预览效果`
- 预期：
  - 只处理这一张
  - 打开预览弹层
  - 队列里这张图仍不是 `保存`
  - 顶部不出现 `全部保存`
  - 正式输出目录没有新文件

### B. 批量处理后保存
- 点击顶部 `开始处理`
- 预期：
  - 整个队列批量处理
  - 每张图按钮变 `保存`
  - 顶部出现 `全部保存`
  - 这一步仍只是 staged，不是最终保存

### C. 单张保存
- 点击某张图的 `保存`
- 预期：
  - 只保存这一张到正式输出目录
  - 这张图按钮可变为 `查看结果`

### D. 全部保存
- 点击 `全部保存`
- 预期：
  - staged 项全部保存到正式输出目录

### E. 工具切换
- 在压缩页处理出 staged 结果
- 切到尺寸页
- 预期：
  - 尺寸页默认仍是 `预览效果`
  - 不能直接显示压缩页的 `保存`

## Commands used in this repo

仓库里没有 npm scripts；现在主要靠语法校验：

```bash
npm install
node --check "F:/Imgbatch/preload.js"
node --check "F:/Imgbatch/assets/app/main.js"
node --check "F:/Imgbatch/assets/app/state/store.js"
node --check "F:/Imgbatch/assets/app/components/AppShell.js"
node --check "F:/Imgbatch/assets/app/components/ImageQueueList.js"
node --check "F:/Imgbatch/assets/app/pages/tool-pages.js"
node --check "F:/Imgbatch/assets/app/services/ztools-bridge.js"
```

## Extra note

仓库里已经新建了 `CLAUDE.md`，里面写了当前架构、命令、preview/save 模型等，下一线程可以直接参考。
