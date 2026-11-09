'use strict';
(() => {
  const $=id=>document.getElementById(id),key='spvm.generalSettings';
  let catalog=null,busy=false,version=0,timer=null;
  async function api(path='',body){
    const r=await fetch('/spvm-api/v1/settings'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
      ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const v=await r.json();
    if(!r.ok){const e=Error(v.error||'General settings unavailable');e.notAccepted=v.request_accepted===false;throw e;}
    return v;
  }
  const blocked=()=>catalog?.blockers.some(b=>b!=='HOST_DEBUG_POLICY_DIFFERS');
  function update(){$('settings-fields').disabled=busy||!catalog||blocked();}
  async function poll(id,own){
    try{
      const v=await api('/'+encodeURIComponent(id));if(own!==version)return;
      $('status').textContent=`${v.status}: ${v.message||''} Request: ${id}`;
      if(window.SpvmResourceRequests.missing(v,$('status'),key))return;
      if(['SUCCEEDED','REFUSED','REVIEW_REQUIRED'].includes(v.status)){
        sessionStorage.removeItem(key);
        $('status').textContent+=' Refresh settings before any further change.';
      }else timer=setTimeout(()=>poll(id,own),5000);
    }catch(e){if(own===version)$('status').textContent=e.message+' Keep this request ID and inspect it before retrying.';}
  }
  async function load(){
    const own=++version;clearTimeout(timer);catalog=null;busy=Boolean(sessionStorage.getItem(key));update();
    $('status').textContent='Loading settings…';$('hosts').replaceChildren();$('blockers').hidden=true;
    try{
      const v=await api();if(own!==version)return;catalog=v;
      $('allow-debug').checked=v.allow_debug;
      if(v.blockers.length){$('blockers').textContent=v.blockers.join(', ');$('blockers').hidden=false;}
      const list=document.createElement('ul');
      for(const h of v.hosts){const row=document.createElement('li');row.textContent=`${h.host} · ${h.mode==='untrusted'?'Non-CC · debug only':h.mode==='tdx'?'TDX':'SEV-SNP'} · debug ${h.allow_debug?'allowed':'forbidden'}`;list.append(row);}
      $('hosts').append(list);$('status').textContent='Settings observed. Changes require explicit confirmation.';update();
      const saved=sessionStorage.getItem(key);if(saved)await poll(JSON.parse(saved).request_id,own);
    }catch(e){if(own===version)$('status').textContent=e.message+' No change was submitted.';}
  }
  $('settings-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!catalog||blocked()||sessionStorage.getItem(key))return;
    const enabled=$('allow-debug').checked;
    if(!enabled&&catalog.hosts.some(h=>h.mode==='untrusted')){
      $('status').textContent='Debug cannot be forbidden while a non-CC debug-only compute is enrolled.';return;
    }
    const hosts=catalog.hosts.map(h=>h.host).join(', ');
    if(!confirm(`${enabled?'Allow':'Forbid'} debug images on all enrolled computes?\n${hosts}\nThis affects registration and new launch admission. Running VMs, CC mode, resources and scheduling are not changed.`))return;
    const body={request_id:crypto.randomUUID(),generation:catalog.generation,allow_debug:enabled};
    sessionStorage.setItem(key,JSON.stringify(body));busy=true;update();$('status').textContent='Submitting explicit administrator request…';
    try{const v=await api('',body);await poll(v.request_id,version);}
    catch(e){
      if(e.notAccepted){sessionStorage.removeItem(key);busy=false;update();}
      $('status').textContent=e.message+(e.notAccepted?' No request was accepted.':' Keep this request ID; refresh to inspect the same request.');
    }
  });
  $('refresh').addEventListener('click',load);
  window.addEventListener('spvm-hosts-refresh',load);
  window.addEventListener('pagehide',()=>{++version;clearTimeout(timer);});
  load();
})();
