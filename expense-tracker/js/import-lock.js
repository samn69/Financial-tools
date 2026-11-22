// ── IMPORT ─────────────────────────────────────────────────────────────────
function clearImportError(){
  const error=document.getElementById('importError');
  if(error){error.hidden=true;error.textContent='';}
}
function showImportError(message){
  const error=document.getElementById('importError');
  if(error){error.textContent=message;error.hidden=false;}
}
function findImportField(row,...keywords){
  for(const key of Object.keys(row)){
    const normalized=key.trim().toLowerCase();
    if(keywords.some(word=>normalized.includes(word)))return row[key];
  }
  return undefined;
}
function parseImportAmount(value){
  if(typeof value==='number')return money(value);
  const text=String(value??'').trim();
  if(!text)return NaN;
  // The last "." or "," is the decimal mark unless it appears more than once (then every
  // separator groups thousands): 1.234,56 · 1,234.56 · 1.234.567 · 12,50 all read correctly
  let normalized=text.replace(/[^0-9,.-]/g,'');
  const last=Math.max(normalized.lastIndexOf(','),normalized.lastIndexOf('.'));
  if(last>=0){
    const separator=normalized[last];
    normalized=normalized.split(separator).length>2
      ?normalized.replace(/[,.]/g,'')
      :normalized.slice(0,last).replace(/[,.]/g,'')+'.'+normalized.slice(last+1);
  }
  const amount=money(Number(normalized));
  return Number.isFinite(amount)?amount:NaN;
}
function parseImportDate(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='number'){
    const parsed=XLSX.SSF.parse_date_code(value);
    if(!parsed)return null;
    const formatted=`${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
    return dateParts(formatted)?formatted:null;
  }
  const text=String(value).trim();
  if(dateParts(text))return text;
  const pad=n=>String(n).padStart(2,'0');
  // 2026/04/03 or 2026.04.03
  const ymd=/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(text);
  if(ymd){const formatted=`${ymd[1]}-${pad(ymd[2])}-${pad(ymd[3])}`;return dateParts(formatted)?formatted:null;}
  // 03/04/2026, 3.4.26: day first, as in Europe, unless only month-first makes sense (04/25/2026)
  const dmy=/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text);
  if(dmy){
    let [a,b]=[Number(dmy[1]),Number(dmy[2])];
    if(b>12&&a<=12)[a,b]=[b,a];
    const formatted=`${dmy[3].length===2?'20'+dmy[3]:dmy[3]}-${pad(b)}-${pad(a)}`;
    return dateParts(formatted)?formatted:null;
  }
  // anything else with a written month, such as "3 Apr 2026" or "Apr 3, 2026"
  const fallback=new Date(text);
  if(Number.isNaN(fallback.getTime()))return null;
  const formatted=`${fallback.getFullYear()}-${String(fallback.getMonth()+1).padStart(2,'0')}-${String(fallback.getDate()).padStart(2,'0')}`;
  return dateParts(formatted)?formatted:null;
}
function findOrCreateImportCategory(label){
  const trimmed=String(label||'').trim();
  if(!trimmed)return null;
  const cats=getCats();
  const existing=cats.find(cat=>cat.label.toLowerCase()===trimmed.toLowerCase());
  if(existing)return existing;
  const newCat={id:'cat_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),label:trimmed,emoji:'📌',color:COLOR_PRESETS[cats.length%COLOR_PRESETS.length]};
  cats.push(newCat);
  saveCats(cats);
  return newCat;
}
async function handleSpreadsheetImport(file){
  clearImportError();
  if(!file)return;
  try{
    const isCsv=/\.csv$/i.test(file.name);
    const data=isCsv?await file.text():await file.arrayBuffer();
    // raw for CSV: the library would read 12,50 as 1250 and 03/04/2026 month first;
    // parseImportAmount and parseImportDate read the text as written instead
    const workbook=XLSX.read(data,isCsv?{type:'string',raw:true}:{type:'array'});
    const sheetName=workbook.SheetNames.find(name=>/entries|transactions/i.test(name))||workbook.SheetNames[workbook.SheetNames.length-1];
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{defval:''});
    let imported=0,skipped=0;
    for(const row of rows){
      const date=parseImportDate(findImportField(row,'date'));
      const amount=parseImportAmount(findImportField(row,'amount'));
      const typeValue=String(findImportField(row,'type')||'').trim().toLowerCase();
      const categoryLabel=findImportField(row,'categ');
      const description=findImportField(row,'desc');
      if(!date||!Number.isFinite(amount)||amount===0){skipped++;continue;}
      const isIncome=typeValue?typeValue==='income':amount>0;
      let categoryId='income';
      if(!isIncome){
        const category=findOrCreateImportCategory(categoryLabel)||findOrCreateImportCategory('Imported');
        categoryId=category.id;
      }
      const parts=dateParts(date);
      DB.add(parts.year,parts.month-1,{
        amount:Math.abs(amount),
        description:String(description||'').trim()||(isIncome?'Income':getCatById(categoryId).label),
        category:categoryId,
        isIncome,
        date,
      });
      imported++;
    }
    renderSettings();
    if(activeTab==='home')renderHome();
    toast(`Imported ${imported} transaction${imported===1?'':'s'}${skipped?`, skipped ${skipped}`:''}`);
  }catch(error){
    showImportError(`Could not import this file. ${error.message}`);
  }finally{
    document.getElementById('importFileInput').value='';
  }
}
async function handleBackupImport(file){
  clearImportError();
  if(!file)return;
  try{
    const backup=JSON.parse(await file.text());
    validateFinanceBackup(backup);
    if(hasLocalFinanceData()&&!confirm('This will replace all existing data in this browser with the backup file. Continue?'))return;
    replaceLocalFinanceData(backupToLocalRecords(backup));
    localStorage.setItem(DRIVE_PENDING_KEY,'1');
    scheduleDriveSync();
    document.getElementById('monthLabel').textContent=`${MONTHS[mo]} ${yr}`;
    applyCurrency();
    renderSettingsSubtitles();
    refresh();
    toast('Backup imported ✓');
  }catch(error){
    showImportError(`Could not import this backup file. ${error.message}`);
  }finally{
    document.getElementById('importFileInput').value='';
  }
}
function handleImportFile(file){
  if(!file)return;
  const isJson=/\.json$/i.test(file.name)||file.type==='application/json';
  if(isJson)handleBackupImport(file);
  else handleSpreadsheetImport(file);
}

// ── APP LOCK ───────────────────────────────────────────────────────────────
// Face ID / Touch ID through a passkey kept on this device. There is no server to check the
// passkey's signature, so this hides the app from someone holding the phone; it doesn't encrypt the data.
const APP_LOCK_KEY='ft_app_lock_credential';
const APP_LOCK_AWAY_MS=60000;
let appLockSupported=false;
let appLockBusy=false;
let appLockHiddenAt=0;
function getAppLockCredential(){ try{ return localStorage.getItem(APP_LOCK_KEY)||''; }catch(e){ return ''; } }
function base64Url(bytes){ return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function fromBase64Url(text){ return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)); }
async function createAppLockPasskey(){
  const credential=await navigator.credentials.create({publicKey:{
    challenge:crypto.getRandomValues(new Uint8Array(32)),
    rp:{name:'Finance Tracker'},
    user:{id:crypto.getRandomValues(new Uint8Array(16)),name:'Finance Tracker',displayName:'Finance Tracker app lock'},
    pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
    authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'discouraged'},
    attestation:'none',timeout:60000,
  }});
  return base64Url(credential.rawId);
}
function askAppLockPasskey(){
  return navigator.credentials.get({publicKey:{
    challenge:crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials:[{type:'public-key',id:fromBase64Url(getAppLockCredential()),transports:['internal','hybrid']}],
    userVerification:'required',timeout:60000,
  }});
}
function showLockScreen(cover=false){
  const screen=document.getElementById('lockScreen');
  screen.hidden=false;
  screen.classList.toggle('cover',cover);
  if(!cover) document.getElementById('lockFailed').hidden=true;
}
// auto: asked by the app on open, not by a tap; Safari may refuse that, which isn't worth a message
async function unlockApp(auto=false){
  if(appLockBusy) return;
  appLockBusy=true;
  try{
    await askAppLockPasskey();
    document.getElementById('lockScreen').hidden=true;
  }catch(error){
    if(!auto) document.getElementById('lockFailed').hidden=false;
  }finally{ appLockBusy=false; }
}
async function initAppLock(){
  if(getAppLockCredential()){ showLockScreen(); unlockApp(true); }
  try{ appLockSupported=!!window.PublicKeyCredential&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }catch(e){}
  renderAppLock();
}
function renderAppLock(){
  const on=!!getAppLockCredential(),text=document.getElementById('appLockText'),button=document.getElementById('appLockButton');
  button.hidden=!on&&!appLockSupported;
  button.className=on?'export-btn':'save-btn';
  button.textContent=on?'Turn off app lock':'🔒 Turn on app lock';
  text.textContent=on?"On. The app asks for Face ID, Touch ID or your passcode when it opens and after a minute away. This hides the app from someone holding your phone; the data itself isn't encrypted."
    :appLockSupported?'Ask for Face ID, Touch ID or your device passcode before the app shows anything. This hides the app from someone holding your phone; your data stays in this browser unencrypted, as before.'
    :"This browser can't use Face ID or Touch ID. On iPhone, open the tracker in Safari or from its home-screen icon (iOS 16 or later).";
}
async function toggleAppLock(){
  if(appLockBusy) return;
  appLockBusy=true;
  const error=document.getElementById('appLockError');
  error.hidden=true;
  try{
    if(getAppLockCredential()){
      await askAppLockPasskey();
      localStorage.removeItem(APP_LOCK_KEY);
      toast('App lock off');
    }else{
      localStorage.setItem(APP_LOCK_KEY,await createAppLockPasskey());
      toast('App lock on ✓');
    }
  }catch(e){
    error.textContent=e?.name==='NotAllowedError'?'Cancelled, nothing changed.':`Couldn't change the app lock: ${e?.message||e}`;
    error.hidden=false;
  }finally{
    appLockBusy=false;
    renderAppLock();
    renderSettingsSubtitles();
  }
}
// cover the app as it goes to the background (the app switcher shows a snapshot), and
// ask again if it was away for a minute or more
document.addEventListener('visibilitychange',()=>{
  if(!getAppLockCredential()) return;
  const screen=document.getElementById('lockScreen');
  if(document.hidden){
    if(screen.hidden){ appLockHiddenAt=Date.now(); showLockScreen(true); }
  }else if(screen.classList.contains('cover')){
    if(Date.now()-appLockHiddenAt<APP_LOCK_AWAY_MS){ screen.hidden=true; screen.classList.remove('cover'); }
    else{ showLockScreen(); unlockApp(true); }
  }
});

// ── TOAST ──────────────────────────────────────────────────────────────────
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2000);
}
