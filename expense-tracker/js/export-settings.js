// ── EXPORT ─────────────────────────────────────────────────────────────────
let exportPeriod='month';
let expYear=new Date().getFullYear();

function getTotals(){
  ensureRecurringEntries(yr,mo);
  const entries=DB.get(yr,mo);
  const income=entries.filter(e=>e.isIncome).reduce((s,e)=>addMoney(s,e.amount),0);
  const totals={};
  for(const e of entries.filter(e=>!e.isIncome)) totals[e.category]=addMoney(totals[e.category]||0,e.amount);
  const spent=Object.values(totals).reduce((s,v)=>addMoney(s,v),0);
  return {entries,income,totals,spent};
}
function monthsInRange(fromY,fromM,toY,toM){
  const months=[];
  let y=fromY,m=fromM;
  while(y<toY||(y===toY&&m<=toM)){
    months.push([y,m]);
    m++; if(m>11){m=0;y++;}
  }
  return months;
}
function financeStartMonth(){
  let earliest=null;
  for(const key of Object.keys(localStorage)){
    const match=/^ft_(\d{4})_(0[1-9]|1[0-2])$/.exec(key);
    if(!match)continue;
    let entries;
    try{entries=JSON.parse(localStorage.getItem(key)||'[]');}catch(e){continue;}
    if(!Array.isArray(entries)||!entries.length)continue;
    const y=Number(match[1]),m=Number(match[2])-1;
    if(!earliest||y*12+m<earliest[0]*12+earliest[1])earliest=[y,m];
  }
  for(const rule of getRecurringRules()){
    const start=dateParts(rule.startDate);
    if(!start)continue;
    const y=start.year,m=start.month-1;
    if(!earliest||y*12+m<earliest[0]*12+earliest[1])earliest=[y,m];
  }
  return earliest;
}
function aggregateMonths(months){
  const entries=[];
  let income=0;
  const totals={};
  for(const [y,m] of months){
    ensureRecurringEntries(y,m);
    for(const e of DB.get(y,m)){
      entries.push(e);
      if(e.isIncome)income=addMoney(income,e.amount);
      else totals[e.category]=addMoney(totals[e.category]||0,e.amount);
    }
  }
  const spent=Object.values(totals).reduce((s,v)=>addMoney(s,v),0);
  return {entries,income,totals,spent};
}
function getExportRangeLabel(){
  if(exportPeriod==='month')return `${MONTHS[mo]} ${yr}`;
  if(exportPeriod==='year')return `${expYear}`;
  const start=financeStartMonth();
  const now=new Date();
  if(!start)return 'All-time';
  return `${MONTHS[start[1]]} ${start[0]} – ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}
function getExportTotals(){
  if(exportPeriod==='month')return getTotals();
  const now=new Date();
  if(exportPeriod==='year'){
    if(expYear>now.getFullYear())return {entries:[],income:0,totals:{},spent:0};
    const endMonth=expYear===now.getFullYear()?now.getMonth():11;
    return aggregateMonths(monthsInRange(expYear,0,expYear,endMonth));
  }
  const start=financeStartMonth();
  if(!start)return {entries:[],income:0,totals:{},spent:0};
  return aggregateMonths(monthsInRange(start[0],start[1],now.getFullYear(),now.getMonth()));
}
function setExportPeriod(period){
  exportPeriod=period;
  document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('on'));
  document.getElementById(`periodBtn${period.charAt(0).toUpperCase()}${period.slice(1)}`).classList.add('on');
  document.getElementById('exportYearNav').style.display=period==='year'?'flex':'none';
  renderExport();
}
function changeExportYear(d){
  expYear+=d;
  renderExport();
}
function renderExport(){
  const cats=getCats();
  const {income,totals,spent}=getExportTotals();
  const balance=money(income-spent);
  document.getElementById('exportYearLabel').textContent=expYear;
  document.getElementById('exportSummaryTitle').textContent=exportPeriod==='month'?'Monthly Summary':exportPeriod==='year'?'Yearly Summary':'All-Time Summary';
  const max=Math.max(...Object.values(totals),1);
  const rows=cats.filter(c=>totals[c.id]).sort((a,b)=>totals[b.id]-totals[a.id]).map(c=>{
    const v=totals[c.id],ps=spent>0?Math.round(v/spent*100):0;
    return `<div class="cat-item">
      <div class="cat-ico" style="--cat-color:${c.color}" aria-hidden="true">${escHtml(c.emoji)}</div>
      <div class="cat-col">
        <div class="cat-top"><span class="cat-name">${escHtml(c.label)}</span><span class="cat-amount">${eur(v)}</span></div>
        <div class="cat-bar-bg"><div class="cat-bar" style="width:${Math.round(v/max*100)}%;background:${c.color}"></div></div>
        <div class="cat-pct">${ps}% of spending</div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('exportSummary').innerHTML=`<div class="export-range">${getExportRangeLabel()}</div>
    <div class="balance-row">
      <div class="balance-stat"><div class="balance-ico in" aria-hidden="true">↓</div><div><div class="balance-stat-lbl">Income</div><div class="balance-stat-val">${eur(income)}</div></div></div>
      <div class="balance-stat"><div class="balance-ico out" aria-hidden="true">↑</div><div><div class="balance-stat-lbl">Spent</div><div class="balance-stat-val">${eur(spent)}</div></div></div>
      <div class="balance-stat total"><div><div class="balance-stat-lbl">Balance</div><div class="balance-stat-val ${balance>=0?'grn':'red'}">${balance>=0?'+':'-'}${eur(Math.abs(balance))}</div></div></div>
    </div>
    ${rows||'<div class="empty"><p>No spending in this period.</p></div>'}`;
  renderExportGoals();
}
// Month: same tracker as Home. Year: the year's totals against its targets. All-time: hidden.
function renderExportGoals(){
  const card=document.getElementById('exportGoalCard');
  card.hidden=exportPeriod==='all';
  if(exportPeriod==='month') card.innerHTML=goalTrackerHtml(goalPeriod([[yr,mo]]),'month');
  else if(exportPeriod==='year'){
    const now=new Date();
    const months=expYear>now.getFullYear()?[]:monthsInRange(expYear,0,expYear,expYear===now.getFullYear()?now.getMonth():11);
    card.innerHTML=goalTrackerHtml(goalPeriod(months),'year');
  }
}
function copyText(){
  const cats=getCats();
  const {income,totals,spent}=getExportTotals();
  const balance=money(income-spent);
  const lines=[`${getExportRangeLabel()} — Summary`,'─'.repeat(28)];
  for(const c of cats) if(totals[c.id]) lines.push(`${c.label}: ${eur(totals[c.id])}`);
  lines.push('─'.repeat(28),`Total Spent: ${eur(spent)}`,`Total Income: ${eur(income)}`,`Balance: ${balance>=0?'+':'-'}${eur(Math.abs(balance))}`);
  navigator.clipboard.writeText(lines.join('\n')).then(()=>toast('Copied ✓')).catch(()=>toast('Copy failed'));
}
function exportXLSX(){
  const cats=getCats();
  const {entries,income,totals,spent}=getExportTotals();
  const balance=money(income-spent);
  const label=getExportRangeLabel();
  const wb=XLSX.utils.book_new();
  const sum=[
    [`${label} — Financial Summary`],[],
    ['Category',`Amount (${cur()})`],
    ...cats.filter(c=>totals[c.id]).map(c=>[c.label,+totals[c.id].toFixed(2)]),
    [],['Total Spent',+spent.toFixed(2)],['Total Income',+income.toFixed(2)],['Balance',+balance.toFixed(2)],
    [],['25-15-50-10 Goal Tracker'],
    ['25% Growth',+(income*0.25).toFixed(2)],['15% Stability',+(income*0.15).toFixed(2)],
    ['50% Essentials',+(income*0.50).toFixed(2)],['10% Rewards',+(income*0.10).toFixed(2)],
  ];
  const ws1=XLSX.utils.aoa_to_sheet(sum); ws1['!cols']=[{wch:24},{wch:14}];
  XLSX.utils.book_append_sheet(wb,ws1,'Summary');
  const rows=[['Date','Description','Category','Type',`Amount (${cur()})`],
    ...entries.sort((a,b)=>new Date(a.date)-new Date(b.date)).map(e=>{
      const cat=e.isIncome?'Income':getCatById(e.category).label;
      return [e.date,e.description||'',cat,e.isIncome?'Income':'Expense',e.isIncome?e.amount:-e.amount];
    })];
  const ws2=XLSX.utils.aoa_to_sheet(rows); ws2['!cols']=[{wch:12},{wch:26},{wch:18},{wch:10},{wch:14}];
  XLSX.utils.book_append_sheet(wb,ws2,'All Entries');
  const filenamePart=exportPeriod==='month'?`${yr}_${String(mo+1).padStart(2,'0')}_${MONTHS[mo]}`:exportPeriod==='year'?`${expYear}`:'AllTime';
  XLSX.writeFile(wb,`Finance_${filenamePart}.xlsx`);
  toast('Excel downloaded ✓');
}

