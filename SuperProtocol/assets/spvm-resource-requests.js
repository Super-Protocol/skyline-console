'use strict';
(() => {
  // NOT_FOUND is not permission to repeat an operation. Forget only the local
  // browser record after a separate operator decision; never resubmit here.
  function missing(result, message, key) {
    if (result.status !== 'NOT_FOUND') return false;
    const id=result.request_id;
    message.textContent=`NOT_FOUND: ${result.message || 'No request or result is recorded in the current project.'} Request: ${id} `;
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='button secondary';
    dismiss.textContent='Dismiss local request';
    dismiss.addEventListener('click',()=>{
      if(!confirm(`Forget only this browser's saved request ${id}? No server operation will be cancelled or repeated. Review any uncertain previous application before submitting a new change.`))return;
      // Do not erase a newer request installed by another view in this tab.
      try{if(JSON.parse(sessionStorage.getItem(key)||'null')?.request_id!==id)return;}catch(_){return;}
      sessionStorage.removeItem(key);
      window.dispatchEvent(new Event('spvm-hosts-refresh'));
    });
    message.append(dismiss);return true;
  }
  window.SpvmResourceRequests={missing};
})();
