'use strict';
(() => {
  const root=document.getElementById('host-operations');
  if(!root)return;
  let view=0;const timers=new Set();
  const prefix='spvm.hostOperation.';
  function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
  async function api(path='',body){
    const response=await fetch('/spvm-api/v1/host-operations'+path,{method:body?'POST':'GET',
      credentials:'same-origin',cache:'no-store',redirect:'error',
      ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const result=await response.json();
    if(!response.ok){const error=new Error(result.error||'Operation review unavailable');error.notAccepted=result.request_accepted===false;throw error;}
    return result;
  }
  function saved(key){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch(_){return null;}}
  function row(operation,generation){
    const panel=el('article');panel.className='host-card';
    const heading=el('h3',`${operation.host||'Cloud settings'} — ${operation.action}`);
    const status=el('p',`${operation.status}${operation.resolution?' · '+operation.resolution:''}`);
    const phase=el('p',operation.phase);const id=el('p',`Request: ${operation.request_id}`);
    if(operation.updated_at)phase.append(document.createTextNode(` · Last recorded update: ${new Date(operation.updated_at*1000).toISOString()}`));
    const message=el('p',operation.message);message.className='request-status';message.setAttribute('role','status');
    if(operation.error_type)phase.append(document.createTextNode(` · ${operation.error_type}`));
    const check=el('button','Check result'),complete=el('button','Complete after verification');
    check.type=complete.type='button';check.className='button secondary';complete.className='button';
    const actions=el('div');actions.className='edit-actions';actions.append(check,complete);
    panel.append(heading,status,phase,id,actions,message);
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
      try{await api('',request);await poll(request);}
      catch(error){
        if(error.notAccepted){sessionStorage.removeItem(key);pending=false;update();}
        message.textContent=error.message+(error.notAccepted?' Request was not accepted.':` Keep review request ${request.request_id}; do not repeat completion.`);
      }
    }
    check.addEventListener('click',()=>submit('check'));complete.addEventListener('click',()=>submit('complete'));
    update();const request=saved(key);if(request&&!terminal)poll(request);
    return panel;
  }
  async function refresh(){
    const generation=++view;for(const timer of timers)clearTimeout(timer);timers.clear();
    root.replaceChildren(el('p','Loading operation history…'));
    try{
      const catalog=await api();if(generation!==view)return;
      const note=el('p',`Worker catalog observed: ${new Date(catalog.observed_at*1000).toISOString()}. Checking is read-only. Completion never retries a failed operation or clears an unknown partial state.`);
      root.replaceChildren(note,...catalog.operations.map(operation=>row(operation,generation)));
      if(!catalog.operations.length)root.append(el('p','No recorded host operations in this project. This does not cancel requests still awaiting the worker.'));
    }catch(error){if(generation===view)root.replaceChildren(el('p',error.message+' Existing request IDs and host fences are retained.'));}
  }
  window.addEventListener('spvm-hosts-refresh',refresh);
  document.getElementById('refresh-operations').addEventListener('click',refresh);
  window.addEventListener('pagehide',()=>{++view;for(const timer of timers)clearTimeout(timer);timers.clear();});
  refresh();
})();
