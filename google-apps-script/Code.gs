/**
 * 哩程情報來源管理表專用橋接。
 * 公開介面只輸出白名單公開來源，不輸出備註、私人資料或其他分頁。
 * 目前不自動判斷文章內容真偽，也不修改網站介面或兌換表。
 */
const MILES_SHEET_ID = '1_-wgKsKRxgsOIFKe8cqX9My8AnqWN2VOxXDPuOMb-p8';
const MILES_RAW = 'https://raw.githubusercontent.com/chuyihung-web/miles-advisor/main/';
function milesBook_() { return SpreadsheetApp.openById(MILES_SHEET_ID); }
function milesJson_(path) {
  const response = UrlFetchApp.fetch(MILES_RAW + path, {muteHttpExceptions:true});
  if(response.getResponseCode() !== 200) throw new Error('雲端資料讀取失敗：'+response.getResponseCode());
  return JSON.parse(response.getContentText());
}
function milesText_(v) { const s = String(v == null ? '' : v); return /^[=+@-]/.test(s) ? "'" + s : s; }
function milesAppend_(sheet, rows) {
  if(!rows.length) return;
  const start=sheet.getLastRow()+1;
  if(start+rows.length-1>sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),start+rows.length-1-sheet.getMaxRows());
  sheet.getRange(start,1,rows.length,rows[0].length).setValues(rows.map(r=>r.map(milesText_)));
}
function milesSheet_(book,name,headers) {
  let sheet=book.getSheetByName(name);
  if(!sheet){sheet=book.insertSheet(name);sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);}
  return sheet;
}
function doGet() {
  const config = milesJson_('config/sources.json');
  const rows = milesBook_().getSheetByName('來源清單').getDataRange().getDisplayValues().slice(1);
  // Only publisher URLs already independently checked in the cloud project can be enabled.
  const sources = config.sources.map(source => {
    const row=rows.find(r=>r[2].replace(/\/$/,'')===source.url.replace(/\/$/,''));
    const enabled=!!row && source.enabled && row[7]!=='暫停' && row[8]==='公開免登入' && row[9]==='官方 RSS/Atom' && row[11]==='非官方（已確認）';
    return Object.assign({},source,{enabled:enabled,priority:row?row[7]:'暫停'});
  });
  return ContentService.createTextOutput(JSON.stringify({version:1,sources:sources})).setMimeType(ContentService.MimeType.JSON);
}
function syncMileageCloud() {
  const lock=LockService.getScriptLock(); if(!lock.tryLock(1000)) return;
  try{
    const book=milesBook_(), data=milesJson_('docs/data/intelligence.json');
    if(data.schema_version!==1 || !Array.isArray(data.articles)) throw new Error('情報格式錯誤');
    const sheet=book.getSheetByName('情報紀錄');
    const current=sheet.getDataRange().getDisplayValues();
    const ids=new Map(current.slice(1).map((r,i)=>[r[0],{row:i+2,values:r}]));
    const add=[];
    data.articles.forEach(a=>{
      const row=[a.id,a.source,a.url,a.title,a.category,a.program||'多計畫',a.published_at||'',a.collected_at,'待核實','','','','','待評估','待處理','RSS 標題與連結；未自動核實'];
      const prev=ids.get(a.id);
      if(!prev) add.push(row);
      else if(prev.values[3]!==a.title){
        // Reopen reviewed claims if upstream titles changed; preserve the old title in the audit note.
        row[15]='來源標題已變更，需重新核實；舊標題：'+prev.values[3];
        sheet.getRange(prev.row,1,1,16).setValues([row.map(milesText_)]);
      }
    });
    milesAppend_(sheet,add);
    const logs=milesSheet_(book,'執行紀錄',['執行ID','開始時間','完成時間','結果','來源設定','檢查摘要','同步時間']);
    const existingRuns=new Set(logs.getDataRange().getDisplayValues().slice(1).map(r=>r[0]));
    const history=milesJson_('docs/data/run-history.json');
    milesAppend_(logs,history.runs.slice().reverse().filter(r=>!existingRuns.has(r.run_id)).map(r=>[r.run_id,r.started_at,r.finished_at,r.status,r.registry,r.checks.map(c=>c.source+': '+c.status+' 新增'+c.new+' 變更'+c.changed+(c.detail?' '+c.detail:'')).join('\n'),new Date().toISOString()]));
    const sourceSheet=book.getSheetByName('來源清單'), sourceRows=sourceSheet.getDataRange().getDisplayValues();
    const config=milesJson_('config/sources.json');
    (data.latest_run.checks||[]).forEach(c=>{
      const known=config.sources.find(s=>s.id===c.source_id);if(!known || !c.status.startsWith('success'))return;
      const idx=sourceRows.findIndex(r=>r[2]===known.url);if(idx>0)sourceSheet.getRange(idx+1,11).setValue(new Date(c.checked_at)).setNumberFormat('yyyy-mm-dd');
    });
    const status=milesSheet_(book,'同步狀態',['項目','狀態/時間']);
    status.getRange(2,1,4,2).setValues([['最近同步成功',new Date().toISOString()],['雲端執行ID',String(data.latest_run.run_id)],['新增情報',String(add.length)],['來源設定',String(data.latest_run.registry)]]);
    console.log(JSON.stringify({status:'success',added:add.length,run_id:data.latest_run.run_id}));
  }finally{lock.releaseLock();}
}
function syncWeeklyUXReview() {
  const book=milesBook_(), weekly=milesJson_('docs/data/weekly-review.json');
  const sheet=book.getSheetByName('UIUX 改善清單');
  const ids=new Set(sheet.getDataRange().getDisplayValues().slice(1).map(r=>r[0]));
  milesAppend_(sheet,weekly.proposals.filter(p=>!ids.has(p.id)).map(p=>[p.id,weekly.generated_at,p.problem,p.evidence_type,p.evidence_urls.join('\n'),'情報預覽與資料品質',p.proposal,'中',p.acceptance,'待評估','','未送審','','',weekly.method]));
  console.log('週檢查提案已同步；不自動發布介面。');
}
function installMileageSync() {
  syncMileageCloud();
  syncWeeklyUXReview();
  const handlers=new Set(ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction()));
  if(!handlers.has('syncMileageCloud'))ScriptApp.newTrigger('syncMileageCloud').timeBased().everyHours(1).create();
  if(!handlers.has('syncWeeklyUXReview'))ScriptApp.newTrigger('syncWeeklyUXReview').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(11).inTimezone('Asia/Taipei').create();
  console.log('已建立每小時同步與週一 11:00 左右週檢查同步；09:00 蒐集由 GitHub 雲端排程執行。');
}
