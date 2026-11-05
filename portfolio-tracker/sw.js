// Keeps the app usable offline (#157), like the expense tracker's. The page, news.json and
// prices.json are fetched fresh when online (the saved copy is used after 3 s or with no
// signal); the versioned libraries are served from the cache. Google sign-in and Drive
// requests are never cached.
const CACHE='portfolio-tracker-v1';
const PAGE=['./','./index.html','./apple-touch-icon.png','./icon.svg','./manifest.webmanifest','./news.json','./prices.json'];
const LIBS=[
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([...PAGE,...LIBS])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith('portfolio-tracker-')&&key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim()));
});

// The page asks for news.json/prices.json with cache:'no-store'; the saved copy is keyed
// without the query string so it is found whatever the request looked like.
function cacheKey(request){
  if(request.mode==='navigate')return './index.html';
  const url=new URL(request.url); url.search='';
  return url.href;
}
async function freshFromNetwork(request){
  const cache=await caches.open(CACHE);
  const network=fetch(request).then(response=>{
    if(response.ok)cache.put(cacheKey(request),response.clone());
    return response;
  });
  const timeout=new Promise(resolve=>setTimeout(resolve,3000));
  const response=await Promise.race([network.catch(()=>null),timeout]);
  if(response)return response;
  const cached=await cache.match(cacheKey(request),{ignoreSearch:true});
  return cached||network;
}
async function libFromCache(request){
  const cached=await caches.match(request);
  if(cached)return cached;
  const response=await fetch(request);
  if(response.ok||response.type==='opaque')(await caches.open(CACHE)).put(request,response.clone());
  return response;
}

self.addEventListener('fetch',event=>{
  const {request}=event;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.hostname==='cdnjs.cloudflare.com')event.respondWith(libFromCache(request));
  else if(url.origin===self.location.origin&&url.pathname.startsWith(new URL('./',self.location).pathname))event.respondWith(freshFromNetwork(request));
});
