'use strict';
(() => {
  const $=id=>document.getElementById(id),key='spvm.publicationSettings.v1';
  let catalog=null,busy=false,timer=null;
  function domainSuffixes(text){
    if(text.length>8192)throw Error('Domain suffix list is too long.');
    const zones=text.split(';').map(s=>s.trim().toLowerCase());
    if(zones.length<1||zones.length>32||new Set(zones).size!==zones.length)
      throw Error('Enter one to 32 distinct domain suffixes separated by ;, or standalone *.');
    if(zones.length===1&&zones[0]==='*')return zones;
    if(zones.includes('*'))throw Error('Use * alone, not together with domain suffixes.');
    if(zones.some(s=>s.length>253||s.split('.').length<2||s.split('.').some(p=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))))
      throw Error('Enter valid domain suffixes separated by ;. Patterns such as *.example.org are not supported.');
    return zones;
  }
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
      catalog=await api();
      if(catalog.capability!=='managed-swarm-publication-v2')throw Error('Matching publication v2 GUI and backend required.');
      const value=catalog.configuration;
      $('publication-enabled').checked=value?.enabled||false;
      $('publication-domain').value=(value?.domain_suffixes||[]).join('; ');
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
    let zones;
    try{zones=domainSuffixes($('publication-domain').value);}
    catch(error){$('publication-status').textContent=error.message+' No request submitted.';return;}
    const configuration={enabled:$('publication-enabled').checked,domain_suffixes:zones,
      public_addresses:$('publication-addresses').value.split(',').map(s=>s.trim()).filter(Boolean),ingress_id:$('publication-ingress').value};
    const scope=zones[0]==='*'?'ANY domain — domain-zone restriction is disabled. DNS, ingress address and trusted HTTPS checks still apply.':zones.join('; ');
    if(!confirm(`${configuration.enabled?'Enable':'Disable new'} Swarm UI publication?\nAllowed zones: ${scope}\nPublic endpoint: ${configuration.public_addresses.join(', ')}\nExisting routes and VMs are preserved. DNS credentials remain in Swarm.`))return;
    const body={request_id:crypto.randomUUID(),generation:catalog.generation,configuration};sessionStorage.setItem(key,JSON.stringify(body));
    busy=true;$('publication-fields').disabled=true;
    try{await poll((await api('',body)).request_id);}
    catch(error){if(error.refused){sessionStorage.removeItem(key);busy=false;}$('publication-status').textContent=error.message+' Refresh before any further operation.';}
  });
  $('publication-refresh').addEventListener('click',load);window.addEventListener('pagehide',()=>clearTimeout(timer));load();
})();
