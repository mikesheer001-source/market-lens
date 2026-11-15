self.addEventListener('push', event => {
  let data={title:'Market Lens',body:'Your screen has an update.',url:'/'};
  try { data={...data,...event.data.json()}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/favicon.svg',data:{url:data.url}}));
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.openWindow('/'));});
