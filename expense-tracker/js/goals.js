// ── GOAL TRACKER (25 · 15 · 50 · 10) ─────────────────────────────────────
// Income is split 25% Growth (stocks), 15% Stability (emergency fund), 50% Essentials, 10% Rewards.
// Essentials and Rewards are the spending in the categories tagged with them. Growth and Stability
// are recommendations: the tracker doesn't know your cash or what you invest. The emergency fund
// goal is 6 months of essentials, and you say in Set up whether you have that saved (yes / no).
// Spending tagged "Emergency fund" is paid from the fund. None of this changes the balance.
const GOAL_TAGS_KEY='ft_goal_tags';
const GOAL_OVERRIDES_KEY='ft_goal_overrides';
const GOAL_PLAN_KEY='ft_goal_plan';
const GOAL_FUND_MONTHS=6;
const GOAL_GROUPS=[['essentials','Essentials'],['rewards','Rewards'],['emergency','Emergency fund'],['','None']];
const GOAL_PCT={growth:25,stability:15,essentials:50,rewards:10};
const GOAL_DATE_RE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
try{ localStorage.removeItem('ft_goal_carry_start'); }catch(e){} // carry-over was replaced long ago
function readJsonObject(key){
  try{ const v=JSON.parse(localStorage.getItem(key)||'{}'); return v&&typeof v==='object'&&!Array.isArray(v)?v:{}; }catch(e){ return {}; }
}
function getGoalTags(){ return readJsonObject(GOAL_TAGS_KEY); }
function getGoalOverrides(){ return readJsonObject(GOAL_OVERRIDES_KEY); }
// fund: {full, date} = your answer to "do you have the emergency fund saved?" and the day you gave it.
// Older plans held cash and stocks amounts; those are no longer used.
function validGoalFund(f){ return !!f&&typeof f==='object'&&typeof f.full==='boolean'&&GOAL_DATE_RE.test(f.date); }
function getGoalPlan(){
  const p=readJsonObject(GOAL_PLAN_KEY);
  return {fund:validGoalFund(p.fund)?{full:p.fund.full,date:p.fund.date}:null};
}
function saveGoalPlan(plan){ saveLocalFinanceData(GOAL_PLAN_KEY,JSON.stringify(plan)); }
function goalDateName(date){ return `${Number(date.slice(8,10))} ${MONTHS[Number(date.slice(5,7))-1].slice(0,3)} ${date.slice(0,4)}`; }
function signedEur(v){ return `${v<-0.005?'-':''}${eur(Math.abs(v))}`; }
// Money in whole cents: amounts are saved rounded to 2 decimals and totals add up in cents,
// so 0.10 + 0.20 is exactly 0.30 and a zero balance never shows as -€0.00
function money(v){ return Math.round(v*100)/100; }
function addMoney(a,b){ return Math.round(a*100+b*100)/100; }
function sumAmounts(list){ return list.reduce((s,e)=>addMoney(s,e.amount),0); }
// one month: targets and what was spent in each group
function goalMonth(y,m){
  const entries=DB.get(y,m),income=sumAmounts(entries.filter(e=>e.isIncome));
  const tags=getGoalTags();
  const byGroup={essentials:0,rewards:0,emergency:0},unassigned={},fromFund=[];
  for(const e of entries.filter(e=>!e.isIncome)){
    const g=tags[e.category];
    if(byGroup[g]!==undefined) byGroup[g]=addMoney(byGroup[g],e.amount); else unassigned[e.category]=addMoney(unassigned[e.category]||0,e.amount);
    if(g==='emergency') fromFund.push(e);
  }
  const target=Object.fromEntries(Object.entries(GOAL_PCT).map(([k,pct])=>[k,income*pct/100]));
  return {income,byGroup,unassigned,fromFund,target};
}
// "September 2026", "Aug, Sep, Oct 2026", "Dec 2025, Jan 2026"
function goalMonthsLabel(list){
  const sorted=[...list].sort((a,b)=>a-b),name=i=>MONTHS[i%12],year=i=>Math.floor(i/12);
  if(sorted.length===1) return `${name(sorted[0])} ${year(sorted[0])}`;
  if(sorted.every(i=>year(i)===year(sorted[0]))) return `${sorted.map(i=>name(i).slice(0,3)).join(', ')} ${year(sorted[0])}`;
  return sorted.map(i=>`${name(i).slice(0,3)} ${year(i)}`).join(', ');
}
// 6 × the average Essentials spending of the last 3 months before y/m that have any
function fundGoal(y,m){
  const tags=getGoalTags(),found=[];
  for(let i=y*12+m-1;i>=y*12+m-12&&found.length<3;i--){
    const yy=Math.floor(i/12),mm=i%12;
    ensureRecurringEntries(yy,mm);
    const spent=sumAmounts(DB.get(yy,mm).filter(e=>!e.isIncome&&tags[e.category]==='essentials'));
    if(spent>0) found.push({i,spent});
  }
  if(found.length){
    const monthly=found.reduce((s,f)=>s+f.spent,0)/found.length;
    return {amount:monthly*GOAL_FUND_MONTHS,monthly,months:found.length,basis:`your average Essentials spending (${goalMonthsLabel(found.map(f=>f.i))})`};
  }
  const g=goalMonth(y,m),monthly=g.byGroup.essentials||g.target.essentials;
  return {amount:monthly*GOAL_FUND_MONTHS,monthly,months:0,basis:g.byGroup.essentials?`your Essentials spending in ${MONTHS[m]} so far (no earlier month has any)`:`half of ${MONTHS[m]}'s income (no Essentials spending yet)`};
}
// a period (one month, or the months of a year) added up, with the fund goal
function goalPeriod(months){
  const sum={income:0,byGroup:{essentials:0,rewards:0,emergency:0},unassigned:{},fromFund:[],target:{}};
  for(const k in GOAL_PCT) sum.target[k]=0;
  for(const [y,m] of months){
    ensureRecurringEntries(y,m);
    const g=goalMonth(y,m);
    sum.income=addMoney(sum.income,g.income);
    for(const k in sum.byGroup) sum.byGroup[k]=addMoney(sum.byGroup[k],g.byGroup[k]);
    for(const id in g.unassigned) sum.unassigned[id]=addMoney(sum.unassigned[id]||0,g.unassigned[id]);
    sum.fromFund.push(...g.fromFund);
    for(const k in GOAL_PCT) sum.target[k]+=g.target[k];
  }
  if(!months.length) return sum;
  const [fy,fm]=months[0],[ly,lm]=months[months.length-1];
  // a month uses the goal it starts with; a year the goal after its last month
  sum.goal=months.length===1?fundGoal(fy,fm):fundGoal(lm===11?ly+1:ly,lm===11?0:lm+1);
  return sum;
}
function renderGoals(){
  const card=document.getElementById('ruleCard');
  card.style.display='block';
  card.innerHTML=goalTrackerHtml(goalPeriod([[yr,mo]]),'month');
}
function refreshGoalCards(){ renderGoals(); if(activeTab==='export') renderExport(); }
// until you've answered, the card asks whether the fund is saved; after that you change it in Set up
function fundAskHtml(goal){
  if(getGoalPlan().fund||!goal||goal.amount<=0) return '';
  return `<div class="goal-ask"><span><b>Do you have ${eur(goal.amount)} saved for emergencies?</b> That's ${GOAL_FUND_MONTHS} months of essentials (${GOAL_FUND_MONTHS} × ${eur(goal.monthly)}).</span><span class="goal-ask-btns"><button class="sheet-btn primary" type="button" onclick="setGoalFund(true)">Yes</button><button class="sheet-btn" type="button" onclick="setGoalFund(false)">No</button></span></div>`;
}
function setGoalFund(full){
  saveGoalPlan({fund:{full,date:localDateString()}});
  if(document.getElementById('goalSheet').hidden) refreshGoalCards(); else reopenGoalSheet();
  toast(full?'Emergency fund: fulfilled ✓':'Emergency fund: not yet, 15% a month recommended');
}
function goalTrackerHtml(g,period){
  const head=`<div class="goal-head"><div class="card-title">25 · 15 · 50 · 10 Goal Tracker</div><button class="link-btn" type="button" onclick="openGoalGroups()">Set up</button></div>`;
  const ask=period==='month'?fundAskHtml(g.goal):'';
  if(g.income<=0) return `${head}${ask}<div class="goal-income">Add this ${period}'s income to see your targets.</div>`;
  const {byGroup,unassigned,fromFund,target,goal}=g;
  const thisP=`this ${period}`,ThisP=`This ${period}`;
  const fund=getGoalPlan().fund,full=!!(fund&&fund.full);
  const bar=(v,t,color)=>`<div class="cat-bar-bg"><div class="cat-bar" style="width:${t>0?Math.min(100,Math.round(Math.max(0,v)/t*100)):(v>0?100:0)}%;background:${color}"></div></div>`;
  const top=(pct,label,sub,color,v,t)=>`<div class="goal-top"><span class="rule-badge" style="background:${color}">${pct}%</span><div class="goal-name">${label}<small>${sub}</small></div><div class="goal-amt">${signedEur(v)}<small>of ${signedEur(t)}</small></div></div>`;
  const recTop=(pct,label,sub,color,v,note)=>`<div class="goal-top"><span class="rule-badge" style="background:${color}">${pct}%</span><div class="goal-name">${label}<small>${sub}</small></div><div class="goal-amt">${eur(v)}<small>${note}</small></div></div>`;
  const chip=(cls,text)=>`<span class="goal-chip ${cls}">${text}</span>`;

  // Growth: a recommendation only
  const growth=`<div class="goal">${recTop(25,'Growth','Stocks','#1D6FA5',target.growth,'recommended')}
    <div class="goal-text">Put 25% of ${thisP}'s income, ${eur(target.growth)}, into stocks.</div>
    <div class="goal-foot"><span>Recommended for stocks</span></div></div>`;

  // Essentials and Rewards: spending against 50% and 10%
  const spendRow=(key,label,sub,color)=>{
    const v=byGroup[key],t=target[key],diff=t-v;
    const text=diff>=0?`You spent ${eur(v)} of ${eur(t)}. The ${eur(diff)} left stays as cash.`
      :`You spent ${eur(v)}, ${eur(-diff)} more than ${eur(t)}. The extra is paid from ${thisP}'s savings (see Stability).`;
    return `<div class="goal">${top(GOAL_PCT[key],label,sub,color,v,t)}${bar(v,t,color)}<div class="goal-text">${text}</div>
      <div class="goal-foot"><span>Spent ${thisP}</span>${diff>=0?chip('ok',`${eur(diff)} left`):chip('over',`${eur(-diff)} over`)}</div></div>`;
  };

  // Stability: 6 months of essentials; whether it's saved is your yes / no in Set up
  const goalText=goal.amount>0
    ?`Goal: ${GOAL_FUND_MONTHS} months of essentials. ${eur(goal.monthly)} a month is ${goal.basis}; ${GOAL_FUND_MONTHS} × ${eur(goal.monthly)} = ${eur(goal.amount)}.`
    :`Set which categories are Essentials in Set up, so the fund goal can be worked out.`;
  const fundText=full
    ?`You said you have it saved (${goalDateName(fund.date)}), so the fund is fulfilled. ${ThisP}'s 15% (${eur(target.stability)}) is spare: it covers Essentials or Rewards overspending first, and the rest is extra savings.`
    :fund?`You said you don't have it saved yet (${goalDateName(fund.date)}), so put 15% of ${thisP}'s income, ${eur(target.stability)}, into your emergency fund. Once it's there, change your answer to Yes in Set up.`
    :`Put 15% of ${thisP}'s income, ${eur(target.stability)}, into your emergency fund. If you already have the goal saved, say so${period==='month'&&goal.amount>0?' above':' in Set up'}.`;
  const overspent=['essentials','rewards'].filter(k=>byGroup[k]-target[k]>0.005);
  const over=overspent.reduce((s,k)=>s+byGroup[k]-target[k],0);
  const overNames=overspent.map(k=>k==='essentials'?'Essentials':'Rewards').join(' and ');
  const overText=overspent.length?`<div class="goal-text">${full
    ?`Your fund is fulfilled, so ${thisP}'s spare 15% covers the ${overNames} overspending (${eur(over)})${over-target.stability>0.005?`; the other ${eur(over-target.stability)} comes from your savings`:''}.`
    :`The ${overNames} overspending (${eur(over)}) comes out of ${thisP}'s savings, so less can go into the fund.`}</div>`:'';
  const usedFor=fromFund.slice(0,3).map(e=>escHtml(e.description||getCatById(e.category).label)).join(', ')+(fromFund.length>3?` +${fromFund.length-3} more`:'');
  const fromFundText=fromFund.length?`<div class="goal-text">You paid ${eur(byGroup.emergency)} from the fund ${thisP} (${usedFor}).${full?` If that leaves less than ${eur(goal.amount)}, change your answer to No in Set up.`:''}</div>`:'';
  const stability=`<div class="goal">${recTop(15,'Stability','Emergency fund','#B5780A',target.stability,full?'spare':'recommended')}${full?bar(1,1,'#B5780A'):''}
    <div class="goal-text">${goalText} ${fundText}</div>${overText}${fromFundText}
    <div class="goal-foot"><span>Emergency fund</span>${full?chip('ok','Fulfilled ✓'):fund?chip('under','Not yet'):chip('under','Not answered')}</div></div>`;

  const loose=Object.keys(unassigned).map(id=>{ const c=getCatById(id); return `${escHtml(c.emoji)} ${escHtml(c.label)} ${eur(unassigned[id])}`; });
  return `${head}${ask}
    <div class="goal-income">Income ${eur(g.income)}, split 25 · 15 · 50 · 10.</div>
    ${growth}
    ${stability}
    ${spendRow('essentials','Essentials','Rent, food, bills','#2E7D32')}
    ${spendRow('rewards','Rewards','Travel & fun','#4527A0')}
    ${loose.length?`<div class="goal-unassigned">Not in any group: ${loose.join(' · ')}. <button class="link-btn" type="button" onclick="openGoalGroups()">Choose a group</button></div>`:''}`;
}
function openGoalGroups(){
  const tags=getGoalTags(),fund=getGoalPlan().fund,goal=fundGoal(yr,mo);
  const goalLine=goal.amount>0?`<br>${goal.basis[0].toUpperCase()+goal.basis.slice(1)}: <b>${eur(goal.monthly)}</b> a month.<br>${GOAL_FUND_MONTHS} × ${eur(goal.monthly)} = <b>${eur(goal.amount)}</b>`
    :' Choose your Essentials categories below so it can be worked out.';
  const yes=!!(fund&&fund.full),no=!!(fund&&!fund.full);
  const answer=goal.amount>0?`<p class="sheet-note"><b>Do you have ${eur(goal.amount)} saved for emergencies?</b></p>
      <div class="seg seg-2" role="group" aria-label="Emergency fund saved"><button type="button" class="${yes?'on':''}" aria-pressed="${yes}" onclick="setGoalFund(true)">Yes</button><button type="button" class="${no?'on':''}" aria-pressed="${no}" onclick="setGoalFund(false)">No</button></div>
      <p class="sheet-note">${fund?`You answered ${yes?'Yes':'No'} on ${goalDateName(fund.date)}. `:''}Yes: the Stability row shows Fulfilled. No: it recommends putting 15% of each month's income into the fund. The tracker doesn't ask again, so change your answer here when your situation changes, for example after paying for something from the fund.</p>`:'';
  document.getElementById('goalSheetBody').innerHTML=`<h2 id="goalSheetTitle">Goal tracker setup</h2>
    <p class="sheet-note">Your income is split four ways: <b>25% Growth</b> (stocks), <b>15% Stability</b> (emergency fund), <b>50% Essentials</b> (rent, food, bills) and <b>10% Rewards</b> (travel, fun). The tracker compares what really happened with those shares. Nothing here changes your balance.</p>
    <div class="tag-row">
      <div class="tag-name">📈 Stocks</div>
      <p class="sheet-note">Each month the tracker recommends 25% of your income for stocks. It doesn't ask or track how much you really invest.</p>
    </div>
    <div class="tag-row">
      <div class="tag-name">🛟 Emergency fund goal</div>
      <p class="sheet-note">The fund is a cushion for when income stops or something big breaks, so the goal is <b>${GOAL_FUND_MONTHS} months of essentials</b>, the usual safety margin.${goalLine}</p>
      ${answer}
    </div>
    <div class="tag-row">
      <div class="tag-name">⚖️ When you overspend</div>
      <p class="sheet-note">If Essentials or Rewards go over their share in a month, the extra is paid from that month's savings, and the Stability row says so. When your fund is fulfilled, the spare 15% covers it first.</p>
    </div>
    <h3 class="sheet-sub">Groups</h3>
    <p class="sheet-note">Choose where each category's spending counts. "Emergency fund" means you pay it from the fund, so it doesn't count against this month's shares.</p>
    ${getCats().map(c=>`<div class="tag-row"><div class="tag-name">${escHtml(c.emoji)} ${escHtml(c.label)}</div><div class="seg" role="group" aria-label="${escHtml(c.label)} group">${GOAL_GROUPS.map(([g,l])=>`<button type="button" class="${(tags[c.id]||'')===g?'on':''}" aria-pressed="${(tags[c.id]||'')===g}" onclick="setGoalTag(${jsArg(c.id)},'${g}',this)">${l}</button>`).join('')}</div></div>`).join('')}
    <div class="sheet-done"><button class="sheet-btn primary" type="button" onclick="closeGoalGroups()">Done</button></div>`;
  document.getElementById('goalSheet').hidden=false;
}
function closeGoalGroups(){ document.getElementById('goalSheet').hidden=true; refreshGoalCards(); }
function reopenGoalSheet(){
  const scroll=document.getElementById('goalSheetBody').scrollTop;
  openGoalGroups();
  document.getElementById('goalSheetBody').scrollTop=scroll;
  refreshGoalCards();
}
function setGoalTag(id,group,btn){
  const tags=getGoalTags();
  if(group) tags[id]=group; else delete tags[id];
  saveLocalFinanceData(GOAL_TAGS_KEY,JSON.stringify(tags));
  btn.parentElement.querySelectorAll('button').forEach(b=>{ b.classList.toggle('on',b===btn); b.setAttribute('aria-pressed',String(b===btn)); });
}

// chart colours come from the CSS tokens so they follow light/dark mode
function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
const darkQuery=window.matchMedia('(prefers-color-scheme: dark)');
darkQuery.addEventListener('change',()=>{
  if(trendChart){trendChart.destroy();trendChart=null;}
  if(categoryChart){categoryChart.destroy();categoryChart=null;}
  if(activeTab==='home') renderHome();
});
let categoryChartData=[];

// "Spent 12% less than September". For the month in progress it compares with the
// same point of last month (day 1 to today's day), so a half month isn't set against a full one.
function spendingComparison(spent){
  const prevY=mo===0?yr-1:yr,prevM=mo===0?11:mo-1;
  const now=new Date(),isCurrent=yr===now.getFullYear()&&mo===now.getMonth();
  const cutoff=isCurrent?`${prevY}-${String(prevM+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`:null;
  ensureRecurringEntries(prevY,prevM);
  const prev=DB.get(prevY,prevM).filter(e=>!e.isIncome&&(!cutoff||(e.date||'')<=cutoff)).reduce((s,e)=>addMoney(s,e.amount),0);
  if(prev<=0||spent<=0) return '';
  const pct=Math.round((spent-prev)/prev*100);
  const when=isCurrent?`this time in ${MONTHS[prevM]}`:MONTHS[prevM];
  if(pct===0) return `<div class="balance-compare">Spent about the same as ${when}</div>`;
  return `<div class="balance-compare"><b class="${pct<0?'grn':'red'}">${pct<0?'↓':'↑'} ${Math.abs(pct)}% ${pct<0?'less':'more'}</b> spent than ${when}</div>`;
}

function renderReportCharts(cats,totals){
  if(typeof window.Chart==='function'){ Chart.defaults.color=cssVar('--text2'); Chart.defaults.borderColor=cssVar('--border'); }
  const monthData=[];
  for(let offset=-5;offset<=0;offset++){
    const date=new Date(yr,mo+offset,1);
    ensureRecurringEntries(date.getFullYear(),date.getMonth());
    const entries=DB.get(date.getFullYear(),date.getMonth());
    monthData.push({
      label:MONTHS[date.getMonth()].slice(0,3),
      title:`${MONTHS[date.getMonth()]} ${date.getFullYear()}`,
      income:entries.filter(entry=>entry.isIncome).reduce((sum,entry)=>addMoney(sum,entry.amount),0),
      expenses:entries.filter(entry=>!entry.isIncome).reduce((sum,entry)=>addMoney(sum,entry.amount),0),
      hasEntries:entries.length>0,
    });
  }
  // start at the first month with entries so the chart isn't half empty, but always show at least 3 months
  const firstWithEntries=monthData.findIndex(month=>month.hasEntries);
  if(firstWithEntries>0) monthData.splice(0,Math.min(firstWithEntries,3));
  const spanWords=['','','','three','four','five','six'];
  document.getElementById('trendChartSpan').textContent=`${spanWords[monthData.length]} months`;

  const trendCanvas=document.getElementById('trendChart');
  const trendEmpty=document.getElementById('trendChartEmpty');
  const hasHistory=monthData.some(month=>month.hasEntries);
  const chartAvailable=typeof window.Chart==='function';
  trendCanvas.hidden=!hasHistory||!chartAvailable;
  trendEmpty.hidden=hasHistory&&chartAvailable;
  trendEmpty.textContent=hasHistory?'Charts could not be loaded. Your transaction data is unchanged.':'No transaction history in these six months yet.';
  trendCanvas.setAttribute('aria-label',`Income and expenses over the ${monthData.length} months ending ${MONTHS[mo]} ${yr}`);
  document.getElementById('trendChartSummary').textContent=monthData.map(month=>`${month.title}: income ${eur(month.income)}, expenses ${eur(month.expenses)}`).join('. ');

  if(!hasHistory||!chartAvailable){
    if(trendChart){trendChart.destroy();trendChart=null;}
  } else if(!trendChart){
    trendChart=new Chart(trendCanvas,{
      type:'bar',
      data:{
        labels:monthData.map(month=>month.label),
        datasets:[
          {label:'Income',data:monthData.map(month=>month.income),backgroundColor:cssVar('--green'),borderRadius:4,maxBarThickness:18},
          {label:'Expenses',data:monthData.map(month=>month.expenses),backgroundColor:cssVar('--red'),borderRadius:4,maxBarThickness:18},
        ],
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:8,padding:16}},
          tooltip:{callbacks:{title:items=>monthData[items[0].dataIndex].title,label:item=>`${item.dataset.label}: ${eur(item.raw)}`}},
        },
        scales:{
          x:{grid:{display:false},ticks:{maxRotation:0}},
          y:{beginAtZero:true,grid:{color:cssVar('--border')},ticks:{callback:value=>`${cur()}${Number(value).toLocaleString('en-GB')}`}},
        },
      },
    });
  } else {
    trendChart.data.labels=monthData.map(month=>month.label);
    trendChart.data.datasets[0].data=monthData.map(month=>month.income);
    trendChart.data.datasets[1].data=monthData.map(month=>month.expenses);
    trendChart.options.plugins.tooltip.callbacks.title=items=>monthData[items[0].dataIndex].title;
    trendChart.update();
  }

  const categoryData=cats.filter(category=>(totals[category.id]||0)>0);
  categoryChartData=categoryData;
  document.getElementById('donutTotal').textContent=eur(Object.values(totals).reduce((sum,v)=>addMoney(sum,v),0));
  const categoryWrap=document.getElementById('categoryChartWrap');
  const categoryCanvas=document.getElementById('categoryChart');
  categoryWrap.hidden=!categoryData.length||!chartAvailable;
  categoryCanvas.setAttribute('aria-label',`Spending by category for ${MONTHS[mo]} ${yr}`);
  if(!categoryData.length||!chartAvailable){
    if(categoryChart){categoryChart.destroy();categoryChart=null;}
  } else if(!categoryChart){
    categoryChart=new Chart(categoryCanvas,{
      type:'doughnut',
      data:{
        labels:categoryData.map(category=>category.label),
        datasets:[{data:categoryData.map(category=>totals[category.id]),backgroundColor:categoryData.map(category=>category.color),borderColor:cssVar('--card'),borderWidth:3,hoverOffset:5}],
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        cutout:'72%',
        onClick:(event,items)=>{ if(items.length) openCategoryHistory(categoryChartData[items[0].index].id); },
        onHover:(event,items,chart)=>{ chart.canvas.style.cursor=items.length?'pointer':'default'; },
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{label:item=>{
            const total=item.dataset.data.reduce((sum,value)=>sum+value,0);
            const share=total>0?Math.round(item.raw/total*100):0;
            return `${item.label}: ${eur(item.raw)} (${share}%)`;
          }}},
        },
      },
    });
  } else {
    categoryChart.data.labels=categoryData.map(category=>category.label);
    categoryChart.data.datasets[0].data=categoryData.map(category=>totals[category.id]);
    categoryChart.data.datasets[0].backgroundColor=categoryData.map(category=>category.color);
    categoryChart.update();
  }
}
