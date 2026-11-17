/** 哩程情報雲端橋接：只公開已驗證來源；不公開備註或私人資料。 */
const BOOK='1_-wgKsKRxgsOIFKe8cqX9My8AnqWN2VOxXDPuOMb-p8';
const RAW='https://raw.githubusercontent.com/chuyihung-web/miles-advisor/main/';
function book_(){return SpreadsheetApp.openById(BOOK);}
function json_(path){const r=UrlFetchApp.fetch(RAW+path,{muteHttpExceptions:true});if(r.getResponseCode()!==200)throw new Error('HTTP '+r.getResponseCode());return JSON.parse(r.getContentText());}
function text_(v){const s=String(v==null?'':v);return /^[=+@-]/.test(s)?"'"+s:s;}
function append_(s,rows){if(!rows.length)return;const start=s.getLastRow()+1;if(start+rows.length-1>s.getMaxRows())s.insertRowsAfter(s.getMaxRows(),start+rows.length-1-s.getMaxRows());s.getRange(start,1,rows.length,rows[0].length).setValues(rows.map(r=>r.map(text_)));}
function sheet_(b,name,headers){let s=b.getSheetByName(name);if(!s){s=b.insertSheet(name);s.getRange(1,1,1,headers.length).setValues([headers]);s.setFrozenRows(1);}return s;}
function doGet(){const config=json_('config/sources.json');const rows=book_().getSheetByName('來源清單').getDataRange().getDisplayValues().slice(1);const sources=config.sources.map(s=>{const r=rows.find(r=>r[2]===s.url);return Object.assign({},s,{enabled:!!r&&s.enabled&&r[7]!=='暫停'&&r[8]==='公開免登入'&&r[9]==='官方 RSS/Atom'&&r[11]==='非官方（已確認）',priority:r?r[7]:'暫停'});});return ContentService.createTextOutput(JSON.stringify({version:1,sources:sources})).setMimeType(ContentService.MimeType.JSON);}
function syncMileageCloud(){const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;try{
const b=book_(),data=json_('docs/data/intelligence.json');if(data.schema_version!==1||!Array.isArray(data.articles))throw new Error('情報格式錯誤');
const s=b.getSheetByName('情報紀錄'),old=s.getDataRange().getDisplayValues(),ids=new Map(old.slice(1).map((r,i)=>[r[0],{row:i+2,values:r}])),add=[];
data.articles.forEach(a=>{const row=[a.id,a.source,a.url,a.title,a.category,a.program||'多計畫',a.published_at||'',a.collected_at,'待核實','','','','','待評估','待處理','RSS標題與連結；未自動核實'];const prev=ids.get(a.id);if(!prev)add.push(row);else if(prev.values[3]!==a.title){row[15]='標題已變更，需重新核實；舊標題：'+prev.values[3];s.getRange(prev.row,1,1,16).setValues([row.map(text_)]);}});append_(s,add);
const logs=sheet_(b,'執行紀錄',['執行ID','開始時間','完成時間','結果','來源設定','檢查摘要','同步時間']),seen=new Set(logs.getDataRange().getDisplayValues().slice(1).map(r=>r[0])),history=json_('docs/data/run-history.json');
append_(logs,history.runs.slice().reverse().filter(r=>!seen.has(r.run_id)).map(r=>[r.run_id,r.started_at,r.finished_at,r.status,r.registry,r.checks.map(c=>c.source+': '+c.status+' 新增'+c.new+' 變更'+c.changed+(c.detail?' '+c.detail:'')).join(String.fromCharCode(10)),new Date().toISOString()]));
const sources=b.getSheetByName('來源清單'),rows=sources.getDataRange().getDisplayValues(),config=json_('config/sources.json');(data.latest_run.checks||[]).forEach(c=>{const known=config.sources.find(x=>x.id===c.source_id);if(!known||!c.status.startsWith('success'))return;const idx=rows.findIndex(r=>r[2]===known.url);if(idx>0)sources.getRange(idx+1,11).setValue(new Date(c.checked_at));});
const status=sheet_(b,'同步狀態',['項目','狀態/時間']);status.getRange(2,1,4,2).setValues([['最近同步成功',new Date().toISOString()],['雲端執行ID',String(data.latest_run.run_id)],['新增情報',String(add.length)],['來源設定',String(data.latest_run.registry)]]);console.log(JSON.stringify({status:'success',added:add.length,run_id:data.latest_run.run_id}));
}finally{lock.releaseLock();}}
function syncWeeklyUXReview(){const b=book_(),w=json_('docs/data/weekly-review.json'),s=b.getSheetByName('UIUX 改善清單'),ids=new Set(s.getDataRange().getDisplayValues().slice(1).map(r=>r[0]));append_(s,w.proposals.filter(p=>!ids.has(p.id)).map(p=>[p.id,w.generated_at,p.problem,p.evidence_type,p.evidence_urls.join(String.fromCharCode(10)),'情報預覽與資料品質',p.proposal,'中',p.acceptance,'待評估','','未送審','','',w.method]));console.log('週檢查提案已同步；不自動發布介面。');}
function installMileageSync(){syncMileageCloud();syncWeeklyUXReview();const handlers=new Set(ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction()));if(!handlers.has('syncMileageCloud'))ScriptApp.newTrigger('syncMileageCloud').timeBased().everyHours(1).create();if(!handlers.has('syncWeeklyUXReview'))ScriptApp.newTrigger('syncWeeklyUXReview').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(11).inTimezone('Asia/Taipei').create();console.log('已建立雲端觸發器；09:00蒐集由GitHub雲端執行。');}

