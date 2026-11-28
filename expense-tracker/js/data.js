// ── DEFAULT CATEGORIES ──────────────────────────────────────────────────────
const DEFAULT_CATS = [
  { id:'rent',         label:'Rent',           color:'#2563EB', emoji:'🏠' },
  { id:'groceries',    label:'Groceries',       color:'#16A34A', emoji:'🛒' },
  { id:'transport',    label:'Transport',       color:'#F59E0B', emoji:'🚌' },
  { id:'shopping',     label:'Shopping',        color:'#EC4899', emoji:'🛍️' },
  { id:'travel',       label:'Travel & Rest.',  color:'#F97316', emoji:'🍽️' },
  { id:'subscription', label:'Subscription',    color:'#8B5CF6', emoji:'📱' },
  { id:'emergency',    label:'Emergency',       color:'#EF4444', emoji:'🚨' },
];
// Built-in list before Emergency replaced Turin. Devices that already have entries but never
// saved their own categories keep this list, so the change only affects new installs.
const PREVIOUS_DEFAULT_CATS = [
  ...DEFAULT_CATS.slice(0,-1),
  { id:'turin',        label:'Turin',           color:'#EF4444', emoji:'🇮🇹' },
];

const COLOR_PRESETS = ['#2563EB','#16A34A','#F59E0B','#EC4899','#F97316','#8B5CF6','#EF4444','#14B8A6','#64748B','#22C55E','#A855F7','#0EA5E9'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const RECURRING_RULES_KEY = 'ft_recurring_rules';
function localDateString(date=new Date()){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// ── STATE ──────────────────────────────────────────────────────────────────
let yr = new Date().getFullYear();
let mo = new Date().getMonth();
let selCat = null;
let entryType = 'expense';
let activeTab = 'home';
let editingCatId = null;
let pickedColor = '#1D6FA5';
let trendChart = null;
let categoryChart = null;
let editingEntryId = null;
let editingEntryYear = null;
let editingEntryMonth = null;
const DRIVE_CLIENT_ID_KEY='ft_drive_client_id';
const DRIVE_ENABLED_KEY='ft_drive_enabled';
const DRIVE_SYNC_STATE_KEY='ft_drive_sync_state';
const DRIVE_PENDING_KEY='ft_drive_sync_pending';
const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
const DRIVE_BACKUP_FOLDER='Finance Tracker Backups';
const DRIVE_BACKUP_FILENAME='Finance Tracker Backup.json';
// Public OAuth client ID (not a secret; safe to ship client-side). Leave blank to fall back to manual entry.
const DRIVE_OAUTH_CLIENT_ID='334764309824-4tj1bsr3fe1pdb60ici9la3hibvmhpih.apps.googleusercontent.com';
let driveAccessToken=null;
let driveTokenClient=null;
let driveTokenExpiresAt=0;
let driveSyncTimer=null;
let driveAuthPending=false;
let driveSyncRunning=false;
let driveSyncQueued=false;   // a change was saved while a sync was uploading
let driveLastProblem=null;   // why the last sync failed, kept until a sync succeeds
let driveConflictMetadata=null;
let driveSilentReconnect=false;
let driveClientId=DRIVE_OAUTH_CLIENT_ID||localStorage.getItem(DRIVE_CLIENT_ID_KEY)||'';
let driveGoogleScriptPromise=null;

// ── CATEGORY STORAGE ───────────────────────────────────────────────────────
function getCats(){
  try{ return JSON.parse(localStorage.getItem('ft_cats')||'null') || DEFAULT_CATS; }
  catch(e){ return DEFAULT_CATS; }
}
function keepPreviousDefaultCats(){
  if(localStorage.getItem('ft_cats')) return;
  const hasEntries=Object.keys(localStorage).some(key=>/^ft_\d{4}_(0[1-9]|1[0-2])$/.test(key)&&localStorage.getItem(key)!=='[]');
  if(hasEntries) localStorage.setItem('ft_cats',JSON.stringify(PREVIOUS_DEFAULT_CATS));
}
keepPreviousDefaultCats();
function saveCats(cats){ saveLocalFinanceData('ft_cats', JSON.stringify(cats)); }
function getCatById(id){ return getCats().find(c=>c.id===id)||{label:'?',color:'#888',emoji:'❓'}; }
function saveLocalFinanceData(key,value){
  localStorage.setItem(key,value);
  localStorage.setItem(DRIVE_PENDING_KEY,'1');
  scheduleDriveSync();
}

// ── ENTRY STORAGE ──────────────────────────────────────────────────────────
const DB = {
  key(y,m){ return `ft_${y}_${String(m+1).padStart(2,'0')}`; },
  get(y,m){ try{ return JSON.parse(localStorage.getItem(this.key(y,m))||'[]'); }catch(e){ return []; } },
  save(y,m,d){ saveLocalFinanceData(this.key(y,m), JSON.stringify(d)); },
  add(y,m,e){
    const data=this.get(y,m);
    e.id=Date.now().toString(36)+Math.random().toString(36).slice(2);
    e.amount=money(e.amount);
    data.push(e); this.save(y,m,data);
  },
  update(fromY,fromM,toY,toM,id,changes){
    const source=this.get(fromY,fromM);
    const index=source.findIndex(entry=>entry.id===id);
    if(index<0) return false;
    const updated={...source[index],...changes,id};
    updated.amount=money(updated.amount);
    if(this.key(fromY,fromM)===this.key(toY,toM)){
      source[index]=updated;
      this.save(fromY,fromM,source);
      return true;
    }
    const destination=this.get(toY,toM).filter(entry=>entry.id!==id);
    destination.push(updated);
    this.save(toY,toM,destination);
    this.save(fromY,fromM,source.filter(entry=>entry.id!==id));
    return true;
  },
  del(y,m,id){
    const entries=this.get(y,m);
    const entry=entries.find(item=>item.id===id);
    if(entry?.recurringRuleId&&entry.recurringOccurrence){
      const rules=getRecurringRules();
      const rule=rules.find(item=>item.id===entry.recurringRuleId);
      if(rule){
        rule.skippedDates=Array.isArray(rule.skippedDates)?rule.skippedDates:[];
      }
      if(rule&&!rule.skippedDates.includes(entry.recurringOccurrence)){
        rule.skippedDates.push(entry.recurringOccurrence);
        saveRecurringRules(rules);
      }
    }
    this.save(y,m,entries.filter(e=>e.id!==id));
  }
};

function getRecurringRules(){
  try{return JSON.parse(localStorage.getItem(RECURRING_RULES_KEY)||'[]').filter(rule=>rule&&typeof rule==='object');}
  catch(e){return [];}
}
function saveRecurringRules(rules){saveLocalFinanceData(RECURRING_RULES_KEY,JSON.stringify(rules));}
