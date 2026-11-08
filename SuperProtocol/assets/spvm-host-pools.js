'use strict';
(() => {
  let generation=0;const timers=new Set();
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  async function api(path,body) {
    const r=await fetch('/spvm-api/v1/host-pools'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
      ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const value=await r.json();if(!r.ok){const error=new Error(value.error||'Pool management is unavailable');error.notAccepted=value.request_accepted===false;throw error;}return value;
  }
  function field(label,type,value,parent) {
    const wrap=el('label',label);wrap.className='field';const input=el('input');input.type=type;
    if(type==='checkbox'){input.checked=value;wrap.className='check-field';}else input.value=String(value);
    if(type==='number'){input.min='1';input.step='1';}wrap.append(input);parent.append(wrap);return input;
  }
  function editor(host,error) {
    const version=generation,details=el('details');details.className='editor pool-management';details.append(el('summary','Manage storage pools'));
    if(!host){const text=el('p',error||'Pool management has not been delegated.');text.className='host-notice';details.append(text);return details;}
    const panel=el('div');panel.className='edit-panel';details.append(panel);
    panel.append(el('p','Add mounted filesystems, choose directories, disable or remove pool registrations. No directory or disk data is deleted, moved or formatted. Changes require an empty host.'));
    const eligible=host.filesystems.filter(f=>f.eligible),known=new Map(eligible.map(f=>[f.filesystem_id,f]));
    const detected=el('details');detected.className='detected-filesystems';detected.append(el('summary','Detected filesystems'));
    const list=el('ul');
    for(const f of host.filesystems)list.append(el('li',`${f.mount} · ${f.fstype} · ${f.available_gib} GiB free / ${f.total_gib} GiB total`+
      (f.root_filesystem?' · root filesystem':'')+(f.eligible?'':` · excluded: ${f.reason}`)));
    if(!host.filesystems.length)list.append(el('li','No supported local mounted filesystems detected.'));
    detected.append(list);panel.append(detected);
    const form=el('fieldset');panel.append(form);const rows=el('div');rows.className='pool-rows';form.append(rows);
    const key='spvm.hostPools.'+host.host,saved=sessionStorage.getItem(key);let pending=Boolean(saved),draft=[];
    const status=el('p');status.className='request-status';status.setAttribute('role','status');
    const actions=el('div');actions.className='edit-actions';const add=el('button','Add pool'),apply=el('button','Review and apply pools');
    for(const b of [add,apply]){b.type='button';b.className='button secondary';}apply.className='button';actions.append(add,apply);form.append(actions);panel.append(status);
    const update=()=>{form.disabled=pending||host.blockers.length>0;};
    function row(value) {
      const box=el('fieldset');box.className='pool-row';const grid=el('div');grid.className='pool-inputs';box.append(grid);
      const id=field('Pool ID','text',value.id,grid),wrap=el('label','Filesystem');wrap.className='field';const fs=el('select');wrap.append(fs);grid.append(wrap);
      fs.setAttribute('aria-label','Filesystem');
      const placeholder=el('option','Choose a mounted filesystem');placeholder.value='';placeholder.disabled=true;fs.append(placeholder);
      for(const f of host.filesystems.filter(f=>f.eligible||f.filesystem_id===value.filesystem_id&&!known.has(f.filesystem_id))) {
        const option=el('option',`${f.mount} · ${f.fstype} · ${f.available_gib} GiB free${f.root_filesystem?' · ROOT':''}${f.eligible?'':' · unavailable'}`);
        option.value=f.filesystem_id;option.disabled=!f.eligible;fs.append(option);
      }
      fs.value=value.filesystem_id||'';
      const directory=field('State directory','text',value.path,grid),budget=field('State budget (GiB)','number',value.budget_gib,grid),
        reserve=field('Free-space reserve (GiB)','number',value.reserve_gib,grid);
      directory.parentElement.classList.add('directory-field');
      const flags=el('div');flags.className='pool-flags';box.append(flags);
      const enabled=field('Enabled','checkbox',value.enabled!==false,flags);
      const warning=el('p','Warning: this pool shares the root filesystem (/) with the OS and OpenStack. VM state can exhaust system disk space. Keep an adequate free-space reserve.');
      warning.className='host-notice';box.append(warning);
      const updateWarning=()=>{warning.hidden=!known.get(fs.value)?.root_filesystem;};
      updateWarning();
      const remove=el('button','Remove registration');remove.type='button';remove.className='button secondary remove-pool';box.append(remove);
      const item={box,id,fs,directory,budget,reserve,enabled};draft.push(item);rows.append(box);
      fs.addEventListener('change',()=>{
        const f=known.get(fs.value);
        updateWarning();
      });
      remove.addEventListener('click',()=>{draft=draft.filter(p=>p!==item);box.remove();status.textContent='Draft changed. Removing a registration never deletes its directory or data. Apply explicitly to save.';});
    }
    function populate(values){draft=[];rows.replaceChildren();for(const value of values)row(value);}
    populate(host.pools);
    add.addEventListener('click',()=>{
      if(!eligible.length){status.textContent='No eligible mounted filesystem is available.';return;}
      row({id:'',filesystem_id:'',path:'',budget_gib:'',reserve_gib:'',enabled:true});
    });
    async function poll(request) {
      if(version!==generation)return;
      try {
        const result=await api('/'+encodeURIComponent(request));if(version!==generation)return;
        status.textContent=`${result.status}: ${result.message||''} Request: ${request}`;
        if(['SUCCEEDED','REFUSED','REVIEW_REQUIRED'].includes(result.status)){
          sessionStorage.removeItem(key);status.textContent+=' Refresh hosts before any further change.';
        }else {const timer=setTimeout(()=>{timers.delete(timer);poll(request);},5000);timers.add(timer);}
      }catch(e){status.textContent=e.message+'. Inspect this same request before any retry.';}
    }
    apply.addEventListener('click',async()=>{
      if(pending||sessionStorage.getItem(key))return;
      const pools=draft.map(p=>({id:p.id.value.trim(),filesystem_id:p.fs.value,path:p.directory.value.trim(),budget_gib:Number(p.budget.value),
        reserve_gib:Number(p.reserve.value),enabled:p.enabled.checked,allow_root:known.get(p.fs.value)?.root_filesystem===true}));
      const ids=new Set(),active=new Set(),paths=[];
      for(const p of pools){
        const fs=known.get(p.filesystem_id);
        if(!/^[a-z][a-z0-9-]{0,39}$/.test(p.id)||ids.has(p.id)){status.textContent='Use unique pool IDs: lowercase letters, digits and hyphens, starting with a letter.';return;}ids.add(p.id);
        if(!fs?.eligible){status.textContent='Choose an eligible mounted filesystem.';return;}
        if(!p.path.startsWith('/')||p.path.endsWith('/')||p.path.split('/').some(x=>x==='.'||x==='..')||p.path===fs.mount||
           (fs.mount!=='/'&&!p.path.startsWith(fs.mount+'/'))){status.textContent='Choose a canonical state directory below the selected mount.';return;}
        if(paths.some(old=>p.path===old||p.path.startsWith(old+'/')||old.startsWith(p.path+'/'))){status.textContent='Pool directories must not overlap.';return;}paths.push(p.path);
        if(!Number.isSafeInteger(p.budget_gib)||!Number.isSafeInteger(p.reserve_gib)||p.budget_gib<1||p.reserve_gib<1||
           p.enabled&&p.budget_gib+p.reserve_gib>fs.available_gib){status.textContent='Use positive whole GiB budgets/reserves that fit currently free space.';return;}
        if(p.enabled&&active.has(p.filesystem_id)){status.textContent='Only one enabled pool may use a filesystem; two directories do not double its capacity.';return;}
        if(p.enabled)active.add(p.filesystem_id);
      }
      const summary=pools.map(p=>`${p.id}: ${p.enabled?'enabled':'disabled'} · ${p.path} · ${p.budget_gib} GiB + ${p.reserve_gib} GiB reserve`).join('\n')||'No registered pools';
      if(prompt(`Apply pool configuration to ${host.host}?\n${summary}\nData will not be deleted or moved. A host without an enabled pool is UNCONFIGURED and cannot admit any new VM. The host remains disabled after applying changes.\nType ${host.host}:`)!==host.host)return;
      const body={request_id:crypto.randomUUID(),host:host.host,generation:host.generation,pools};
      sessionStorage.setItem(key,JSON.stringify(body));pending=true;update();
      try {const response=await api('',body);await poll(response.request_id);}
      catch(e){if(e.notAccepted)sessionStorage.removeItem(key);status.textContent=e.message+'. Refresh to inspect the same host/request before retrying.';}
    });
    if(host.blockers.length){const blocked=el('p','Pool changes unavailable: '+host.blockers.join(', '));blocked.className='host-notice';panel.prepend(blocked);}
    update();if(saved){details.open=true;try{poll(JSON.parse(saved).request_id);}catch(_){status.textContent='Saved pool request needs manual review.';}}
    return details;
  }
  window.SpvmPools={editor,async catalog(){++generation;for(const t of timers)clearTimeout(t);timers.clear();return (await api('')).hosts;}};
})();
