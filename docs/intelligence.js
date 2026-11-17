'use strict';
let articles = [];
const byId = id => document.getElementById(id);
const textNode = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if(className) el.className=className; return el; };
const localTime = value => value ? new Date(value).toLocaleString('zh-TW', {timeZone:'Asia/Taipei',hour12:false}) : '尚無紀錄';
const labels = {success:'成功',partial_failure:'部分來源失敗',failed:'失敗',success_new:'成功・有新增或變更',success_no_new:'成功・無新資料',skipped:'略過'};
function safeLink(url, label) { try { const u = new URL(url); if(u.protocol!=='https:') return textNode('span',label); const el=textNode('a',label);el.href=u.href;el.target='_blank';el.rel='noopener noreferrer';return el; } catch {return textNode('span',label);} }
function render(){
  const q=byId('search').value.trim().toLowerCase(), s=byId('source').value;
  const rows=articles.filter(a=>(!q||`${a.title} ${a.source}`.toLowerCase().includes(q))&&(!s||a.source_id===s));
  byId('count').textContent=`顯示 ${rows.length} 筆；來源原文可能為英文。`;
  byId('articles').replaceChildren();
  if(!rows.length) byId('articles').append(textNode('p','目前沒有符合條件的情報。'));
  for(const a of rows.slice(0,100)){
    const card=document.createElement('article');
    card.append(textNode('span',a.verification||'待核實','tag'),textNode('h3',a.title),textNode('p',`${a.source} · 發布：${a.published_at?localTime(a.published_at):'來源未提供'} · 蒐集：${localTime(a.collected_at)}`,'muted'),safeLink(a.url,'閱讀原文 ↗'));
    byId('articles').append(card);
  }
}
async function json(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}
async function refresh(){
  byId('refresh').disabled=true;
  try{
    const data=await json('data/intelligence.json'); articles=data.articles||[];
    const r=data.latest_run, health=byId('health');health.replaceChildren();
    const stale = !data.last_success_at || Date.now()-new Date(data.last_success_at)>36*60*60*1000;
    health.append(textNode('p',`最近執行：${localTime(r?.finished_at)} · ${labels[r?.status]||'尚未執行'}`),textNode('p',`最近完整成功：${localTime(data.last_success_at)}`));
    if(stale) health.append(textNode('p','資料可能已過期：超過 36 小時未完整成功，請檢查執行紀錄。','error'));
    health.append(textNode('p',`來源設定：${r?.registry==='google_sheets'?'Google Sheets 雲端同步':r?.registry==='failed'?'來源表讀取失敗，未使用舊設定繼續擷取':'雲端專案設定；Google Sheets 來源同步待接通'}`));
    if(r?.registry_error) health.append(textNode('p',r.registry_error,'error'));
    health.append(textNode('p','每日台灣時間 09:00 排程；雲端排程可能延遲，實際時間以上方紀錄為準。'),textNode('p',r?.facebook||'Facebook 尚未啟用'));
    for(const c of r?.checks||[])health.append(textNode('p',`${c.source}：${labels[c.status]||c.status}（新增 ${c.new}、變更 ${c.changed}）${c.detail?'；'+c.detail:''}`,c.status==='failed'?'error':'muted'));
    health.append(safeLink('https://github.com/chuyihung-web/miles-advisor/actions/workflows/collect-intelligence.yml','查看雲端執行紀錄 ↗'));
    const selected=byId('source').value;byId('source').replaceChildren(new Option('全部來源',''));
    for(const [id,name]of new Map(articles.map(a=>[a.source_id,a.source])))byId('source').add(new Option(name,id));
    byId('source').value=selected; render();
  }catch(e){byId('health').replaceChildren(textNode('p',`讀取失敗：${e.message}。這不代表沒有新情報。`,'error'));}
  try{const w=await json('data/weekly-review.json');byId('weekly').replaceChildren(textNode('p',`整理時間：${localTime(w.generated_at)}`));for(const p of w.proposals){const item=document.createElement('details');item.append(textNode('summary',p.problem),textNode('p',p.proposal),textNode('p','驗收：'+p.acceptance));for(const url of p.evidence_urls||[])item.append(safeLink(url,'查看依據 ↗'),document.createElement('br'));byId('weekly').append(item);}if(!w.proposals.length)byId('weekly').append(textNode('p','本期尚無足夠證據產生提案。'));}catch{byId('weekly').textContent='週檢查尚未產生或讀取失敗；不代表沒有改善項目。';}
  byId('refresh').disabled=false;
}
byId('search').addEventListener('input',render);byId('source').addEventListener('change',render);byId('refresh').addEventListener('click',refresh);refresh();
