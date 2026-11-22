// ── INIT ───────────────────────────────────────────────────────────────────
initAppLock();
applyCurrency();
document.getElementById('monthLabel').textContent=`${MONTHS[mo]} ${yr}`;
document.getElementById('dateInput').value=localDateString();
resetEntryForm();
initSwipeRows();
initMonthSwipe();
initSettingsSections();
renderHome();
initDriveBackup();
// works offline: sw.js keeps the page and its libraries on the device
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')) navigator.serviceWorker.register('sw.js').catch(()=>{});
document.getElementById('splash').addEventListener('animationend',e=>{ if(e.animationName==='splash-out') e.currentTarget.remove(); });
