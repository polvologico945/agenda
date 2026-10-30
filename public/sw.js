const CACHE='agenda-cnh-shell-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/', '/favicon.svg','/icon-192.png'])));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',event=>{const req=event.request;const url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.search||url.pathname.startsWith('/verificar')||url.pathname.startsWith('/redefinir')||!['document','script','style','image'].includes(req.destination))return;
 event.respondWith(fetch(req).then(response=>{if(response.ok){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,clone)))}return response}).catch(()=>caches.match(req).then(hit=>hit||caches.match('/'))))});
