'use strict';
(() => {
  const $=id=>document.getElementById(id),key='spvm.publicationSettings.v1';
  let catalog=null,busy=false,timer=null;
  async function api(path='',body){
    const r=await fetch('/spvm-api/v1/publication-settings'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
      ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const value=await r.json();if(!r.ok){const error=Error(value.error||'Publication operation unavailable');error.refused=value.request_accepted===false;throw error;}return value;
  }
  async function poll(id){
    try{
      const value=await api('/'+encodeURIComponent(id));$('publication-status').textContent=`${value.status}: ${value.message||''} Request: ${id}`;
      if(['SUCCEEDED','REFUSED','REVIEW_REQUIRED','NOT_FOUND'].includes(value.status)){
        sessionStorage.removeItem(key);busy=false;$('publication-status').textContent+=' Refresh before another change.';
      }else timer=setTimeout(()=>poll(id),5000);
    }catch(error){$('publication-status').textContent=error.message+' Keep this request ID; no automatic replay.';}
  }
  async function load(){
    clearTimeout(timer);catalog=null;$('publication-fields').disabled=true;
    try{
      catalog=await api();const value=catalog.configuration;
      $('publication-enabled').checked=value?.enabled||false;
      $('publication-domain').value=value?.domain_suffix||'';
      $('publication-addresses').value=(value?.public_addresses||[]).join(', ');
      if(!value){const a=catalog.ingress.bind_address;if(!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a))$('publication-addresses').value=a;}
      const option=document.createElement('option');option.value=catalog.ingress.id;option.textContent=catalog.ingress.host;
      $('publication-ingress').replaceChildren(option);
      $('publication-bind').textContent=`Local bind: ${catalog.ingress.bind_address}; logical profile: ${catalog.profile_id}`;
      $('publication-status').textContent=`${catalog.status}${catalog.blockers.length?' · '+catalog.blockers.join(', '):''}`;
      busy=Boolean(sessionStorage.getItem(key));$('publication-fields').disabled=busy||catalog.blockers.length>0;
      const saved=sessionStorage.getItem(key);if(saved)await poll(JSON.parse(saved).request_id);
    }catch(error){$('publication-status').textContent=error.message+' No change submitted.';}
  }
  $('publication-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!catalog)return;
    const configuration={enabled:$('publication-enabled').checked,domain_suffix:$('publication-domain').value.trim().toLowerCase(),
      public_addresses:$('publication-addresses').value.split(',').map(s=>s.trim()).filter(Boolean),ingress_id:$('publication-ingress').value};
    if(!confirm(`${configuration.enabled?'Enable':'Disable new'} Swarm UI publication?\nZone: ${configuration.domain_suffix}\nPublic endpoint: ${configuration.public_addresses.join(', ')}\nExisting routes and VMs are preserved. DNS credentials remain in Swarm.`))return;
    const body={request_id:crypto.randomUUID(),generation:catalog.generation,configuration};sessionStorage.setItem(key,JSON.stringify(body));
    busy=true;$('publication-fields').disabled=true;
    try{await poll((await api('',body)).request_id);}
    catch(error){if(error.refused){sessionStorage.removeItem(key);busy=false;}$('publication-status').textContent=error.message+' Refresh before any further operation.';}
  });
  $('publication-refresh').addEventListener('click',load);window.addEventListener('pagehide',()=>clearTimeout(timer));load();
})();
