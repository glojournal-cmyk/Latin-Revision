# Latin Revision V7 Soft Scholar — 更新及使用指南

## 新版內容

- 固定白底的 **Soft Scholar** 設計：柔和 sage green + lavender、較易閱讀的標題與內文字體。
- 題庫由 847 題擴充至 **1,056 題**，仍然只限 18 July–3 September 2026 Summer Revision。
- 18、19、22、23、24、25 August 每日最少 **50 條獨立題目**。
- 普通 Practice 會優先抽該日未見過的題目；完成整個 cycle 前不會即時重覆。
- 答錯題目會離開普通 Practice，2 日後進入 Due Review；答對後 7 日再檢查一次。
- 每題答案頁新增：學生答案、accepted answer、逐步解釋、常見判斷方法、Must remember。
- 每日筆記新增：Must memorise、核心規則、source例子、常見陷阱及做題檢查清單。
- 柔和答對、答錯及完成聲效；可在右上角 Sound on/off。
- 每題答完自動保存；首頁顯示 Last saved / Last backup。

## 更新前先備份

在目前app最下方 Parent controls 按 **Export progress / Backup progress**，把JSON檔案保存在iPad Files。

正常更新同一個GitHub repository不會清除舊分數。V7會自動帶入V6的分數、錯題及review日期；新的no-repeat cycle會由零開始。

## 在Windows更新原本GitHub Pages

1. 下載新版ZIP，右鍵按 **Extract All / 解壓縮**。
2. 打開解壓後的 `Latin_Revision_PWA_V7_SoftScholar` folder。
3. 在瀏覽器登入GitHub，進入原本的 `latin-revision` repository。
4. 按 **Add file → Upload files**。
5. 將新版folder「裡面」的所有檔案拖入GitHub，包括：
   - `index.html`
   - `question-bank.js`
   - `manifest.webmanifest`
   - `sw.js`
   - `icons` folder
6. 拉到頁面底部按 **Commit changes**。
7. 不用再設定Settings → Pages，也不用刪除iPad的Home Screen icon。

## 令iPad收到新版

1. 等GitHub約1–3分鐘完成發佈。
2. iPad保持連接Wi-Fi。
3. 完全關閉Latin Revision：由畫面底部向上掃並停頓，再把app預覽向上推走。
4. 用Safari打開原本GitHub Pages網址並refresh一次。
5. 關閉Safari，再由Home Screen打開Latin Revision。
6. 首頁應顯示Soft Scholar設計及 **1,056 questions**。

如果仍見到舊版，再完全關閉app並重開一次。新的service worker會刪除V6 cache。

## 女兒每天使用方法

1. 如首頁 **Due today** 大過0，先完成到期的2-day / 7-day review。
2. 選擇目前正在溫習的日期。
3. 先看Must memorise及詳細notes；已熟內容可以只看必背框。
4. 按Start practice，每次做15條未見過題目。
5. 每題答完必須閱讀How to work it out及Must remember。
6. 同一日期未達85%，可以再做，但app會優先抽同日其他未見過的題。
7. 達85%後可轉下一個block，但仍須完成之後到期的review。
8. 完成數個dated blocks後才做Mixed test；全部內容完成後才做30 Aug assessment。

建議每次約15–25分鐘。長卷保留作每1–2星期驗收；日常以app作針對性學習及記憶鞏固。

## 記錄會否消失

正常關閉app、關閉Safari、關機或隔日再開，不會清除記錄。以下情況可能令本機記錄消失：

- 清除Safari Website Data；
- 使用Private Browsing；
- 在app按Reset progress；
- 改用另一條網址或另一個repository；
- iPad系統在極端儲存壓力下清理網站資料。

大更新前按 **Backup progress**。如有需要可用 **Restore backup** 匯入JSON。
