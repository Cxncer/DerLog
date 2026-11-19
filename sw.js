/* DerLog offline shell. Caches the app and its libraries after the first visit. */
const VERSION='derlog-v12';
const CORE=[
  "./DerLog-v19.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone/babel.min.js",
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://fonts.cdnfonts.com/css/neue-montreal",
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Kantumruy+Pro:wght@400;500;600;700&display=swap"
];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(VERSION);
    await Promise.all(CORE.map(async url=>{
      try{
        const request=new Request(url,{mode:url.startsWith(self.location.origin)?'same-origin':'no-cors',cache:'reload'});
        const response=await fetch(request);
        if(response)await cache.put(request,response);
      }catch(err){}
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==VERSION).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  /* Photo results come from the local Pinterest service; never cache them. */
  if(url.port==='3211'&&(url.hostname==='127.0.0.1'||url.hostname==='localhost'))return;
  if(/(^|.)(photon.komoot.io|overpass-api.de|overpass.kumi.systems|overpass.private.coffee|commons.wikimedia.org|api.openverse.org|en.wikipedia.org|accounts.google.com)$/.test(url.hostname))return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{const fresh=await fetch(request);const cache=await caches.open(VERSION);cache.put('./DerLog-v19.html',fresh.clone());return fresh}
      catch(err){const cache=await caches.open(VERSION);return (await cache.match('./DerLog-v19.html'))||(await cache.match(request))||Response.error()}
    })());
    return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(VERSION);
    const hit=await cache.match(request);
    if(hit)return hit;
    try{
      const fresh=await fetch(request);
      if(fresh&&(fresh.ok||fresh.type==='opaque'))cache.put(request,fresh.clone());
      return fresh;
    }catch(err){return Response.error()}
  })());
});