// ── SETTINGS ───────────────────────────────────────────────────────────────
// turn each Settings card into a section that folds shut; which ones are open is remembered on this device
const SETTINGS_OPEN_KEY='settings_open_sections';
const SETTINGS_ICONS={'Manage Categories':'🏷️','Recurring transactions':'🔁','Google Drive backup':'☁️','Currency':'💱','App lock':'🔒','Danger Zone':'⚠️'};
function initSettingsSections(){
  let opened=[];
  try{ opened=JSON.parse(localStorage.getItem(SETTINGS_OPEN_KEY)||'[]'); }catch(e){}
  document.querySelectorAll('#tab-settings > .card').forEach((card,i)=>{
    const title=card.querySelector(':scope > .card-title');
    if(!title) return;
    const name=title.textContent.trim();
    const body=document.createElement('div');
    body.className='section-body'; body.id=`settingsSection${i}`;
    [...card.children].filter(el=>el!==title).forEach(el=>body.appendChild(el));
    const head=document.createElement('button');
    head.type='button'; head.className='section-head';
    head.setAttribute('aria-controls',body.id);
    head.innerHTML=`<span class="section-ico" aria-hidden="true">${SETTINGS_ICONS[name]||'•'}</span><span class="section-name">${escHtml(name)}</span><span class="section-sub"></span><span class="section-chev" aria-hidden="true">›</span>`;
    head.addEventListener('click',()=>{ setSettingsSectionOpen(card,!card.classList.contains('open')); saveOpenSettingsSections(); });
    title.replaceWith(head);
    card.appendChild(body);
    card.classList.add('section');
    setSettingsSectionOpen(card,opened.includes(name));
  });
}
function setSettingsSectionOpen(card,open){
  card.classList.toggle('open',open);
  card.querySelector('.section-head').setAttribute('aria-expanded',String(open));
}
function saveOpenSettingsSections(){
  const names=[...document.querySelectorAll('#tab-settings > .section.open .section-name')].map(el=>el.textContent);
  try{ localStorage.setItem(SETTINGS_OPEN_KEY,JSON.stringify(names)); }catch(e){}
}
function openSettingsSection(el){
  const card=el?.closest('.section');
  if(card&&!card.classList.contains('open')){ setSettingsSectionOpen(card,true); saveOpenSettingsSections(); }
}
function renderSettingsSubtitles(){
  document.querySelectorAll('#tab-settings > .section').forEach(card=>{
    const name=card.querySelector('.section-name').textContent,sub=card.querySelector('.section-sub');
    if(name==='Manage Categories') sub.textContent=`${getCats().length}`;
    else if(name==='Recurring transactions') sub.textContent=`${getRecurringRules().length}`;
    else if(name==='App lock') sub.textContent=getAppLockCredential()?'On':'Off';
    else if(name==='Currency') sub.textContent=cur();
    else if(name==='Google Drive backup'){
      // amber when the last backup is over 3 days old, or changes have waited over an hour
      const on=localStorage.getItem(DRIVE_ENABLED_KEY)==='1',last=getDriveSyncState().lastSyncAt;
      const pending=on&&localStorage.getItem(DRIVE_PENDING_KEY)==='1',age=last?Date.now()-new Date(last).getTime():Infinity;
      sub.textContent=!on?'Off':last?backupAgo(last):'Not backed up';
      sub.classList.toggle('warn',on&&(age>3*86400000||(pending&&age>3600000)));
    }
  });
}
function renderSettings(){
  const cats=getCats();
  document.getElementById('settingsCatList').innerHTML=cats.map(c=>`
    <div class="settings-cat-item">
      <div class="settings-cat-dot" style="background:${c.color}">${escHtml(c.emoji)}</div>
      <div class="settings-cat-name">${escHtml(c.label)}</div>
      <button class="icon-btn" onclick="startEditCat(${jsArg(c.id)})" title="Edit">✏️</button>
      <button class="icon-btn danger" onclick="deleteCat(${jsArg(c.id)})" title="Delete">🗑️</button>
    </div>`).join('');
  hideCatForm();
  populateRecurringCategorySelect(cats);
  toggleRecurringCategory();
  if(!document.getElementById('recurringStartDate').value)document.getElementById('recurringStartDate').value=localDateString();
  renderRecurringRules();
  renderDriveStatus();
  renderSettingsSubtitles();
}