// 一次性首次排程驗收：正常只記錄，失敗由 Google 觸發器寄送通知。
function healthRead_(url){const r=UrlFetchApp.fetch(url,{muteHttpExceptions:true,headers:{Accept:'application/json'}});if(r.getResponseCode()!==200)throw new Error('讀取失敗 HTTP '+r.getResponseCode()+'：'+url);return JSON.parse(r.getContentText());}
function assessMileage_(data,state,ids,targetDate){const errors=[];const run=data.latest_run||{};if(run.status!=='success')errors.push('蒐集結果不是成功：'+run.status);if(run.registry!=='google_sheets')errors.push('來源表沒有接通');if(!run.started_at||Utilities.formatDate(new Date(run.started_at),'Asia/Taipei','yyyy-MM-dd')!==targetDate)errors.push('未取得當日蒐集紀錄');if((run.checks||[]).some(c=>c.status==='failed'))errors.push('有來源擷取失敗');if(!(run.checks||[]).some(c=>c.status==='success_new'||c.status==='success_no_new'))errors.push('沒有任何來源完成檢查');if(state['雲端執行ID']!==String(run.run_id))errors.push('Google Sheets 尚未同步最新執行ID');if(state['來源設定']!=='google_sheets')errors.push('表格來源設定狀態不符');const syncTime=Date.parse(state['最近同步成功']);if(!Number.isFinite(syncTime)||Date.now()-syncTime>2*3600000)errors.push('表格超過兩小時未成功同步');if(new Set(ids).size!==ids.length)errors.push('情報表有重複ID');const present=new Set(ids);if((data.articles||[]).some(a=>!present.has(a.id)))errors.push('網站情報尚未完整同步到表格');return errors;}
function mileageHealth_(targetDate,requireScheduled){
 const errors=[];let runId='';
 try{
  const site=UrlFetchApp.fetch('https://chuyihung-web.github.io/miles-advisor/intelligence.html',{muteHttpExceptions:true});if(site.getResponseCode()!==200)errors.push('網站情報頁無法開啟');
  const data=healthRead_('https://chuyihung-web.github.io/miles-advisor/data/intelligence.json?check='+Date.now());runId=String(data.latest_run.run_id);
  const b=book_(),state=Object.fromEntries(b.getSheetByName('同步狀態').getDataRange().getDisplayValues().slice(1)),ids=b.getSheetByName('情報紀錄').getDataRange().getDisplayValues().slice(1).map(r=>r[0]).filter(Boolean);
  errors.push(...assessMileage_(data,state,ids,targetDate));
  if(requireScheduled){const api=healthRead_('https://api.github.com/repos/chuyihung-web/miles-advisor/actions/workflows/collect-intelligence.yml/runs?event=schedule&per_page=20');const today=api.workflow_runs.filter(r=>Utilities.formatDate(new Date(r.created_at),'Asia/Taipei','yyyy-MM-dd')===targetDate);if(!today.some(r=>r.status==='completed'&&r.conclusion==='success'))errors.push('當日09:00自然排程未成功完成');if(!today.some(r=>String(r.id)===runId&&r.conclusion==='success'))errors.push('網站最新資料不是當日成功的自然排程結果');}
 }catch(e){errors.push('無法完成檢查：'+e.message);}
 const log=sheet_(book_(),'自動驗收紀錄',['檢查日期','執行時間','檢查類型','結果','執行ID','問題/說明']);append_(log,[[targetDate,new Date().toISOString(),requireScheduled?'首次自然排程驗收':'安裝時自測',errors.length?'失敗':'通過',runId,errors.length?errors.join('；'):'來源、網站、表格同步與ID去重皆正常']]);
 if(errors.length)throw new Error('哩程網站自動檢查發現問題：'+errors.join('；')+'。請查看哩程情報來源管理表「自動驗收紀錄」及 https://github.com/chuyihung-web/miles-advisor/actions/workflows/collect-intelligence.yml');
 console.log('哩程雲端檢查通過；正常不通知。');
}
function checkTomorrowMileage(){mileageHealth_('2026-11-18',true);}
function installTomorrowMileageCheck(){
 const today=Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd');mileageHealth_(today,false);
 const sample={latest_run:{status:'success',registry:'google_sheets',started_at:new Date().toISOString(),run_id:'test',checks:[{status:'success_no_new'}]},articles:[{id:'a'}]},state={'雲端執行ID':'test','來源設定':'google_sheets','最近同步成功':new Date().toISOString()};if(assessMileage_(sample,state,['a','a'],today).length===0)throw new Error('重複ID偵測自測未通過');
 if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='checkTomorrowMileage'))ScriptApp.newTrigger('checkTomorrowMileage').timeBased().at(new Date('2026-11-18T03:00:00Z')).create();
 console.log('已建立2026-11-18台灣11:00一次性雲端檢查；正常不發信，失敗由Google觸發器通知。');
}
