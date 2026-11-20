'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let view=0,lifecycleTimer,lifecycleAbort;const timers=new Set(),expandedHosts=new Set(),lifecycleViews=new Map();
  function el(tag,text) { const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node; }
  const number=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
  const memory=(value,exact=false)=>value===null?'Not configured':`${Number(value/1024).toLocaleString('en-US',{maximumFractionDigits:exact?10:2})} GiB`;
  const cpuBudget=value=>value===null?'Not configured':`${number(value)} vCPU`;
  function table(headers,rows,className,currentColumn) {
    const scroll=el('div');scroll.className='table-scroll';const grid=el('table');grid.className=className;
    const head=el('thead'),line=el('tr');
    for(const label of headers) {const cell=el('th',label);cell.scope='col';line.append(cell);}
    head.append(line);grid.append(head);const body=el('tbody');
    for(const row of rows) {
      const line=el('tr');row.forEach((value,index)=>{const cell=el('td');if(value instanceof Node)cell.append(value);else cell.textContent=value;if(index===currentColumn)cell.className='current-value';line.append(cell);});body.append(line);
    }
    grid.append(body);scroll.append(grid);return scroll;
  }
  async function api(path,body,resource='host-budgets',signal) {
    const response=await fetch('/spvm-api/v1/'+resource+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
      ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const result=await response.json();
    if(!response.ok) {
      const error=new Error(result.error||'Budget operation unavailable');
      error.notAccepted=result.request_accepted===false;throw error;
    }
    return result;
  }
  function input(label,value,parent,hint) {
    const wrapper=el('label',label),field=el('input');wrapper.className='field';field.type='number';field.min='1';field.step='1';field.value=value===null?'':String(value);
    if(hint)wrapper.append(el('small',hint));
    wrapper.append(field);parent.append(wrapper);return field;
  }
  async function poll(id,message,button,key,generation) {
    if(generation!==view)return;
    try {
      const result=await api('/'+encodeURIComponent(id));if(generation!==view)return;
      if(window.SpvmResourceRequests.missing(result,message,key))return;
      message.textContent=`${result.status}: ${result.message||''} Request: ${id}`;
      if(['SUCCEEDED','REFUSED','REVIEW_REQUIRED'].includes(result.status)) {
        sessionStorage.removeItem(key);button.disabled=true;
        message.textContent+=' Refresh the host catalog before another change.';
      } else {const timer=setTimeout(()=>{timers.delete(timer);poll(id,message,button,key,generation);},5000);timers.add(timer);}
    } catch(error) { if(generation===view)message.textContent=error.message+'. Refresh to inspect the same request; do not create a replacement request.'; }
  }
  function lifecycleControls(host,state,badge) {
    const panel=el('section');panel.className='edit-panel';
    const summary=el('p'),notice=el('p');notice.className='host-notice';panel.append(summary,notice);
    const key='spvm.hostLifecycle.'+host,saved=sessionStorage.getItem(key),generation=view;
    let locked=Boolean(saved);
    const enable=el('button','Enable host'),disable=el('button','Disable new launches'),message=el('p');
    for(const button of [enable,disable]){button.type='button';button.className='button secondary';}
    message.className='request-status';message.setAttribute('role','status');
    const actions=el('div');actions.className='edit-actions';actions.append(enable,disable);panel.append(actions,message);
    function update(next){
      state=next;
      const stale=state?.blockers.includes('LIFECYCLE_OBSERVATION_STALE')||
        (Number.isFinite(state?.observed_at)&&Date.now()/1000-state.observed_at>180);
      const unknown=!state||stale||state.status==='UNKNOWN';
      badge.textContent=unknown?'UNKNOWN':state.status;
      badge.className='badge '+(!unknown&&state.status==='ENABLED'?'ready':'blocked');
      const readiness=state?.readiness,mode=readiness?.mode==='untrusted'?'Non-CC · debug only':readiness?.mode==='tdx'?'TDX':readiness?.mode==='sev-snp'?'SEV-SNP':'Launch mode unknown';
      summary.textContent=`${mode} · Nova ${state?.nova_status||'unknown'} · Technical readiness: ${unknown?'unknown':state.technical_ready?'ready':readiness?.reason||'not ready'}`;
      const blockers=(state?.blockers||[]).filter(b=>b!=='LIFECYCLE_OBSERVATION_STALE');
      notice.textContent=[stale?'Host status is out of date. Waiting for a fresh worker observation; this does not confirm a host failure.':unknown?'Host status is unavailable. Enable is blocked until a fresh observation is available.':'',...blockers.map(b=>b.replaceAll('_',' '))].filter(Boolean).join(' ');
      notice.hidden=!notice.textContent;
      enable.disabled=locked||unknown||state.status==='ENABLED'||state.status==='UNCONFIGURED'||state.blockers.length>0;
      disable.disabled=locked||!state||!state.resources.enabled&&state.nova_status!=='enabled';
    }
    lifecycleViews.set(host,update);update(state);
    async function pollLifecycle(id){
      if(generation!==view)return;
      try{
        const result=await api('/'+encodeURIComponent(id),undefined,'host-lifecycle');if(generation!==view)return;
        if(window.SpvmResourceRequests.missing(result,message,key))return;
        message.textContent=`${result.status}: ${result.message||''} Request: ${id}`;
        if(['SUCCEEDED','REFUSED','REVIEW_REQUIRED'].includes(result.status)){
          sessionStorage.removeItem(key);message.textContent+=' Refresh hosts to see the verified state.';
        }else{const timer=setTimeout(()=>{timers.delete(timer);pollLifecycle(id);},5000);timers.add(timer);}
      }catch(error){message.textContent=error.message+'. Inspect the same request; do not submit a replacement.';}
    }
    async function submit(enabled){
      if(sessionStorage.getItem(key))return;
      if(!confirm(enabled?`Enable new VM launches on ${host}?`:`Disable new launches on ${host}? Running VMs and already accepted operations will continue.`))return;
      const body={request_id:crypto.randomUUID(),host,generation:state.generation,enabled};
      sessionStorage.setItem(key,JSON.stringify(body));locked=true;enable.disabled=disable.disabled=true;
      try{const result=await api('',body,'host-lifecycle');await pollLifecycle(result.request_id);}
      catch(error){if(error.notAccepted)sessionStorage.removeItem(key);message.textContent=error.message+'. Refresh before any further operation.';}
    }
    enable.addEventListener('click',()=>submit(true));disable.addEventListener('click',()=>submit(false));
    if(saved){try{pollLifecycle(JSON.parse(saved).request_id);}catch(_){message.textContent='Saved lifecycle request requires review.';}}
    return panel;
  }
  function card(host,poolCatalog,poolError,gpuCatalog,gpuError,lifecycle) {
    const generation=view,blocked=host.blockers.length>0,key='spvm.hostBudget.'+host.host;
    const saved=sessionStorage.getItem(key);let pending=Boolean(saved);
    const box=el('details');box.className='host-card';box.open=expandedHosts.has(host.host);
    box.addEventListener('toggle',()=>{if(box.open)expandedHosts.add(host.host);else expandedHosts.delete(host.host);});
    const heading=el('summary');heading.className='host-heading';const identity=el('div');
    const caption=el('p','COMPUTE HOST');caption.className='eyebrow';identity.append(caption,el('h2',host.host));
    const badge=el('span',lifecycle?.status||'Status unavailable');badge.className='badge '+(lifecycle?.status==='ENABLED'?'ready':'blocked');
    heading.append(identity,badge);box.append(heading);
    box.append(lifecycleControls(host.host,lifecycle,badge));
    const content=el('div');content.className='host-content';
    const title=el('h3','CPU & memory');title.className='section-heading';content.append(title);
    content.append(table(['Resource','Detected hardware','Assigned to OpenStack'],[
      ['CPU',`${number(host.hardware.logical_cpus)} logical CPUs`,cpuBudget(host.current.vcpus)],
      ['Memory',memory(host.hardware.memory_mb),memory(host.current.memory_mb,true)],
    ],'resource-table',2));
    const note=el('p','First setup: assign CPU/RAM, add an enabled state pool, optionally select GPUs, then Enable this host. Resource changes never enable scheduling.');note.className='table-note';content.append(note);
    const storageTitle=el('h3','State storage');storageTitle.className='section-heading storage-heading';content.append(storageTitle);
    if(!host.current.pools.length)content.append(el('p','Not configured — add at least one enabled state pool.'));
    content.append(table(['Pool','Filesystem total','Physically free','OpenStack budget','Host reserve'],host.current.pools.map(pool=>{
      const physical=host.hardware.pools.find(p=>p.id===pool.id);
      const label=el('span',pool.id),definition=poolCatalog?.pools.find(p=>p.id===pool.id);
      if(definition?.mount==='/'){
        const warning=el('span','⚠');warning.className='root-pool-icon';warning.setAttribute('role','img');
        warning.title='Warning: this pool shares the root filesystem (/) with the OS and OpenStack. VM state can exhaust system disk space. Keep an adequate free-space reserve.';
        warning.setAttribute('aria-label',warning.title);label.append(warning);
      }
      return [label,`${number(physical.total_gib)} GiB`,`${number(physical.available_gib)} GiB`,`${number(pool.budget_gib)} GiB`,`${number(pool.reserve_gib)} GiB`];
    }),'pool-table',3));
    if(blocked) {
      const notice=el('aside','Resource changes are blocked. Active instances, reservations or a failed operation may require attention. Review the checks below.');notice.className='host-notice';
      const details=el('details');details.append(el('summary','View blocking checks'));const list=el('ul');
      for(const reason of host.blockers)list.append(el('li',reason.replaceAll('_',' ')));
      details.append(list);notice.append(details);content.append(notice);
    }
    const editor=el('details');editor.className='editor';editor.open=pending||host.current.vcpus===null;editor.append(el('summary','Change CPU & memory limits'));
    const panel=el('div');panel.className='edit-panel';
    const fields=el('fieldset'),resources=el('div');resources.className='input-grid';fields.append(resources);
    const cpu=input('CPU budget (vCPU)',host.current.vcpus,resources,'Leave CPU capacity for the host.');
    const ram=input('Memory budget (GiB)',host.current.memory_mb===null?null:host.current.memory_mb/1024,resources,`Current: ${memory(host.current.memory_mb,true)}. Leave memory capacity for the host.`);
    ram.min=String(1/1024);ram.step='any';
    const storageNote=el('p','Manage disk budgets and reserves in Manage storage pools.');storageNote.className='table-note';
    panel.append(storageNote,fields);
    const button=el('button','Review and apply'),cancel=el('button','Cancel'),message=el('p');button.type=cancel.type='button';
    button.className='button';cancel.className='button secondary';message.className='request-status';message.setAttribute('role','status');
    const actions=el('div');actions.className='edit-actions';actions.append(button,cancel);panel.append(actions,message);
    const update=()=>{fields.disabled=blocked||pending;button.disabled=blocked||pending;cancel.disabled=pending;};
    update();cancel.addEventListener('click',()=>{editor.open=false;});
    button.addEventListener('click',async()=> {
      if(sessionStorage.getItem(key))return;
      const budget={vcpus:Number(cpu.value),memory_mb:Number(ram.value)*1024,
        pools:host.current.pools.map(p=>({id:p.id,budget_gib:p.budget_gib,reserve_gib:p.reserve_gib}))};
      const resolved=budget;
      if(!Number.isSafeInteger(resolved.vcpus)||resolved.vcpus<1) {
        message.textContent='Enter a positive whole CPU budget in vCPUs.';return;
      }
      if(!Number.isSafeInteger(resolved.memory_mb)||resolved.memory_mb<1) {
        message.textContent='Enter a positive memory budget in GiB. Fractions must convert exactly to whole MiB (1 GiB = 1024 MiB).';return;
      }
      if(resolved.vcpus>=host.hardware.logical_cpus||resolved.memory_mb>=host.hardware.memory_mb) {
        message.textContent='CPU/RAM budgets must leave a positive reserve for the host.';return;
      }
      if(resolved.pools.some(pool=> {
        const physical=host.hardware.pools.find(p=>p.id===pool.id);
        return !physical||!Number.isSafeInteger(pool.budget_gib)||!Number.isSafeInteger(pool.reserve_gib)||
          pool.budget_gib<1||pool.reserve_gib<1||pool.budget_gib+pool.reserve_gib>physical.available_gib;
      })) {
        message.textContent='Review disk budgets and reserves in Manage storage pools, then refresh hosts before changing CPU/RAM.';return;
      }
      if(!confirm(`Apply CPU and memory limits to ${host.host}?\n${resolved.vcpus} vCPU / ${memory(resolved.memory_mb,true)} RAM\nStorage pool budgets and reserves remain unchanged.\nOnly an empty host is permitted; the host stays disabled until a separate Enable.`))return;
      const body={host:host.host,generation:host.generation,budget,request_id:crypto.randomUUID()};
      sessionStorage.setItem(key,JSON.stringify(body));pending=true;update();message.textContent='Submitting explicit administrator request…';
      try {
        const result=await api('',body);await poll(result.request_id,message,button,key,generation);
      } catch(error) {
        if(error.notAccepted) {
          sessionStorage.removeItem(key);pending=false;update();
          message.textContent=error.message+'. Request was not accepted. Refresh the host catalog.';
        } else message.textContent=error.message+'. Inspect this same request before any retry.';
      }
    });
    editor.append(panel);content.append(editor);
    if(window.SpvmPools)content.append(window.SpvmPools.editor(poolCatalog,poolError));
    if(window.SpvmGpus)content.append(window.SpvmGpus.editor(gpuCatalog,gpuError));
    box.append(content);
    if(saved) {try {poll(JSON.parse(saved).request_id,message,button,key,generation);}catch(_){message.textContent='Stored request needs manual review.';}}
    return box;
  }
  function stopLifecycleRefresh(){
    clearTimeout(lifecycleTimer);lifecycleTimer=undefined;
    if(lifecycleAbort)lifecycleAbort.abort();
  }
  function scheduleLifecycleRefresh(){
    clearTimeout(lifecycleTimer);
    if(!document.hidden)lifecycleTimer=setTimeout(refreshLifecycle,30000);
  }
  async function refreshLifecycle(){
    clearTimeout(lifecycleTimer);
    if(document.hidden||lifecycleAbort)return;
    const generation=view,controller=new AbortController();lifecycleAbort=controller;
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const result=await api('',undefined,'host-lifecycle',controller.signal);
      if(generation!==view)return;
      for(const [host,update] of lifecycleViews)update(result.hosts.find(item=>item.host===host));
    }catch(_){
      if(generation===view)for(const update of lifecycleViews.values())update(undefined);
    }finally{
      clearTimeout(timeout);
      if(lifecycleAbort===controller)lifecycleAbort=undefined;
      if(generation===view)scheduleLifecycleRefresh();
    }
  }
  async function refresh() {
    ++view;stopLifecycleRefresh();lifecycleViews.clear();for(const timer of timers)clearTimeout(timer);timers.clear();
    const generation=view;
    $('refresh').disabled=true;
    try {
      const result=await api('');const lifecycle=await api('',undefined,'host-lifecycle');let pools=[],poolError,gpus=[],gpuError;
      if(window.SpvmPools){try{pools=await window.SpvmPools.catalog();}catch(e){poolError=e.message;}}
      if(window.SpvmGpus){try{gpus=await window.SpvmGpus.catalog();}catch(e){gpuError=e.message;}}
      if(generation!==view)return;
      $('hosts').replaceChildren(...result.hosts.map(h=>card(h,pools.find(p=>p.host===h.host),poolError,gpus.find(g=>g.host===h.host),gpuError,lifecycle.hosts.find(l=>l.host===h.host))));$('status').className='page-status';
      const available=result.hosts.filter(h=>!h.blockers.length).length;
      $('status').textContent=result.hosts.length?`${result.hosts.length} compute hosts · ${available} available for changes · ${result.hosts.length-available} blocked`:'No hosts have been delegated for resource management.';
    }
    catch(error){if(generation!==view)return;lifecycleViews.clear();$('hosts').replaceChildren();$('status').className='page-status error';$('status').textContent=error.message;}
    finally {if(generation===view){$('refresh').disabled=false;scheduleLifecycleRefresh();}}
  }
  window.addEventListener('pagehide',()=>{++view;stopLifecycleRefresh();for(const timer of timers)clearTimeout(timer);timers.clear();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopLifecycleRefresh();else refreshLifecycle();});
  window.addEventListener('spvm-hosts-refresh',refresh);
  $('refresh').addEventListener('click',refresh);refresh();
})();
