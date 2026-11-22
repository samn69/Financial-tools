// ── ADD ────────────────────────────────────────────────────────────────────
try{ localStorage.removeItem('ft_last_category'); }catch(e){} // the form no longer starts with the last category
// the amount field grows with what's typed, so "€" stays right next to the number
function fitAmountInput(){
  const amount=document.getElementById('amtInput');
  amount.style.width=`${Math.max(4,amount.value.length)+0.6}ch`;
}
function openAddFromFab(){
  if(editingEntryId===null) resetEntryForm();
  switchTab('add');
}
function escHtml(text){ return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// a value passed to an onclick="…" handler, quoted for JavaScript and then for the attribute
function jsArg(value){ return escHtml(JSON.stringify(String(value))); }

// Description suggestions, learned from every saved entry on this device.
// Typing shows earlier descriptions whose words start with what you typed; with nothing
// typed, the chosen category's most used ones (or your usual income ones). Picking one also picks its usual category.
let descIndex=null,descShown=[];
function buildDescIndex(){
  const map=new Map(),cats=getCats();
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(!/^ft_\d{4}_\d{2}$/.test(key)) continue;
    let entries=[]; try{ entries=JSON.parse(localStorage.getItem(key)||'[]'); }catch(e){}
    for(const e of entries){
      const text=(e.description||'').trim();
      if(!text) continue;
      // skip the placeholders saveEntry fills in when the description is left empty
      if(e.isIncome?text==='Income':cats.some(c=>c.id===e.category&&c.label===text)) continue;
      const k=(e.isIncome?'+':'-')+text.toLocaleLowerCase();
      const item=map.get(k)||{text,isIncome:!!e.isIncome,count:0,last:'',cats:{}};
      item.count++;
      if((e.date||'')>=item.last){item.last=e.date||'';item.text=text;}
      if(!e.isIncome) item.cats[e.category]=(item.cats[e.category]||0)+1;
      map.set(k,item);
    }
  }
  descIndex=[...map.values()].map(item=>({...item,cat:Object.keys(item.cats).sort((a,b)=>item.cats[b]-item.cats[a])[0]||null}));
}
function renderDescSuggestions(){
  if(!descIndex) buildDescIndex();
  const box=document.getElementById('descSuggest');
  const q=document.getElementById('descInput').value.trim().toLocaleLowerCase();
  const isIncome=entryType==='income';
  let list=descIndex.filter(item=>item.isIncome===isIncome);
  if(q){
    list=list.filter(item=>{
      const t=item.text.toLocaleLowerCase();
      return t!==q&&(t.startsWith(q)||t.split(/\s+/).some(w=>w.startsWith(q)));
    });
  } else if(!isIncome){
    list=selCat?list.filter(item=>item.cats[selCat]):[];
  }
  const inCat=item=>!isIncome&&selCat&&item.cats[selCat]?1:0;
  list.sort((a,b)=>inCat(b)-inCat(a)||b.count-a.count||b.last.localeCompare(a.last));
  descShown=list.slice(0,5);
  box.innerHTML=descShown.map((item,i)=>{
    const cat=!isIncome&&item.cat?getCatById(item.cat):null;
    return `<button class="desc-chip" type="button" onclick="pickDescSuggestion(${i})">${cat?`<b aria-hidden="true">${escHtml(cat.emoji)}</b>`:''}<span>${escHtml(item.text)}</span></button>`;
  }).join('');
}
// typing a description used before picks its usual category
function matchDescCategory(){
  if(entryType!=='expense') return;
  if(!descIndex) buildDescIndex();
  const q=document.getElementById('descInput').value.trim().toLocaleLowerCase();
  const item=q&&descIndex.find(it=>!it.isIncome&&it.text.toLocaleLowerCase()===q);
  if(item&&item.cat&&getCats().some(c=>c.id===item.cat)&&selCat!==item.cat){
    selCat=item.cat; buildCatGrid(); clearEntryError();
  }
}
function pickDescSuggestion(i){
  const item=descShown[i]; if(!item) return;
  document.getElementById('descInput').value=item.text;
  if(entryType==='expense'&&item.cat&&getCats().some(c=>c.id===item.cat)&&selCat!==item.cat){
    selCat=item.cat; buildCatGrid(); clearEntryError();
  }
  renderDescSuggestions();
}
function buildCatGrid(){
  const cats=getCats();
  document.getElementById('catGrid').innerHTML=cats.map(c=>`
    <button class="cat-btn${selCat===c.id?' on':''}" style="--cat-color:${c.color}" aria-pressed="${selCat===c.id}" onclick="pickCat(${jsArg(c.id)},this)">
      ${escHtml(c.emoji)}<br>${escHtml(c.label)}
    </button>`).join('');
}
function setType(t){
  entryType=t;
  document.getElementById('btnExp').className=`type-btn exp${t==='expense'?' on':''}`;
  document.getElementById('btnInc').className=`type-btn inc${t==='income'?' on':''}`;
  document.getElementById('catSection').style.display=t==='expense'?'block':'none';
  if(t==='income'){selCat=null;document.querySelectorAll('.cat-btn').forEach(b=>{b.classList.remove('on');b.setAttribute('aria-pressed','false');});}
  renderDescSuggestions();
}
function pickCat(id,btn){
  selCat=id;
  clearEntryError();
  document.querySelectorAll('.cat-btn').forEach(b=>{b.classList.remove('on');b.setAttribute('aria-pressed','false');});
  btn.classList.add('on');
  btn.setAttribute('aria-pressed','true');
  renderDescSuggestions();
}
function clearEntryError(){
  const error=document.getElementById('entryError');
  error.hidden=true;
  error.textContent='';
  ['amtInput','dateInput','catGrid'].forEach(id=>document.getElementById(id).removeAttribute('aria-invalid'));
}
function showEntryError(message,fieldId){
  clearEntryError();
  const error=document.getElementById('entryError');
  error.textContent=message;
  error.hidden=false;
  const field=document.getElementById(fieldId);
  field.setAttribute('aria-invalid','true');
  (fieldId==='catGrid'?field.querySelector('.cat-btn')||field:field).focus();
}
function saveEntry(){
  const raw=document.getElementById('amtInput').value.trim();
  const normalizedAmount=raw.replace(',','.');
  const amt=money(Number(normalizedAmount));
  const desc=document.getElementById('descInput').value.trim();
  const enteredDate=document.getElementById('dateInput').value;
  if(!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(raw)||!Number.isFinite(amt)||amt<=0){showEntryError('Enter an amount greater than zero using digits and an optional decimal separator.','amtInput');return;}
  const selectedCategory=getCats().find(category=>category.id===selCat);
  if(entryType==='expense'&&!selectedCategory){showEntryError('Select a category before saving this expense.','catGrid');return;}
  const date=enteredDate||localDateString();
  const dateParts=date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!dateParts){showEntryError('Choose a valid transaction date.','dateInput');return;}
  const ey=Number(dateParts[1]),em=Number(dateParts[2])-1,day=Number(dateParts[3]);
  const parsedDate=new Date(ey,em,day);
  if(parsedDate.getFullYear()!==ey||parsedDate.getMonth()!==em||parsedDate.getDate()!==day){showEntryError('Choose a valid transaction date.','dateInput');return;}
  clearEntryError();
  const transaction={
    amount:amt,
    description:desc||(entryType==='income'?'Income':selectedCategory.label),
    category:entryType==='income'?'income':selCat,
    isIncome:entryType==='income',
    date,
  };
  const wasEditing=editingEntryId!==null;
  if(wasEditing){
    const updated=DB.update(editingEntryYear,editingEntryMonth,ey,em,editingEntryId,transaction);
    if(!updated){showEntryError('This transaction could not be found. Return to history and try again.','amtInput');return;}
    yr=ey;mo=em;
    document.getElementById('monthLabel').textContent=`${MONTHS[mo]} ${yr}`;
  } else DB.add(ey,em,transaction);
  descIndex=null;
  toast(wasEditing?'Updated ✓':'Saved ✓');
  resetEntryForm();
  setTimeout(()=>switchTab('home'),500);
}
function resetEntryForm(){
  editingEntryId=null;
  editingEntryYear=null;
  editingEntryMonth=null;
  document.getElementById('amtInput').value=''; fitAmountInput();
  document.getElementById('descInput').value='';
  document.getElementById('dateInput').value=localDateString();
  document.getElementById('entryFormActions').classList.remove('editing');
  document.getElementById('saveEntryButton').textContent='Save Entry';
  document.getElementById('cancelEditButton').hidden=true;
  // no category until you pick one, or a description you used before picks it
  selCat=null;
  setType('expense');
  buildCatGrid();
  clearEntryError();
  renderDescSuggestions();
}
// y/m name the entry's month; History's "All months" list passes them, everything else edits the selected month
function startEditEntry(id,y=yr,m=mo){
  const entry=DB.get(y,m).find(item=>item.id===id);
  if(!entry){toast('This transaction could not be found');return;}
  editingEntryId=id;
  editingEntryYear=y;
  editingEntryMonth=m;
  switchTab('add');
  setType(entry.isIncome?'income':'expense');
  selCat=entry.isIncome?null:entry.category;
  buildCatGrid();
  document.getElementById('amtInput').value=entry.amount.toFixed(2); fitAmountInput();
  document.getElementById('descInput').value=entry.description||'';
  document.getElementById('dateInput').value=entry.date||localDateString();
  document.getElementById('entryFormActions').classList.add('editing');
  document.getElementById('saveEntryButton').textContent='Save Changes';
  document.getElementById('cancelEditButton').hidden=false;
  clearEntryError();
  renderDescSuggestions();
}
function cancelEntryEdit(){
  resetEntryForm();
  switchTab('history');
}