function populateRecurringCategorySelect(cats=getCats()){
  const select=document.getElementById('recurringCategory');
  const selected=select.value;
  select.replaceChildren(...cats.map(category=>new Option(category.label,category.id)));
  if(cats.some(category=>category.id===selected))select.value=selected;
}
function toggleRecurringCategory(){
  document.getElementById('recurringCategoryGroup').hidden=document.getElementById('recurringType').value==='income';
}
function clearRecurringError(){
  const error=document.getElementById('recurringError');
  error.hidden=true;
  error.textContent='';
}
function showRecurringError(message){
  const error=document.getElementById('recurringError');
  error.textContent=message;
  error.hidden=false;
}
function saveRecurringRule(){
  clearRecurringError();
  const rawAmount=document.getElementById('recurringAmount').value.trim();
  const amount=money(Number(rawAmount.replace(',','.')));
  const type=document.getElementById('recurringType').value;
  const category=document.getElementById('recurringCategory').value;
  const startDate=document.getElementById('recurringStartDate').value;
  const endDate=document.getElementById('recurringEndDate').value;
  if(!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(rawAmount)||!Number.isFinite(amount)||amount<=0){showRecurringError('Enter an amount greater than zero.');return;}
  if(!dateParts(startDate)){showRecurringError('Choose a valid start date.');return;}
  if(endDate&&!dateParts(endDate)){showRecurringError('Choose a valid end date.');return;}
  if(endDate&&endDate<startDate){showRecurringError('End date must be on or after the start date.');return;}
  if(type==='expense'&&!getCats().some(item=>item.id===category)){showRecurringError('Select a category for this expense.');return;}
  const rule={
    id:`rec_${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`,
    isIncome:type==='income',
    amount,
    category:type==='income'?'income':category,
    description:document.getElementById('recurringDescription').value.trim(),
    frequency:document.getElementById('recurringFrequency').value,
    startDate,
    endDate,
    active:true,
    activeFrom:startDate,
    generatedDates:[],
    skippedDates:[],
  };
  const rules=getRecurringRules();
  rules.push(rule);
  saveRecurringRules(rules);
  document.getElementById('recurringAmount').value='';
  document.getElementById('recurringDescription').value='';
  document.getElementById('recurringStartDate').value=localDateString();
  document.getElementById('recurringEndDate').value='';
  ensureRecurringEntries(yr,mo);
  renderRecurringRules();
  toast('Recurring schedule created ✓');
}
function renderRecurringRules(){
  const container=document.getElementById('recurringList');
  if(!container)return;
  const rules=getRecurringRules();
  container.replaceChildren();
  if(!rules.length){
    const empty=document.createElement('div');
    empty.className='recurring-empty';
    empty.textContent='No recurring schedules yet.';
    container.append(empty);
    return;
  }
  const frequencies={weekly:'Weekly',monthly:'Monthly',yearly:'Yearly'};
  for(const rule of rules){
    const category=rule.isIncome?{label:'Income'}:getCatById(rule.category);
    const title=rule.description||category.label;
    const item=document.createElement('div');
    item.className='recurring-item';
    const info=document.createElement('div');
    info.className='recurring-info';
    const name=document.createElement('div');
    name.className='recurring-name';
    name.textContent=`${rule.isIncome?'+':'-'}${eur(Number(rule.amount))} · ${title}`;
    const meta=document.createElement('div');
    meta.className='recurring-meta';
    meta.textContent=`${frequencies[rule.frequency]||rule.frequency} · ${category.label} · Starts ${rule.startDate}${rule.endDate?` · Ends ${rule.endDate}`:''}`;
    const status=document.createElement('div');
    status.className=`recurring-status${rule.active?'':' paused'}`;
    status.textContent=rule.active?'Active':'Paused';
    info.append(name,meta,status);
    const actions=document.createElement('div');
    actions.className='recurring-actions';
    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='icon-btn';
    toggle.title=rule.active?'Pause schedule':'Resume schedule';
    toggle.setAttribute('aria-label',`${rule.active?'Pause':'Resume'} ${title} schedule`);
    toggle.textContent=rule.active?'Ⅱ':'▶';
    toggle.addEventListener('click',()=>toggleRecurringRule(rule.id));
    const remove=document.createElement('button');
    remove.type='button';
    remove.className='icon-btn danger';
    remove.title='Delete schedule';
    remove.setAttribute('aria-label',`Delete ${title} schedule`);
    remove.textContent='🗑️';
    remove.addEventListener('click',()=>deleteRecurringRule(rule.id));
    actions.append(toggle,remove);
    item.append(info,actions);
    container.append(item);
  }
}
function toggleRecurringRule(id){
  const rules=getRecurringRules();
  const rule=rules.find(item=>item.id===id);
  if(!rule)return;
  rule.active=!rule.active;
  if(rule.active)rule.activeFrom=localDateString()<rule.startDate?rule.startDate:localDateString();
  saveRecurringRules(rules);
  if(rule.active)ensureRecurringEntries(yr,mo);
  renderRecurringRules();
  toast(rule.active?'Schedule resumed':'Schedule paused');
}
function deleteRecurringRule(id){
  const rule=getRecurringRules().find(item=>item.id===id);
  if(!rule||!confirm('Delete this schedule? Existing transactions will remain.'))return;
  saveRecurringRules(getRecurringRules().filter(item=>item.id!==id));
  renderRecurringRules();
  toast('Schedule deleted');
}

