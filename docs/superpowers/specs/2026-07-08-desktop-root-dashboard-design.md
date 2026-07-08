# 桌機 `/` 直接呈現後台（dashboard）

日期：2026-07-08 · 狀態：已核准

## 目標

pokkit 是自用工具，桌機空間大、sidebar 一眼全功能。桌機使用者進 `/` 應直接看到後台工作介面；手機維持原本 landing（hero + 上傳 + tab）比較順手。

## 行為

- 進 `/`（或點 logo / Home）時，以 `window.matchMedia('(min-width: 761px)')` 判斷（與現有 sidebar 漢堡斷點 760px 對齊）：
  - **桌機**：URL 停在 `/`，直接套 dashboard 模式（sidebar + 內容），顯示 **Folders 相簿** 分頁，sidebar 高亮 Folders。桌機不再顯示 landing。
  - **手機（≤760px）**：完全維持現狀 landing。
- `/folders`、`/photos` 等既有路由行為不變，兩種裝置照舊。
- 桌機在 `/` 點 sidebar 的 Folders 會 pushState 到 `/folders`，之後行為與現在相同。

## 改動範圍

僅 `public/app.js` 的 `navigate()` home 分支（約 10 行）。CSS、HTML、後端不動。

## 不做的事（YAGNI）

- 不處理視窗即時 resize 切換模式——進站時決定，下次導航才重判。
- 不加 localStorage 記憶分頁（固定 Folders）。

## 驗證

- 桌機開 `/` → sidebar + Folders，URL 仍為 `/`。
- 手機寬度開 `/` → 原本 landing。
- 直接開 `/photos`、`/account` 等 → 兩種寬度都正常。
