/* Compatibility adapter: same collection/doc interface, no UI/CSS changes.
   Polling every 10 seconds; deliberately no local fallback on connection failure. */
window.__musicSupabaseReady = (async () => {
 const cfg = window.MUSICAMOOZ_CONFIG;
 if (!cfg || cfg.url.includes('YOUR_') || cfg.publishableKey.includes('YOUR_')) throw Error('Supabase configuration missing');
 const client = window.supabase.createClient(cfg.url, cfg.publishableKey);
 const {data: {session}, error} = await client.auth.getSession();
 if (error) throw error;
 if (!session) { location.replace(new URL('login.html', location.href)); throw Error('Sign in required'); }
 const member = await client.from('music_members').select('display_name').eq('user_id', session.user.id).single();
 if (member.error || !member.data) throw Error('Account is not an approved editor');
 client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') location.replace(new URL('login.html', location.href)); });
 const listeners = new Set();
 const validId = id => /^[A-Za-z0-9_.~:@+-]{1,200}$/.test(id);
 function route(path) {
  const p = path.split('/');
  if (p.length === 1 && ['students','placements','suggestions'].includes(p[0])) return {table:p[0]};
  if (p.length === 3 && p[0] === 'students' && validId(p[1]) && ['lessons','exams'].includes(p[2])) return {table:p[2], student:p[1]};
  throw Error('Unsupported collection');
 }
 function collection(path, sort = null, cap = Infinity) {
  const r = route(path);
  async function get() {
   // Explicit pagination avoids Supabase's default response row cap.
   let rows = [];
   for (let offset = 0;; offset += 500) {
    let q = client.from(r.table).select('id,data').order('id').range(offset, offset + 499);
    if (r.student) q = q.eq('student_id', r.student);
    const {data, error} = await q; if (error) throw error;
    rows.push(...data); if (data.length < 500) break;
   }
   if (sort) rows.sort((a,b) => { const x=a.data[sort[0]], y=b.data[sort[0]]; return (x<y?-1:x>y?1:0)*(sort[1]==='desc'?-1:1); });
   return {docs:rows.slice(0,cap).map(row=>({id:row.id,data:()=>structuredClone(row.data)}))};
  }
  return {
   doc(id = crypto.randomUUID()) {
    if (!validId(id)) throw Error('Invalid id');
    return {id, collection:n=>collection(path+'/'+id+'/'+n),
     async set(data) {
      const row = {id, data}; if (r.student) row.student_id=r.student;
      const result=await client.from(r.table).upsert(row,{onConflict:r.student?'student_id,id':'id'}).select('id');
      if(result.error) throw result.error;
      if(result.data.length!==1) throw Error('Write denied');
      listeners.forEach(fn=>fn());
     },
     async delete() {
      let q=client.from(r.table).delete().eq('id',id); if(r.student) q=q.eq('student_id',r.student);
      const result=await q.select('id'); if(result.error) throw result.error;
      if(result.data.length!==1) throw Error('Delete denied or record missing');
      listeners.forEach(fn=>fn());
     }
    };
   },
   orderBy:(field,direction='asc')=>collection(path,[field,direction],cap),
   limit:n=>collection(path,sort,n), get,
   onSnapshot(callback,onError=console.error) {
    let active=true, running=false, again=false, previous='';
    async function refresh() {
     if (!active) return;
     if (running) {again=true;return;} running=true;
     try { const snap=await get(); const signature=JSON.stringify(snap.docs.map(d=>[d.id,d.data()]));
      if(active && signature!==previous){previous=signature;callback(snap);}
     } catch(error) {if(active) onError(error);} finally {running=false;if(again){again=false;refresh();}}
    }
    listeners.add(refresh); const timer=setInterval(refresh,10000); refresh();
    return ()=>{active=false;clearInterval(timer);listeners.delete(refresh);};
   }
  };
 }
 window.musicamoozSignOut = async () => {
  // Clear private draft on this device; old backups remain under user control.
  localStorage.removeItem('placement-draft');
  const {error}=await client.auth.signOut();if(error) throw error;
 };
 return {collection};
})();
// connect() awaits this promise later in the original page.
window.__musicSupabaseReady.catch(console.error);