function showCatForm(prefill){
  clearCatFormError();
  editingCatId = prefill?prefill.id:null;
  pickedColor = prefill?prefill.color:COLOR_PRESETS[0];
  document.getElementById('formTitle').textContent = prefill?'Edit Category':'New Category';
  document.getElementById('formEmoji').value = prefill?prefill.emoji:'';
  document.getElementById('formName').value = prefill?prefill.label:'';
  document.getElementById('customColor').value = pickedColor;
  // Build color swatches
  document.getElementById('colorPresets').innerHTML = COLOR_PRESETS.map(c=>`
    <div class="color-swatch${c===pickedColor?' on':''}" style="background:${c}" onclick="pickPresetColor('${c}',this)"></div>`).join('');
  document.getElementById('catFormWrap').style.display='block';
  document.getElementById('formName').focus();
}
function hideCatForm(){
  document.getElementById('catFormWrap').style.display='none';
  editingCatId=null;
}
function startEditCat(id){
  const cat=getCatById(id);
  showCatForm({...cat});
}
function pickPresetColor(color, el){
  pickedColor=color;
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('customColor').value=color;
}
function pickCustomColor(color){
  pickedColor=color;
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('on'));
}
function saveCatForm(){
  const emoji=document.getElementById('formEmoji').value.trim()||'📌';
  const label=document.getElementById('formName').value.trim();
  const cats=getCats();
  if(!label){showCatFormError('Enter a category name.');return;}
  const duplicate=cats.some(cat=>cat.id!==editingCatId&&cat.label.trim().toLowerCase()===label.toLowerCase());
  if(duplicate){showCatFormError('A category with this name already exists.');return;}
  clearCatFormError();
  if(editingCatId){
    const idx=cats.findIndex(c=>c.id===editingCatId);
    if(idx>-1){cats[idx]={...cats[idx],emoji,label,color:pickedColor};}
  } else {
    const id='cat_'+Date.now().toString(36);
    cats.push({id,label,emoji,color:pickedColor});
  }
  saveCats(cats);
  toast(editingCatId?'Category updated ✓':'Category added ✓');
  renderSettings();
}
function clearCatFormError(){
  const error=document.getElementById('catFormError');
  if(error){error.hidden=true;error.textContent='';}
  document.getElementById('formName').removeAttribute('aria-invalid');
}
function showCatFormError(message){
  const error=document.getElementById('catFormError');
  error.textContent=message;
  error.hidden=false;
  const name=document.getElementById('formName');
  name.setAttribute('aria-invalid','true');
  name.focus();
}
// Deleting a category asks where its entries and repeating payments should go,
// so they don't end up as "unknown".
function monthKeysWithEntries(){
  return Object.keys(localStorage).filter(key=>/^ft_\d{4}_(0[1-9]|1[0-2])$/.test(key)).map(key=>[Number(key.slice(3,7)),Number(key.slice(8,10))-1]);
}
function deleteCat(id){
  const cat=getCatById(id);
  let count=0,total=0;
  for(const [y,m] of monthKeysWithEntries()) for(const e of DB.get(y,m)) if(!e.isIncome&&e.category===id){ count++; total=addMoney(total,e.amount); }
  const rules=getRecurringRules().filter(r=>!r.isIncome&&r.category===id).length;
  if(!count&&!rules){
    if(!confirm(`Delete ${cat.label}? Nothing uses it yet.`)) return;
    finishDeleteCat(id,'');
    return;
  }
  const uses=[count?`${count} entr${count===1?'y':'ies'} (${eur(total)})`:'',rules?`${rules} repeating payment${rules===1?'':'s'}`:''].filter(Boolean).join(' and ');
  const others=getCats().filter(c=>c.id!==id);
  document.getElementById('catDeleteBody').innerHTML=`<h2 id="catDeleteTitle">Delete ${escHtml(cat.emoji)} ${escHtml(cat.label)}?</h2>
    <p class="sheet-note">${uses} use${count+rules===1?'s':''} this category. Where should they go?</p>
    <label class="inp-lbl" for="catDeleteTarget">Move them to</label>
    <select class="inp" id="catDeleteTarget">
      ${others.map(c=>`<option value="${escHtml(c.id)}">${escHtml(c.emoji)} ${escHtml(c.label)}</option>`).join('')}
      <option value="">Leave without a category</option>
    </select>
    <div class="sheet-done"><button class="sheet-btn" type="button" onclick="closeCatDelete()">Cancel</button>&nbsp;<button class="sheet-btn danger" type="button" onclick="finishDeleteCat('${id}',document.getElementById('catDeleteTarget').value)">Delete</button></div>`;
  document.getElementById('catDeleteSheet').hidden=false;
}
function closeCatDelete(){ document.getElementById('catDeleteSheet').hidden=true; }
function finishDeleteCat(id,targetId){
  let moved=0;
  if(targetId){
    for(const [y,m] of monthKeysWithEntries()){
      const entries=DB.get(y,m);
      let changed=false;
      for(const e of entries) if(!e.isIncome&&e.category===id){ e.category=targetId; changed=true; moved++; }
      if(changed) DB.save(y,m,entries);
    }
    const rules=getRecurringRules();
    if(rules.some(r=>!r.isIncome&&r.category===id)) saveRecurringRules(rules.map(r=>!r.isIncome&&r.category===id?{...r,category:targetId}:r));
  }
  const tags=getGoalTags();
  if(tags[id]!==undefined){ delete tags[id]; saveLocalFinanceData(GOAL_TAGS_KEY,JSON.stringify(tags)); }
  saveCats(getCats().filter(c=>c.id!==id));
  closeCatDelete();
  toast(moved?`Deleted · ${moved} moved to ${getCatById(targetId).label}`:'Deleted');
  renderSettings();
}
function clearMonth(){
  if(!confirm(`Delete ALL entries for ${MONTHS[mo]} ${yr}? This cannot be undone.`)) return;
  DB.save(yr,mo,[]);
  toast('Month cleared');
}
