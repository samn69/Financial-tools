function dateParts(value){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');
  if(!match)return null;
  const parts={year:Number(match[1]),month:Number(match[2]),day:Number(match[3])};
  const date=new Date(Date.UTC(parts.year,parts.month-1,parts.day));
  return date.getUTCFullYear()===parts.year&&date.getUTCMonth()===parts.month-1&&date.getUTCDate()===parts.day?parts:null;
}
function formatUtcDate(date){
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}
function daysInMonth(year,month){return new Date(Date.UTC(year,month+1,0)).getUTCDate();}
function recurrenceDatesInMonth(rule,year,month){
  const start=dateParts(rule.startDate);
  if(!start)return [];
  const targetMonth=year*12+month;
  const startMonth=start.year*12+start.month-1;
  if(targetMonth<startMonth)return [];
  let dates=[];
  if(rule.frequency==='weekly'){
    const startTime=Date.UTC(start.year,start.month-1,start.day);
    const monthStart=Date.UTC(year,month,1);
    const firstIndex=Math.max(0,Math.ceil((monthStart-startTime)/(7*86400000)));
    for(let index=firstIndex;;index++){
      const time=startTime+index*7*86400000;
      const due=new Date(time);
      if(due.getUTCFullYear()!==year||due.getUTCMonth()!==month)break;
      dates.push(formatUtcDate(due));
    }
  } else if(rule.frequency==='monthly'){
    const dueDay=Math.min(start.day,daysInMonth(year,month));
    dates=[`${year}-${String(month+1).padStart(2,'0')}-${String(dueDay).padStart(2,'0')}`];
  } else if(rule.frequency==='yearly'&&month===start.month-1){
    const dueDay=Math.min(start.day,daysInMonth(year,month));
    dates=[`${year}-${String(month+1).padStart(2,'0')}-${String(dueDay).padStart(2,'0')}`];
  }
  const earliest=rule.activeFrom||rule.startDate;
  const today=localDateString();
  return dates.filter(date=>date>=earliest&&date>=rule.startDate&&date<=today&&(!rule.endDate||date<=rule.endDate));
}
function occurrenceExists(ruleId,date){
  for(const key of Object.keys(localStorage)){
    if(!/^ft_\d{4}_\d{2}$/.test(key))continue;
    try{
      const entries=JSON.parse(localStorage.getItem(key)||'[]');
      if(entries.some(entry=>entry.recurringRuleId===ruleId&&entry.recurringOccurrence===date))return true;
    }catch(e){}
  }
  return false;
}
function ensureRecurringEntries(year,month){
  const rules=getRecurringRules();
  let rulesChanged=false;
  for(const rule of rules){
    if(!Array.isArray(rule.generatedDates)){rule.generatedDates=[];rulesChanged=true;}
    if(!Array.isArray(rule.skippedDates)){rule.skippedDates=[];rulesChanged=true;}
    if(!rule.active)continue;
    const generatedDates=new Set(rule.generatedDates||[]);
    const skippedDates=new Set(rule.skippedDates||[]);
    for(const date of recurrenceDatesInMonth(rule,year,month)){
      if(generatedDates.has(date)||skippedDates.has(date))continue;
      if(!occurrenceExists(rule.id,date)){
        DB.add(year,month,{
          amount:rule.amount,
          description:rule.description||(rule.isIncome?'Income':getCatById(rule.category).label),
          category:rule.isIncome?'income':rule.category,
          isIncome:rule.isIncome,
          date,
          recurringRuleId:rule.id,
          recurringOccurrence:date,
        });
      }
      rule.generatedDates.push(date);
      generatedDates.add(date);
      rulesChanged=true;
    }
  }
  if(rulesChanged)saveRecurringRules(rules);
}

// the symbol chosen in Settings; it only changes how amounts are shown, nothing is converted
const CURRENCY_KEY='ft_currency';
const CURRENCIES={EUR:{symbol:'€',name:'Euro'},USD:{symbol:'$',name:'Dollar'}};
function currencyCode(){ try{ const c=localStorage.getItem(CURRENCY_KEY); return CURRENCIES[c]?c:'EUR'; }catch(e){ return 'EUR'; } }
function cur(){ return CURRENCIES[currencyCode()].symbol; }
// €1,234.56: two decimals with thousands separators
function eur(v){ return cur()+v.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}); }
// static labels in the page (Add form, recurring form) follow the chosen symbol
function applyCurrency(){
  document.querySelectorAll('[data-cur]').forEach(el=>{ el.textContent=el.dataset.cur.replace('¤',cur()); });
  document.querySelectorAll('#currencySeg button').forEach(b=>{ const on=b.dataset.code===currencyCode(); b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on)); });
}
function setCurrency(code){
  if(!CURRENCIES[code]) return;
  saveLocalFinanceData(CURRENCY_KEY,code);  // part of the Drive backup, so it syncs like any change
  applyCurrency();
  renderSettingsSubtitles();
  refresh();
  toast(`Showing amounts in ${CURRENCIES[code].symbol} ✓`);
}

