'use strict';
(() => {
  const root=document.getElementById('host-operations');
  if(!root)return;
  let view=0,currentPage=1,snapshot=null;const timers=new Set(),expandedOperations=new Set();
  const prefix='spvm.hostOperation.';
  function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
  async function api(path='',body){
    const response=await fetch('/spvm-api/v1/host-operations'+path,{method:body?'POST':'GET',
      credentials:'same-origin',cache:'no-store',redirect:'error',
      ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const result=await response.json();
    if(!response.ok){const error=new Error(result.error||'Operation review unavailable');error.notAccepted=result.request_accepted===false;error.historyChanged=result.code==='HOST_OPERATION_HISTORY_CHANGED';throw error;}
    return result;
  }
  function saved(key){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch(_){return null;}}
  function row(operation,generation,catalog){
    const panel=el('details');panel.className='host-card operation-card';panel.open=expandedOperations.has(operation.request_id);
    panel.addEventListener('toggle',()=>{if(panel.open)expandedOperations.add(operation.request_id);else expandedOperations.delete(operation.request_id);});
    const heading=el('summary');heading.className='host-heading';
    const identity=el('div');identity.append(el('h3',`${operation.host||'Cloud settings'} — ${operation.action}`));
    const badge=el('span',operation.resolution||operation.status);
    badge.className='badge '+(operation.resolution||operation.status==='SUCCEEDED'?'ready':'blocked');heading.append(identity,badge);
    const content=el('div');content.className='host-content';
    const status=el('p',`${operation.status}${operation.resolution?' · '+operation.resolution:''}`);
    const phase=el('p',operation.phase);const id=el('p',`Request: ${operation.request_id}`);
    if(operation.updated_at)phase.append(document.createTextNode(` · Last recorded update: ${new Date(operation.updated_at*1000).toISOString()}`));
    const message=el('p',operation.message);message.className='request-status';message.setAttribute('role','status');
    if(operation.error_type)phase.append(document.createTextNode(` · ${operation.error_type}`));
    const check=el('button','Check result'),complete=el('button','Complete after verification');
    check.type=complete.type='button';check.className='button secondary';complete.className='button';
    const actions=el('div');actions.className='edit-actions';actions.append(check,complete);
    content.append(status,phase,id,actions,message);panel.append(heading,content);
    const key=prefix+operation.request_id,checkedKey=key+'.checked';
    let pending=Boolean(saved(key)),verified=saved(checkedKey);
    const terminal=Boolean(operation.resolution)||['SUCCEEDED','REFUSED'].includes(operation.status);
    function update(){check.disabled=terminal||pending;complete.disabled=terminal||pending||!verified;}
    async function poll(request){
      if(generation!==view)return;
      try{
        const result=await api('/'+encodeURIComponent(request.request_id));if(generation!==view)return;
        if(window.SpvmResourceRequests.missing(result,message,key))return;
        message.textContent=`${result.status}: ${result.message||''} Review request: ${request.request_id}`;
        if(result.status==='CHECKED'){
          verified={request_id:request.request_id,generation:result.generation,outcome:result.outcome};
          sessionStorage.setItem(checkedKey,JSON.stringify(verified));sessionStorage.removeItem(key);pending=false;
          message.textContent+=` Verified outcome: ${result.outcome}.`;update();
        }else if(['SUCCEEDED','REFUSED'].includes(result.status)){
          sessionStorage.removeItem(key);pending=false;
          if(request.action==='complete'||result.status==='REFUSED'){verified=null;sessionStorage.removeItem(checkedKey);}
          update();
          if(result.status==='SUCCEEDED')window.dispatchEvent(new Event('spvm-hosts-refresh'));
        }else if(result.status!=='REVIEW_REQUIRED'){
          const timer=setTimeout(()=>{timers.delete(timer);poll(request);},5000);timers.add(timer);
        }
      }catch(error){if(generation===view)message.textContent=error.message+` Keep review request ${request.request_id}; check it before another action.`;}
    }
    async function submit(action){
      if(pending||terminal)return;
      if(action==='complete'&&(!verified||!confirm(`Close operation ${operation.request_id} on ${operation.host||'this cloud'}?\nVerified outcome: ${verified.outcome}.\nEvidence will be checked again. Original journals remain; no operation is replayed and scheduling is not enabled.`)))return;
      const request={request_id:crypto.randomUUID(),target_request_id:operation.request_id,action,
        generation:action==='check'?operation.generation:verified.generation,
        check_request_id:action==='check'?null:verified.request_id};
      if(action==='check'){verified=null;sessionStorage.removeItem(checkedKey);}
      sessionStorage.setItem(key,JSON.stringify(request));pending=true;update();
      message.textContent=`Submitting ${action==='check'?'read-only verification':'explicit reviewed completion'}… Review request: ${request.request_id}`;
      try{await api(`?page=${catalog.page}&snapshot=${encodeURIComponent(catalog.snapshot)}`,request);await poll(request);}
      catch(error){
        if(error.notAccepted){sessionStorage.removeItem(key);pending=false;update();}
        message.textContent=error.message+(error.notAccepted?' Request was not accepted.':` Keep review request ${request.request_id}; do not repeat completion.`);
      }
    }
    check.addEventListener('click',()=>submit('check'));complete.addEventListener('click',()=>submit('complete'));
    update();const request=saved(key);if(request&&!terminal)poll(request);
    return panel;
  }
  function pager(catalog){
    const navigation=el('nav');navigation.className='edit-actions operation-pagination';navigation.setAttribute('aria-label','Operation history pages');
    const previous=el('button','Previous'),next=el('button','Next');
    previous.type=next.type='button';previous.className=next.className='button secondary';
    previous.disabled=catalog.page<=1;next.disabled=catalog.page>=catalog.total_pages;
    previous.addEventListener('click',()=>refresh(catalog.page-1));
    next.addEventListener('click',()=>refresh(catalog.page+1));
    const label=el('span',`Page ${catalog.page} of ${catalog.total_pages} · ${catalog.total} operations`);
    navigation.append(previous,label,next);return navigation;
  }
  async function refresh(page=currentPage,latest=false,allowReset=true){
    const generation=++view;for(const timer of timers)clearTimeout(timer);timers.clear();
    if(latest)snapshot=null;
    root.replaceChildren(el('p','Loading operation history…'));
    try{
      const query=`?page=${page}${snapshot?'&snapshot='+encodeURIComponent(snapshot):''}`;
      const catalog=await api(query);if(generation!==view)return;
      if(catalog.schema_version!==2||catalog.capability!=='paginated-host-operations-v1'||catalog.page!==page||!Number.isInteger(catalog.total_pages)
          ||!Number.isInteger(catalog.total)||catalog.total<0||catalog.total>4096||catalog.page_size!==20
          ||catalog.total_pages!==Math.max(1,Math.ceil(catalog.total/20))||page>catalog.total_pages
          ||!Array.isArray(catalog.operations)||catalog.operations.length!==Math.min(20,Math.max(0,catalog.total-(page-1)*20))
          ||typeof catalog.snapshot!=='string'||!(/^[a-f0-9]{64}$/).test(catalog.snapshot))throw new Error('Matching paginated operation history is required.');
      currentPage=catalog.page;snapshot=catalog.snapshot;
      const note=el('p',`Worker catalog observed: ${new Date(catalog.observed_at*1000).toISOString()}. Checking is read-only. Completion never retries a failed operation or clears an unknown partial state.`);
      root.replaceChildren(note,pager(catalog),...catalog.operations.map(operation=>row(operation,generation,catalog)),pager(catalog));
      if(!catalog.operations.length)root.append(el('p','No recorded host operations in this project. This does not cancel requests still awaiting the worker.'));
      if(!allowReset)root.prepend(el('p','History changed. Showing the latest first page; pending review request IDs are retained.'));
    }catch(error){
      if(generation!==view)return;
      if(error.historyChanged&&allowReset){snapshot=null;currentPage=1;return refresh(1,true,false);}
      root.replaceChildren(el('p',error.message+' Existing request IDs and host fences are retained.'));
    }
  }
  window.addEventListener('spvm-hosts-refresh',()=>refresh(1,true));
  document.getElementById('refresh-operations').addEventListener('click',()=>refresh(1,true));
  window.addEventListener('pagehide',()=>{++view;for(const timer of timers)clearTimeout(timer);timers.clear();});
  refresh();
})();