// ── HISTORY ────────────────────────────────────────────────────────────────
// 'month' lists the selected month, 'all' every saved month; History opens on 'month'
let historyScope='month';
function setHistoryScope(scope){
  historyScope=scope;
  document.querySelectorAll('#historyScopeSeg button').forEach(b=>{ const on=b.dataset.scope===scope; b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on)); });
  updateMonthNav();
  if(activeTab==='history') renderHistory();
}
// the month arrows don't apply on Settings, nor to History's "All months" list
function updateMonthNav(){
  const hide=activeTab==='settings'||activeTab==='history'&&historyScope==='all';
  document.getElementById('monthNav').style.display=hide?'none':'flex';
}
// every entry with the month it is stored under (y, m), so Edit and Delete find it
function historyEntries(){
  if(historyScope!=='all') return DB.get(yr,mo).map(e=>({...e,y:yr,m:mo}));
  return Object.keys(localStorage).filter(key=>/^ft_\d{4}_(0[1-9]|1[0-2])$/.test(key))
    .flatMap(key=>{ const y=Number(key.slice(3,7)),m=Number(key.slice(8,10))-1; return DB.get(y,m).map(e=>({...e,y,m})); });
}
function renderHistory(){
  ensureRecurringEntries(yr,mo);
  const allEntries=historyEntries();
  document.getElementById('historyTitle').textContent=historyScope==='all'?'All Transactions':'Transactions This Month';
  const categoryFilter=document.getElementById('historyCategoryFilter');
  const selectedCategory=categoryFilter.value;
  categoryFilter.replaceChildren(new Option('All categories',''),...getCats().map(category=>new Option(category.label,category.id)));
  if(getCats().some(category=>category.id===selectedCategory)) categoryFilter.value=selectedCategory;
  const query=document.getElementById('historySearch').value.trim().toLocaleLowerCase();
  const normalizedQuery=query.replace(',','.');
  const typeFilter=document.getElementById('historyTypeFilter').value;
  categoryFilter.value=categoryFilter.querySelector(`option[value="${CSS.escape(selectedCategory)}"]`)?selectedCategory:'';
  document.getElementById('historyClear').hidden=!query&&typeFilter==='all'&&!categoryFilter.value;
  const summary=document.getElementById('historySummary');
  if(!allEntries.length){
    document.getElementById('historyList').innerHTML=`<div class="empty"><div class="icon">📋</div><p>${historyScope==='all'?'No entries yet.':'No entries this month yet.'}</p></div>`;
    summary.hidden=true;
    return;
  }
  const sorted=allEntries
    .filter(entry=>{
      const category=getCatById(entry.category);
      const searchable=[entry.description||'',category.label,entry.amount.toFixed(2),String(entry.amount),entry.date||'',entry.isIncome?'income':'expense'];
      const matchesQuery=!query||searchable.some(value=>String(value).toLocaleLowerCase().includes(query)||String(value).toLocaleLowerCase().includes(normalizedQuery));
      const matchesType=typeFilter==='all'||(typeFilter==='income'?entry.isIncome:!entry.isIncome);
      const matchesCategory=!categoryFilter.value||entry.category===categoryFilter.value;
      return matchesQuery&&matchesType&&matchesCategory;
    })
    .sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(!sorted.length){
    document.getElementById('historyList').innerHTML='<div class="empty"><div class="icon">🔎</div><p>No transactions match these filters.</p></div>';
    summary.hidden=true;
    return;
  }
  const sumIncome=sorted.filter(e=>e.isIncome).reduce((s,e)=>addMoney(s,e.amount),0);
  const sumExpense=sorted.filter(e=>!e.isIncome).reduce((s,e)=>addMoney(s,e.amount),0);
  const totalParts=[];
  if(sumExpense>0)totalParts.push(`-${eur(sumExpense)}`);
  if(sumIncome>0)totalParts.push(`+${eur(sumIncome)}`);
  const totalClass=sumExpense>0&&sumIncome>0?'':(sumIncome>0?'grn':'red');
  summary.hidden=false;
  summary.innerHTML=`<span>${sorted.length} transaction${sorted.length===1?'':'s'}</span><span class="history-summary-total ${totalClass}">${totalParts.join(' · ')||eur(0)}</span>`;
  openSwipeRow=null;
  const today=localDateString(),yesterdayDate=new Date(); yesterdayDate.setDate(yesterdayDate.getDate()-1);
  const yesterday=localDateString(yesterdayDate);
  const thisYear=today.slice(0,4);
  const dayLabel=date=>date===today?'Today':date===yesterday?'Yesterday':date?new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',...(date.slice(0,4)!==thisYear&&{year:'numeric'})}):'No date';
  const dayTotal=date=>{
    const same=sorted.filter(x=>x.date===date);
    const out=same.filter(x=>!x.isIncome).reduce((s,x)=>addMoney(s,x.amount),0),inn=same.filter(x=>x.isIncome).reduce((s,x)=>addMoney(s,x.amount),0);
    return [out?`-${eur(out)}`:'',inn?`+${eur(inn)}`:''].filter(Boolean).join(' · ');
  };
  document.getElementById('historyList').innerHTML=sorted.map((e,i)=>{
    const cat=getCatById(e.category);
    const color=e.isIncome?'#1B6B50':cat.color;
    const head=i===0||sorted[i-1].date!==e.date?`<div class="day-head"><span>${dayLabel(e.date)}</span><span class="day-total">${dayTotal(e.date)}</span></div>`:'';
    return `${head}<div class="swipe-row" data-id="${escHtml(e.id)}" data-y="${e.y}" data-m="${e.m}">
      <div class="swipe-actions">
        <button class="swipe-edit" type="button" onclick="startEditEntry(${jsArg(e.id)},${e.y},${e.m})"><span aria-hidden="true">✎</span>Edit</button>
        <button class="swipe-del" type="button" onclick="delEntry(${jsArg(e.id)},${e.y},${e.m})"><span aria-hidden="true">✕</span>Delete</button>
      </div>
      <div class="entry-item">
      <div class="entry-dot" style="background:${color}"></div>
      <div class="entry-info">
        <div class="entry-desc">${escHtml(e.description||'—')}</div>
        <div class="entry-meta">${e.isIncome?'Income':escHtml(cat.label)}</div>
      </div>
      <div class="entry-amt ${e.isIncome?'grn':'red'}">${e.isIncome?'+':'-'}${eur(e.amount)}</div>
      </div>
    </div>`;
  }).join('');
}
// tapping a category on Home opens History filtered to that category's expenses (same month)
function openCategoryHistory(id){
  setHistoryScope('month');
  switchTab('history');
  document.getElementById('historySearch').value='';
  document.getElementById('historyTypeFilter').value='expense';
  document.getElementById('historyCategoryFilter').value=id;
  renderHistory();
}
// Swipe a History row left to reveal Edit / Delete (pointer events cover touch and mouse).
// A tap on a closed row opens Edit; a tap anywhere while a row is open closes it.
const SWIPE_OPEN=-144;
let swipe=null,openSwipeRow=null;
function closeSwipeRow(){
  if(!openSwipeRow) return;
  openSwipeRow.querySelector('.entry-item').style.transform='';
  openSwipeRow=null;
}
// swipe left or right on Home or History to go to the next or previous month
// (rows in History keep their own swipe for Edit/Delete)
function initMonthSwipe(){
  const content=document.querySelector('.content');
  let start=null;
  content.addEventListener('touchstart',ev=>{
    start=null;
    if(!(activeTab==='home'||activeTab==='history'&&historyScope==='month')||ev.touches.length!==1) return;
    if(ev.target.closest('.swipe-row,input,select,textarea,button')) return;
    start={x:ev.touches[0].clientX,y:ev.touches[0].clientY};
  },{passive:true});
  content.addEventListener('touchend',ev=>{
    if(!start) return;
    const t=ev.changedTouches[0],dx=t.clientX-start.x,dy=t.clientY-start.y;
    start=null;
    if(Math.abs(dx)>70&&Math.abs(dy)<Math.abs(dx)*0.6) changeMonth(dx<0?1:-1);
  },{passive:true});
  content.addEventListener('touchcancel',()=>{start=null;},{passive:true});
}
function initSwipeRows(){
  const list=document.getElementById('historyList');
  list.addEventListener('pointerdown',event=>{
    const row=event.target.closest('.swipe-row'),item=event.target.closest('.entry-item');
    if(!row||!item) return;
    swipe={row,item,x:event.clientX,y:event.clientY,base:row===openSwipeRow?SWIPE_OPEN:0,dx:0,moved:false};
  });
  list.addEventListener('pointermove',event=>{
    if(!swipe) return;
    const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;
    if(!swipe.moved){
      if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy)) return;
      swipe.moved=true; swipe.row.classList.add('dragging');
      if(openSwipeRow&&openSwipeRow!==swipe.row) closeSwipeRow();
    }
    swipe.dx=dx;
    swipe.item.style.transform=`translateX(${Math.max(SWIPE_OPEN-24,Math.min(0,swipe.base+dx))}px)`;
  });
  const end=event=>{
    if(!swipe) return;
    const {row,item,base,dx,moved}=swipe; swipe=null;
    row.classList.remove('dragging');
    if(!moved){
      if(event.type==='pointercancel') return;
      if(openSwipeRow) closeSwipeRow();
      else startEditEntry(row.dataset.id,Number(row.dataset.y),Number(row.dataset.m));
      return;
    }
    if(base+dx<SWIPE_OPEN/2){ item.style.transform=`translateX(${SWIPE_OPEN}px)`; openSwipeRow=row; }
    else { item.style.transform=''; if(openSwipeRow===row) openSwipeRow=null; }
  };
  list.addEventListener('pointerup',end);
  list.addEventListener('pointercancel',end);
  document.addEventListener('pointerdown',event=>{ if(openSwipeRow&&!openSwipeRow.contains(event.target)) closeSwipeRow(); });
}
function clearHistoryFilters(){
  document.getElementById('historySearch').value='';
  document.getElementById('historyTypeFilter').value='all';
  document.getElementById('historyCategoryFilter').value='';
  renderHistory();
}
function delEntry(id,y=yr,m=mo){
  if(!confirm('Delete this entry?')) return;
  DB.del(y,m,id); renderHistory(); toast('Deleted');
}