// ── MONTH NAV ──────────────────────────────────────────────────────────────
function changeMonth(d){
  mo+=d;
  if(mo>11){mo=0;yr++;} if(mo<0){mo=11;yr--;}
  document.getElementById('monthLabel').textContent=`${MONTHS[mo]} ${yr}`;
  // slide the page in from the side we're moving towards
  const content=document.querySelector('.content');
  content.classList.remove('month-next','month-prev');
  void content.offsetWidth;
  content.classList.add(d>0?'month-next':'month-prev');
  refresh();
}

// ── TABS ───────────────────────────────────────────────────────────────────
function switchTab(t){
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
  document.getElementById('nav-'+t).classList.add('active');
  activeTab=t;
  updateMonthNav();
  document.querySelector('.content').classList.remove('month-next','month-prev');
  document.getElementById('fab').hidden=!(t==='home'||t==='history');
  refresh();
  window.scrollTo(0,0);
}
function refresh(){
  if(activeTab==='home')     renderHome();
  if(activeTab==='history')  renderHistory();
  if(activeTab==='export')   renderExport();
  if(activeTab==='settings') renderSettings();
  if(activeTab==='add')      buildCatGrid();
}

// ── HOME ───────────────────────────────────────────────────────────────────
function renderHome(){
  const cats=getCats();
  ensureRecurringEntries(yr,mo);
  const entries=DB.get(yr,mo);
  const income=entries.filter(e=>e.isIncome).reduce((s,e)=>addMoney(s,e.amount),0);
  const totals={},counts={};
  for(const e of entries.filter(e=>!e.isIncome)){
    totals[e.category]=addMoney(totals[e.category]||0,e.amount);
    counts[e.category]=(counts[e.category]||0)+1;
  }
  const spent=Object.values(totals).reduce((s,v)=>addMoney(s,v),0);
  const balance=money(income-spent);
  const maxV=Math.max(...Object.values(totals),1);

  document.getElementById('balanceCard').innerHTML=`<div class="balance-card">
    <div class="balance-row">
      <div class="balance-stat"><div class="balance-ico in" aria-hidden="true">↓</div><div><div class="balance-stat-lbl">Income</div><div class="balance-stat-val">${eur(income)}</div></div></div>
      <div class="balance-stat"><div class="balance-ico out" aria-hidden="true">↑</div><div><div class="balance-stat-lbl">Spent</div><div class="balance-stat-val">${eur(spent)}</div></div></div>
      <div class="balance-stat total"><div><div class="balance-stat-lbl">Balance · ${MONTHS[mo]}</div><div class="balance-stat-val ${balance>=0?'grn':'red'}">${balance>=0?'+':'-'}${eur(Math.abs(balance))}</div></div></div>
    </div>
    ${spendingComparison(spent)}
  </div>`;

  // largest first
  const active=cats.filter(c=>(totals[c.id]||0)>0).sort((a,b)=>totals[b.id]-totals[a.id]);
  document.getElementById('catBreakdown').innerHTML=active.length
    ? active.map(c=>{
        const v=totals[c.id]||0,pct=Math.round(v/maxV*100),ps=spent>0?Math.round(v/spent*100):0,n=counts[c.id];
        return `<button class="cat-item" type="button" onclick="openCategoryHistory(${jsArg(c.id)})" aria-label="Show ${escHtml(c.label)} transactions">
          <div class="cat-ico" style="--cat-color:${c.color}" aria-hidden="true">${escHtml(c.emoji)}</div>
          <div class="cat-col">
            <div class="cat-top"><span class="cat-name">${escHtml(c.label)}</span><span class="cat-amount">${eur(v)}</span></div>
            <div class="cat-bar-bg"><div class="cat-bar" style="width:${pct}%;background:${c.color}"></div></div>
            <div class="cat-pct">${n} transaction${n===1?'':'s'} · ${ps}% of spending</div>
          </div>
          <div class="cat-go" aria-hidden="true">›</div>
        </button>`;
      }).join('')
    : '<div class="empty"><div class="icon">📊</div><p>No expenses yet.<br>Tap + to add your first entry.</p></div>';

  renderReportCharts(cats,totals);

  renderGoals();
}
