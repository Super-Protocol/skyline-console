'use strict';
(() => {
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  async function api(path,body){
    const r=await fetch('/spvm-api/v1/host-gpus'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
      ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const v=await r.json();if(!r.ok){const e=Error(v.error||'GPU management unavailable');e.notAccepted=v.request_accepted===false;throw e;}return v;
  }
  function editor(host,error){
    const section=el('details');section.className='editor gpu-management';section.append(el('summary','GPU devices & profiles'));
    const panel=el('div');panel.className='edit-panel';section.append(panel);
    if(!host){panel.append(el('p',error||'GPU management has not been delegated.'));return section;}
    panel.append(el('p','The GPU profile name is shared across matching cards on all hosts and is shown in flavors. A profile matches PCI identity, not a minimum VRAM capacity.'));
    const status=el('p');status.className='request-status';status.setAttribute('role','status');
    const key='spvm.hostGpu.'+host.host;let busy=Boolean(sessionStorage.getItem(key));const controls=[];
    const update=()=>{for(const button of controls)button.disabled=busy||button.dataset.discovery==='true'&&host.blockers.length>0;};
    async function poll(id){
      try{const v=await api('/'+encodeURIComponent(id));if(!section.isConnected)return;status.textContent=`${v.status}: ${v.message||''}`;
        if(window.SpvmResourceRequests.missing(v,status,key))return;
        if(['SUCCEEDED','REFUSED','REVIEW_REQUIRED'].includes(v.status)){sessionStorage.removeItem(key);status.textContent+=' Refresh hosts before another change.';}
        else setTimeout(()=>{if(section.isConnected)poll(id);},5000);
      }catch(e){status.textContent=e.message+' Inspect the same request before retrying.';}
    }
    async function submit(change){
      if(busy)return;const body={request_id:crypto.randomUUID(),host:host.host,generation:host.generation,change};
      busy=true;sessionStorage.setItem(key,JSON.stringify(body));update();
      try{const v=await api('',body);await poll(v.request_id);}catch(e){
        if(e.notAccepted){sessionStorage.removeItem(key);busy=false;update();}
        status.textContent=e.message+(e.notAccepted?' No change was accepted.':' Refresh to inspect the same request.');
      }
    }
    if(!host.inventory.devices.length)panel.append(el('p','No NVIDIA GPU devices detected.'));
    for(const p of Object.values(host.inventory.profiles)){
      const row=el('fieldset');row.className='pool-row';row.append(el('legend',p.kind==='fabric'?'GPU fabric profile':'GPU profile'));
      const label=el('label','GPU profile name'),input=el('input');label.className='field';input.type='text';input.maxLength=128;input.value=p.display_name;label.append(input);row.append(label);
      const button=el('button','Save name');button.type='button';button.className='button secondary';
      button.addEventListener('click',()=>submit({kind:'profile-label',profile:p.id,label:input.value.trim()}));controls.push(button);row.append(button);panel.append(row);
    }
    for(const g of host.inventory.groups){const text=el('p',`${g.id}: ${g.members.length} PCI devices · ${g.topology} · experimental. ${g.blockers.join(', ')||'Whole-group allocation only.'}`);text.className='host-notice';panel.append(text);}
    const form=el('form');form.className='gpu-availability';
    form.append(el('p','Availability and hardware corrections require an empty host. No VM will be stopped or restarted.'));
    if(host.blockers.length){const note=el('p','Changes blocked: '+host.blockers.join(', '));note.className='host-notice';form.append(note);}
    const input=(parent,text,type,value,detected)=>{
      const label=el('label',text),field=el('input');label.className='field';field.type=type;field.value=value??'';
      if(type==='number'){field.min='0.000000001';field.step='any';}else field.maxLength=128;
      if(detected!==null&&detected!==undefined)field.placeholder=String(detected);
      label.append(field);parent.append(label);field.dataset.discovery='true';controls.push(field);return field;
    };
    const select=(parent,text,value,entries)=>{
      const label=el('label',text),field=el('select');label.className='field';
      for(const [v,name] of entries){const o=el('option',name);o.value=v;field.append(o);}field.value=value||'';
      label.append(field);parent.append(label);field.dataset.discovery='true';controls.push(field);return field;
    };
    const check=(parent,text,value)=>{const label=el('label'),field=el('input');label.className='check-field';field.type='checkbox';field.checked=value;label.append(field,document.createTextNode(text));parent.append(label);field.dataset.discovery='true';controls.push(field);return field;};
    const cards=host.inventory.devices.map(d=>{
      const row=el('fieldset');row.className='pool-row';row.append(el('legend',d.effective.model||(d.role==='gpu'?'GPU':'PCI device')));
      row.append(el('small',`${d.address} · ${d.effective.memory_bytes?d.effective.memory_bytes/2**30+' GiB':'VRAM unknown'}`));
      const enabled=check(row,'Use for OpenStack',d.enabled),fields={};
      if(d.blocker){const note=el('p',d.blocker);note.className='host-notice';row.append(note);}
      if(d.role==='gpu'){
        const advanced=el('details');advanced.className='gpu-corrections';advanced.append(el('summary','Advanced hardware settings'));
        advanced.append(el('p','Detected automatically; no selection is required. Correct these values only if detection is wrong. Unknown characteristics do not block a standalone GPU.'));
        advanced.append(el('small',`Detected: ${d.detected.model||'Unknown model'} · ${d.detected.memory_bytes?d.detected.memory_bytes/2**30+' GiB':'VRAM unknown'} · ${d.detected.variant||'variant unknown'} · ${d.detected.architecture||'architecture unknown'}`));
        const grid=el('div');grid.className='input-grid';advanced.append(grid);row.append(advanced);
        fields.model=input(grid,'Model override (blank = detected)','text',d.overrides.model,d.detected.model);
        fields.memory=input(grid,'VRAM override, GiB (blank = detected)','number',d.overrides.memory_bytes===undefined?'':d.overrides.memory_bytes/2**30,d.detected.memory_bytes?d.detected.memory_bytes/2**30:null);
        fields.variant=select(grid,'Variant override',d.overrides.variant,[['','Use detected'],['pcie','PCIe'],['sxm','SXM']]);
        fields.architecture=select(grid,'Architecture override',d.overrides.architecture,[['','Use detected'],['hopper','Hopper'],['blackwell','Blackwell']]);
      }
      form.append(row);return {device:d,enabled,fields};
    });
    let experimental=null;const groups=[];
    if(host.inventory.groups.length){
      const group=el('details');group.className='gpu-corrections';group.append(el('summary','Experimental NVSwitch fabric'));
      group.append(el('p','Whole group only: 8 matching Hopper SXM GPUs + 4 NVSwitch functions. Software does not change CC/PPCIe mode. Physical fabric acceptance is still required.'));
      experimental=check(group,'Enable experimental NVSwitch allocation on this host',host.inventory.experimental_nvswitch);
      for(const g of host.inventory.groups){const confirmed=check(group,`I verified ${g.id} topology and PPCIe mode on the hardware`,g.confirmed&&g.mode==='ppcie');groups.push({id:g.id,confirmed});}
      form.append(group);
    }
    const apply=el('button','Apply GPU configuration');apply.type='submit';apply.className='button secondary';apply.dataset.discovery='true';controls.push(apply);form.append(apply);
    form.append(el('small','Applying changes may briefly restart Nova control services. Descriptive corrections do not change the flavor profile.'));
    form.addEventListener('submit',event=>{
      event.preventDefault();if(busy||host.blockers.length)return;
      try{
        const settings={devices:cards.map(({device,enabled,fields})=>{
          const overrides={...device.overrides};
          if(device.role==='gpu'){
            for(const name of ['model','variant','architecture']){const v=fields[name].value.trim();if(v)overrides[name]=v;else delete overrides[name];}
            if(fields.memory.value.trim()){
              const bytes=Number(fields.memory.value)*2**30;
              if(!Number.isSafeInteger(bytes)||bytes<=0)throw Error('VRAM must be positive and express an exact whole byte count.');
              overrides.memory_bytes=bytes;
            }else delete overrides.memory_bytes;
          }
          return {address:device.address,enabled:enabled.checked,overrides};
        }),groups:groups.map(g=>({id:g.id,confirmed:g.confirmed.checked,mode:g.confirmed.checked?'ppcie':'unknown'})),experimental_nvswitch:experimental?experimental.checked:false};
        if(!confirm(`Apply GPU configuration to ${host.host}? Nova control services may restart briefly, affecting API access cluster-wide. On failure scheduling quarantine requires manual review.`))return;
        submit({kind:'configure',settings});
      }catch(e){status.textContent=e.message;}
    });
    if(host.inventory.devices.length)panel.append(form);
    const discover=el('button','Discover hardware again');discover.type='button';discover.className='button secondary';discover.dataset.discovery='true';controls.push(discover);
    discover.addEventListener('click',()=>{if(confirm('Query idle GPU hardware with gpu-admin-tools? This does not change CC/PPCIe mode.'))submit({kind:'discover'});});
    const discovery=el('details');discovery.className='gpu-corrections';discovery.append(el('summary','Hardware discovery'),el('p','Re-query hardware only on an empty host. This does not change CC mode or device binding.'),discover);
    panel.append(discovery,status);update();
    const saved=sessionStorage.getItem(key);if(saved){section.open=true;try{poll(JSON.parse(saved).request_id);}catch(_){status.textContent='Saved GPU request requires review.';}}
    return section;
  }
  window.SpvmGpus={editor,async catalog(){return (await api('')).hosts;}};
})();
