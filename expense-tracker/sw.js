// Keeps the app usable offline. The page is fetched fresh when online (falls back to the
// saved copy after 3 s or with no signal); the versioned libraries are served from the cache.
// Google sign-in and Drive requests are never cached.
const CACHE='expense-tracker-v1';
const PAGE=['./','./index.html','./apple-touch-icon.png'];
const LIBS=[
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([...PAGE,...LIBS])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith('expense-tracker-')&&key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim()));
});

async function pageFirstFromNetwork(request){
  const cache=await caches.open(CACHE);
  const network=fetch(request).then(response=>{
    if(response.ok) cache.put(request.mode==='navigate'?'./index.html':request,response.clone());
    return response;
  });
  const timeout=new Promise(resolve=>setTimeout(resolve,3000));
  const response=await Promise.race([network.catch(()=>null),timeout]);
  if(response) return response;
  const cached=await cache.match(request.mode==='navigate'?'./index.html':request,{ignoreSearch:true});
  return cached||network;
}
async function libFromCache(request){
  const cached=await caches.match(request);
  if(cached) return cached;
  const response=await fetch(request);
  if(response.ok||response.type==='opaque') (await caches.open(CACHE)).put(request,response.clone());
  return response;
}

self.addEventListener('fetch',event=>{
  const {request}=event;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  if(url.hostname==='cdnjs.cloudflare.com') event.respondWith(libFromCache(request));
  else if(url.origin===self.location.origin&&url.pathname.startsWith(new URL('./',self.location).pathname)) event.respondWith(pageFirstFromNetwork(request));
});
