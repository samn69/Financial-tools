function getDriveSyncState(){
  try{return JSON.parse(localStorage.getItem(DRIVE_SYNC_STATE_KEY)||'{}')||{};}
  catch(e){return {};}
}
function saveDriveSyncState(state){localStorage.setItem(DRIVE_SYNC_STATE_KEY,JSON.stringify(state));}
function setDriveStatus(message,state=''){
  const text=document.getElementById('driveStatusText');
  const dot=document.getElementById('driveStatusDot');
  const headerDot=document.getElementById('driveHeaderDot');
  if(text)text.textContent=message;
  if(dot)dot.className=`drive-status-dot${state?` ${state}`:''}`;
  if(headerDot){
    headerDot.className=`drive-header-dot${state?` ${state}`:''}`;
    headerDot.title=`Google Drive: ${message}`;
  }
}
function goToDriveSettings(){
  switchTab('settings');
  openSettingsSection(document.getElementById('driveStatusText'));
  document.getElementById('driveStatusText')?.scrollIntoView({behavior:'smooth',block:'center'});
}
function renderDriveStatus(message=null,state=''){
  const input=document.getElementById('driveClientId');
  if(input&&document.activeElement!==input)input.value=driveClientId;
  const syncState=getDriveSyncState();
  const pending=localStorage.getItem(DRIVE_PENDING_KEY)==='1';
  // show what is really holding the backup back, not a generic "pending"
  let defaultMessage,defaultState;
  if(driveConflictMetadata){defaultMessage='Drive and this device have different data. Choose which copy to keep below.';defaultState='pending';}
  else if(driveSyncRunning){defaultMessage='Syncing backup…';defaultState='pending';}
  else if(driveLastProblem&&pending){defaultMessage=driveLastProblem;defaultState='error';}
  else if(driveAccessToken){defaultMessage=pending?'Changes not backed up yet. Tap Sync backup now.':'Google Drive connected';defaultState=pending?'pending':'connected';}
  else{
    defaultMessage=localStorage.getItem(DRIVE_ENABLED_KEY)==='1'?(pending?'Changes not backed up yet. Tap Sync backup now to reconnect.':'Drive linked. Reconnect to sync this session.'):driveClientId?'Not connected. Click Connect Google Drive to back up your data.':'Local only. Add a Google OAuth client ID to connect Drive.';
    defaultState=pending?'pending':'';
  }
  setDriveStatus(message||defaultMessage,state||defaultState);
  const link=document.getElementById('driveBackupLink');
  if(link){
    link.hidden=!syncState.webViewLink;
    if(syncState.webViewLink)link.href=syncState.webViewLink;
  }
  renderLastBackup();
}
function renderLastBackup(){
  const last=getDriveSyncState().lastSyncAt,el=document.getElementById('driveLastSync');
  if(el)el.textContent=last?`Last backup: ${backupAgo(last)} (${new Date(last).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})})`:'';
  renderSettingsSubtitles();
}
// "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago"
function backupAgo(iso){
  const min=Math.floor((Date.now()-new Date(iso).getTime())/60000);
  if(min<1) return 'just now';
  if(min<60) return `${min} min ago`;
  if(min<24*60) return `${Math.floor(min/60)} h ago`;
  const days=Math.floor(min/(24*60));
  return days===1?'yesterday':`${days} days ago`;
}
setInterval(()=>{ if(activeTab==='settings') renderLastBackup(); },60000);
function loadGoogleIdentity(){
  if(window.google?.accounts?.oauth2)return Promise.resolve();
  if(!driveGoogleScriptPromise){
    driveGoogleScriptPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://accounts.google.com/gsi/client';
      script.async=true;
      script.defer=true;
      script.onload=()=>resolve();
      script.onerror=()=>reject(new Error('Google Identity Services could not be loaded.'));
      document.head.append(script);
    });
  }
  return driveGoogleScriptPromise;
}
async function initializeDriveTokenClient(){
  if(!driveClientId)throw new Error('Save your Google OAuth web client ID first.');
  await loadGoogleIdentity();
  if(driveTokenClient)return;
  driveTokenClient=google.accounts.oauth2.initTokenClient({
    client_id:driveClientId,
    scope:DRIVE_SCOPE,
    callback:handleDriveTokenResponse,
    error_callback:error=>{
      driveAuthPending=false;
      if(driveSilentReconnect){driveSilentReconnect=false;renderDriveStatus();return;}
      setDriveStatus(error.message||'Google authorization was closed. Local data is safe; reconnect to sync.','error');
    },
  });
}
function requestDriveAccess(prompt=''){
  if(!driveTokenClient){
    setDriveStatus('Google authorization is still loading. Try Connect Google Drive again.','pending');
    return;
  }
  if(driveAuthPending)return;
  driveAuthPending=true;
  try{driveTokenClient.requestAccessToken({prompt});}
  catch(error){
    driveAuthPending=false;
    setDriveStatus(error.message||'Could not open Google authorization.','error');
  }
}
function saveDriveClientId(){
  const value=document.getElementById('driveClientId').value.trim();
  if(!value.endsWith('.apps.googleusercontent.com')){
    setDriveStatus('Enter a valid Google OAuth web client ID ending in .apps.googleusercontent.com.','error');
    document.getElementById('driveClientId').focus();
    return;
  }
  if(value!==driveClientId){
    driveAccessToken=null;
    driveTokenExpiresAt=0;
    localStorage.removeItem(DRIVE_ENABLED_KEY);
  }
  driveClientId=value;
  localStorage.setItem(DRIVE_CLIENT_ID_KEY,value);
  driveTokenClient=null;
  driveGoogleScriptPromise=null;
  initializeDriveTokenClient().then(()=>setDriveStatus('Client ID saved. Connect Google Drive to authorize the visible backup.')).catch(error=>setDriveStatus(error.message,'error'));
}
function connectGoogleDrive(){
  if(!driveClientId){
    setDriveStatus('Save your Google OAuth web client ID first.','error');
    document.getElementById('driveClientId').focus();
    return;
  }
  if(!driveTokenClient){
    initializeDriveTokenClient().then(()=>setDriveStatus('Google authorization is ready. Press Connect Google Drive again.')).catch(error=>setDriveStatus(error.message,'error'));
    return;
  }
  requestDriveAccess('select_account');
}
function handleDriveTokenResponse(response){
  driveAuthPending=false;
  driveSilentReconnect=false;
  if(!response||response.error||!response.access_token){
    setDriveStatus(response?.error_description||response?.error||'Google authorization did not return an access token.','error');
    return;
  }
  if(!google.accounts.oauth2.hasGrantedAllScopes(response,DRIVE_SCOPE)){
    setDriveStatus('Drive file access was not granted. Your local data is unchanged.','error');
    return;
  }
  driveAccessToken=response.access_token;
  driveTokenExpiresAt=Date.now()+(Number(response.expires_in)||3600)*1000;
  localStorage.setItem(DRIVE_ENABLED_KEY,'1');
  setDriveStatus('Checking your visible Drive backup…','pending');
  connectToDriveAfterAuthorization().catch(error=>{
    driveLastProblem=`Drive backup failed. ${error.message}`;
    setDriveStatus(driveLastProblem,'error');
  });
}
// a request Google never answers would otherwise leave the sync stuck until the app is restarted
const DRIVE_TIMEOUT_MS=60000;
async function driveFetch(url,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),DRIVE_TIMEOUT_MS);
  try{return await fetch(url,{...options,signal:controller.signal});}
  catch(error){
    if(error.name==='AbortError')throw new Error('Google Drive did not respond. Check your connection and tap Sync backup now.');
    throw new Error('Could not reach Google Drive. Check your connection and tap Sync backup now.');
  }finally{clearTimeout(timer);}
}
function driveApiUrl(path){return path.startsWith('http')?path:`https://www.googleapis.com/drive/v3${path}`;}
async function driveApiRequest(path,options={}){
  if(!driveAccessToken)throw new Error('Connect Google Drive to continue syncing.');
  if(driveTokenExpiresAt&&Date.now()>driveTokenExpiresAt-30000){
    driveAccessToken=null;
    throw new Error('Google access expired. Your data is saved locally; use Sync backup now to reconnect.');
  }
  const headers={Authorization:`Bearer ${driveAccessToken}`,...(options.headers||{})};
  const response=await driveFetch(driveApiUrl(path),{...options,headers});
  const body=await response.json().catch(()=>null);
  if(response.status===401){
    driveAccessToken=null;
    throw new Error('Google access expired. Your data is saved locally; use Sync backup now to reconnect.');
  }
  if(!response.ok)throw new Error(body?.error?.message||`Google Drive request failed (${response.status}).`);
  return body||{};
}
async function findDriveFile(name,parentId=null,mimeType=null){
  const clauses=[`name = '${name.replace(/'/g,"\\'")}'`,'trashed = false'];
  if(parentId)clauses.push(`'${parentId}' in parents`);
  if(mimeType)clauses.push(`mimeType = '${mimeType}'`);
  const query=new URLSearchParams({q:clauses.join(' and '),spaces:'drive',pageSize:'100',orderBy:'modifiedTime desc',fields:'files(id,name,mimeType,modifiedTime,webViewLink,parents)'});
  const result=await driveApiRequest(`/files?${query}`);
  return result.files?.[0]||null;
}
function hasLocalFinanceData(){
  return Object.keys(localStorage).some(key=>/^ft_\d{4}_(0[1-9]|1[0-2])$/.test(key)&&DB.get(Number(key.slice(3,7)),Number(key.slice(8,10))-1).length>0)
    ||JSON.stringify(getCats())!==JSON.stringify(DEFAULT_CATS)
    ||getRecurringRules().length>0
    ||Object.keys(getGoalTags()).length>0;
}
function validateFinanceBackup(backup){
  if(!backup||backup.format!=='finance-tracker-backup'||backup.version!==1||!backup.data||typeof backup.data!=='object')throw new Error('This is not a supported Finance Tracker backup.');
  const {months,categories,recurringRules}=backup.data;
  if(!months||typeof months!=='object'||Array.isArray(months)||!Array.isArray(categories)||!Array.isArray(recurringRules))throw new Error('The backup is missing transactions, categories, or recurring schedules.');
  if(categories.some(category=>!category||typeof category.id!=='string'||typeof category.label!=='string'||typeof category.emoji!=='string'||!/^#[0-9a-f]{6}$/i.test(category.color||'')))throw new Error('The backup contains an invalid category.');
  for(const [key,entries] of Object.entries(months)){
    const match=/^ft_(\d{4})_(0[1-9]|1[0-2])$/.exec(key);
    if(!match||!Array.isArray(entries))throw new Error('The backup contains an invalid transaction month.');
    for(const entry of entries){
      const date=dateParts(entry?.date||'');
      if(!entry||typeof entry.id!=='string'||!Number.isFinite(entry.amount)||entry.amount<=0||typeof entry.isIncome!=='boolean'||typeof entry.category!=='string'||!date||date.year!==Number(match[1])||date.month!==Number(match[2])||entry.description!==undefined&&typeof entry.description!=='string')throw new Error(`The backup contains an invalid transaction in ${key}.`);
    }
  }
  const isPlainObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
  // goal settings were added later, so older backups simply don't have them
  if(backup.data.goalTags!==undefined&&(!isPlainObject(backup.data.goalTags)||Object.values(backup.data.goalTags).some(g=>!['essentials','rewards','emergency'].includes(g))))throw new Error('The backup contains invalid goal groups.');
  if(backup.data.goalOverrides!==undefined&&(!isPlainObject(backup.data.goalOverrides)||Object.values(backup.data.goalOverrides).some(m=>!isPlainObject(m)||Object.values(m).some(v=>!Number.isFinite(v)||v<0))))throw new Error('The backup contains invalid goal amounts.');
  // the currency was added later too; a backup without it leaves the device's choice alone
  if(backup.data.currency!==undefined&&!CURRENCIES[backup.data.currency])throw new Error('The backup contains an unknown currency.');
  const plan=backup.data.goalPlan;
  if(plan!==undefined&&(!isPlainObject(plan)||plan.fund!=null&&!validGoalFund(plan.fund)))throw new Error('The backup contains an invalid goal plan.');
  for(const rule of recurringRules){
    if(!rule||typeof rule.id!=='string'||!Number.isFinite(rule.amount)||rule.amount<=0||typeof rule.isIncome!=='boolean'||!['weekly','monthly','yearly'].includes(rule.frequency)||!dateParts(rule.startDate)||rule.endDate&&!dateParts(rule.endDate)||typeof rule.active!=='boolean')throw new Error('The backup contains an invalid recurring schedule.');
  }
  return backup;
}
function backupToLocalRecords(backup){
  validateFinanceBackup(backup);
  const records={'ft_cats':JSON.stringify(backup.data.categories),[RECURRING_RULES_KEY]:JSON.stringify(backup.data.recurringRules),[GOAL_TAGS_KEY]:JSON.stringify(backup.data.goalTags||{}),[GOAL_OVERRIDES_KEY]:JSON.stringify(backup.data.goalOverrides||{})};
  if(backup.data.goalPlan)records[GOAL_PLAN_KEY]=JSON.stringify(backup.data.goalPlan.fund?{fund:backup.data.goalPlan.fund}:{});
  if(backup.data.currency)records[CURRENCY_KEY]=backup.data.currency;
  for(const [key,entries] of Object.entries(backup.data.months))records[key]=JSON.stringify(entries);
  return records;
}
async function readDriveBackup(fileId){
  if(!driveAccessToken)throw new Error('Connect Google Drive before restoring a backup.');
  const response=await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,{headers:{Authorization:`Bearer ${driveAccessToken}`}});
  if(response.status===401){driveAccessToken=null;throw new Error('Google access expired. Reconnect to restore the backup.');}
  if(!response.ok)throw new Error(`Could not download the Drive backup (${response.status}).`);
  const backup=await response.json();
  validateFinanceBackup(backup);
  return backup;
}
function replaceLocalFinanceData(records){
  const financeKey=/^ft_\d{4}_(0[1-9]|1[0-2])$/;
  // the currency is replaced only when the backup has one (older backups don't)
  const replaced=key=>financeKey.test(key)||key==='ft_cats'||key===RECURRING_RULES_KEY||key===GOAL_TAGS_KEY||key===GOAL_OVERRIDES_KEY||key===GOAL_PLAN_KEY||key===CURRENCY_KEY&&CURRENCY_KEY in records;
  const currentKeys=Object.keys(localStorage).filter(replaced);
  const previous=Object.fromEntries(currentKeys.map(key=>[key,localStorage.getItem(key)]));
  try{
    currentKeys.forEach(key=>localStorage.removeItem(key));
    Object.entries(records).forEach(([key,value])=>localStorage.setItem(key,value));
  }catch(error){
    Object.keys(localStorage).filter(replaced).forEach(key=>localStorage.removeItem(key));
    Object.entries(previous).forEach(([key,value])=>localStorage.setItem(key,value));
    throw error;
  }
}
async function findOrCreateDriveFolder(){
  const existing=await findDriveFile(DRIVE_BACKUP_FOLDER,null,'application/vnd.google-apps.folder');
  if(existing)return existing;
  return driveApiRequest('/files?fields=id,name,mimeType,webViewLink',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:DRIVE_BACKUP_FOLDER,mimeType:'application/vnd.google-apps.folder'})});
}
function buildFinanceBackup(){
  const months={};
  for(const key of Object.keys(localStorage).filter(item=>/^ft_\d{4}_(0[1-9]|1[0-2])$/.test(item)).sort()){
    const entries=JSON.parse(localStorage.getItem(key)||'[]');
    if(!Array.isArray(entries))throw new Error(`Local transaction data for ${key} is invalid and was not backed up.`);
    months[key]=entries;
  }
  return {format:'finance-tracker-backup',version:1,createdAt:new Date().toISOString(),data:{months,categories:getCats(),recurringRules:getRecurringRules(),goalTags:getGoalTags(),goalOverrides:getGoalOverrides(),goalPlan:getGoalPlan(),currency:currencyCode()}};
}
async function createVisibleDriveBackup(name,folderId,backup){
  const boundary=`finance_backup_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata={name,mimeType:'application/json',parents:[folderId],appProperties:{application:'finance-tracker',kind:'finance-backup'}};
  const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(backup)}\r\n--${boundary}--`;
  return driveApiRequest(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink`,{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
}
async function createDailyDriveSnapshot(file,folderId,state,preserveConflict=false){
  const today=localDateString();
  if(state.lastSnapshotDate===today&&!preserveConflict)return state;
  const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
  const name=preserveConflict?`Finance Tracker Backup - ${timestamp} - conflict.json`:`Finance Tracker Backup - ${today}.json`;
  const existing=await findDriveFile(name,folderId);
  if(!existing)await driveApiRequest(`/files/${encodeURIComponent(file.id)}/copy?fields=id,name,mimeType,modifiedTime,webViewLink`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parents:[folderId]})});
  return {...state,lastSnapshotDate:today};
}
function showDriveConflict(folderId,file){
  driveConflictMetadata={folderId,file};
  const panel=document.getElementById('driveConflict');
  if(panel){panel.hidden=false;openSettingsSection(panel);}
  const message=document.getElementById('driveConflictText');
  if(message)message.textContent=hasLocalFinanceData()?'A Drive backup and local data both exist. Choose which copy to keep; neither will be silently overwritten.':'A Drive backup was found. Restore it to this browser or replace it with this browser’s data.';
  const link=document.getElementById('driveBackupLink');
  if(link){link.href=file.webViewLink||`https://drive.google.com/file/d/${file.id}/view`;link.hidden=false;}
  setDriveStatus('Choose whether to restore Drive data or use this browser’s data.','pending');
}
function hideDriveConflict(){driveConflictMetadata=null;const panel=document.getElementById('driveConflict');if(panel)panel.hidden=true;}
async function connectToDriveAfterAuthorization(){
  const folder=await findOrCreateDriveFolder();
  const remote=await findDriveFile(DRIVE_BACKUP_FILENAME,folder.id);
  const state=getDriveSyncState();
  if(!remote){
    hideDriveConflict();
    saveDriveSyncState({...state,folderId:folder.id});
    if(hasLocalFinanceData())await syncDriveBackup(true);
    else setDriveStatus('Connected. Your first saved change will create the Drive backup.','connected');
    return;
  }
  if(state.fileId===remote.id&&state.modifiedTime===remote.modifiedTime){
    hideDriveConflict();
    saveDriveSyncState({...state,folderId:folder.id,webViewLink:remote.webViewLink||state.webViewLink});
    setDriveStatus(localStorage.getItem(DRIVE_PENDING_KEY)==='1'?'Backup sync pending…':'Google Drive connected','connected');
    if(localStorage.getItem(DRIVE_PENDING_KEY)==='1')scheduleDriveSync();
    return;
  }
  showDriveConflict(folder.id,remote);
}
function scheduleDriveSync(){
  if(!driveClientId||localStorage.getItem(DRIVE_ENABLED_KEY)!=='1'){
    if(document.getElementById('driveStatusText'))renderDriveStatus();
    return;
  }
  if(!navigator.onLine){setDriveStatus('Saved locally. Drive sync is pending until you are online.','pending');return;}
  if(!driveAccessToken){
    setDriveStatus('Saved locally. Reconnect to Google Drive to sync this change.','pending');
    if(driveTokenClient&&!driveAuthPending&&navigator.userActivation?.isActive)requestDriveAccess('');
    return;
  }
  clearTimeout(driveSyncTimer);
  setDriveStatus('Saved locally. Syncing backup…','pending');
  driveSyncTimer=setTimeout(()=>syncDriveBackup(false),700);
}
async function syncDriveBackup(force=false,preserveConflict=false){
  if(driveSyncRunning){driveSyncQueued=true;return;}
  if(!driveAccessToken){setDriveStatus('Your data is safe locally. Connect Google Drive to sync.','pending');return;}
  if(driveConflictMetadata&&!force){setDriveStatus('Resolve the Drive/local data choice before syncing.','pending');return;}
  driveSyncRunning=true;
  try{
    const folder=await findOrCreateDriveFolder();
    const remote=await findDriveFile(DRIVE_BACKUP_FILENAME,folder.id);
    let state=getDriveSyncState();
    if(remote&&!force&&(state.fileId!==remote.id||state.modifiedTime!==remote.modifiedTime)){
      showDriveConflict(folder.id,remote);
      return;
    }
    const backup=buildFinanceBackup();
    let savedFile;
    if(remote){
      state=await createDailyDriveSnapshot(remote,folder.id,state,preserveConflict);
      savedFile=await driveApiRequest(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(remote.id)}?uploadType=media&fields=id,name,mimeType,modifiedTime,webViewLink`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(backup)});
    }else savedFile=await createVisibleDriveBackup(DRIVE_BACKUP_FILENAME,folder.id,backup);
    saveDriveSyncState({...state,fileId:savedFile.id,folderId:folder.id,modifiedTime:savedFile.modifiedTime,webViewLink:savedFile.webViewLink||remote?.webViewLink||'',lastSyncAt:new Date().toISOString()});
    driveLastProblem=null;
    hideDriveConflict();
    // a change saved during the upload isn't in this backup, so it stays pending
    if(!driveSyncQueued){
      localStorage.removeItem(DRIVE_PENDING_KEY);
      renderDriveStatus('Drive backup is up to date.','connected');
    }
  }catch(error){
    localStorage.setItem(DRIVE_PENDING_KEY,'1');
    driveLastProblem=`Saved on this device; Drive backup failed. ${error.message}`;
    setDriveStatus(driveLastProblem,'error');
  }finally{
    driveSyncRunning=false;
    if(driveSyncQueued){driveSyncQueued=false;scheduleDriveSync();}
  }
}
async function restoreDriveBackup(){
  if(!driveConflictMetadata)return;
  const {folderId,file}=driveConflictMetadata;
  try{
    setDriveStatus('Downloading and validating Drive backup…','pending');
    const backup=await readDriveBackup(file.id);
    const records=backupToLocalRecords(backup);
    if(hasLocalFinanceData()){
      const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
      await createVisibleDriveBackup(`Finance Tracker Browser Recovery ${timestamp}.json`,folderId,buildFinanceBackup());
    }
    replaceLocalFinanceData(records);
    saveDriveSyncState({...getDriveSyncState(),fileId:file.id,folderId,modifiedTime:file.modifiedTime,webViewLink:file.webViewLink||'',lastSyncAt:new Date().toISOString()});
    localStorage.removeItem(DRIVE_PENDING_KEY);
    driveLastProblem=null;
    hideDriveConflict();
    document.getElementById('monthLabel').textContent=`${MONTHS[mo]} ${yr}`;
    applyCurrency();
    renderSettingsSubtitles();
    refresh();
    renderDriveStatus('Drive backup restored.','connected');
  }catch(error){setDriveStatus(`Restore cancelled; local data is unchanged. ${error.message}`,'error');}
}
function uploadLocalOverDrive(){
  if(!driveConflictMetadata)return;
  const preserveConflict=true;
  hideDriveConflict();
  localStorage.setItem(DRIVE_PENDING_KEY,'1');
  syncDriveBackup(true,preserveConflict);
}
function syncDriveNow(){
  if(!driveClientId){setDriveStatus('Save your Google OAuth web client ID first.','error');return;}
  if(!driveTokenClient){initializeDriveTokenClient().then(()=>setDriveStatus('Authorization is ready. Press Sync backup now again.')).catch(error=>setDriveStatus(error.message,'error'));return;}
  if(!driveAccessToken){requestDriveAccess(localStorage.getItem(DRIVE_ENABLED_KEY)==='1'?'':'select_account');return;}
  if(driveSyncRunning){setDriveStatus('Syncing backup…','pending');return;}
  if(driveConflictMetadata){showDriveConflict(driveConflictMetadata.folderId,driveConflictMetadata.file);return;}
  setDriveStatus('Syncing backup…','pending');
  syncDriveBackup(false);
}
function disconnectGoogleDrive(){
  const token=driveAccessToken;
  driveAccessToken=null;
  driveTokenExpiresAt=0;
  localStorage.removeItem(DRIVE_ENABLED_KEY);
  hideDriveConflict();
  if(token&&window.google?.accounts?.oauth2)google.accounts.oauth2.revoke(token,()=>{});
  renderDriveStatus('Disconnected. Your local data and Drive backup are unchanged.');
}
function initDriveBackup(){
  driveClientId=DRIVE_OAUTH_CLIENT_ID||localStorage.getItem(DRIVE_CLIENT_ID_KEY)||'';
  const input=document.getElementById('driveClientId');
  if(input)input.value=driveClientId;
  if(DRIVE_OAUTH_CLIENT_ID){
    const section=document.getElementById('driveClientIdSection');
    if(section)section.hidden=true;
  }
  renderDriveStatus();
  window.addEventListener('online',()=>{
    if(localStorage.getItem(DRIVE_PENDING_KEY)==='1')scheduleDriveSync();
  });
  if(driveClientId){
    initializeDriveTokenClient().then(()=>{
      if(localStorage.getItem(DRIVE_ENABLED_KEY)==='1'){
        driveSilentReconnect=true;
        requestDriveAccess('none');
      }
    }).catch(error=>setDriveStatus(error.message,'error'));
  }
}
