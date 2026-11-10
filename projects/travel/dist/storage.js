'use strict';
// Server is authoritative after initialization. localStorage remains a recovery copy.
let serverRevision=0, storageReady=false, storageBusy=false, storagePending=false, storageConflict=false;
const syncStatus=document.createElement('button');syncStatus.id='sync-status';syncStatus.textContent='正在连接后端…';document.querySelector('.header-actions').prepend(syncStatus);
function stateSnapshot(){return {points:JSON.parse(JSON.stringify(points)),city:cityValue,meeting:read('travel-meeting',{})}}
async function requestState(method='GET',payload){const response=await fetch('/api/state',{method,headers:{'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});let data;try{data=await response.json()}catch{throw Error('后端未启动，请使用 python server.py 启动')};if(!response.ok){if(response.status===409)storageConflict=true;throw Error(data.error||'后端保存失败')}return data}
function applyServer(state){points=state.points.filter(validPoint);cityValue=state.city;localStorage.setItem('travel-points',JSON.stringify(points));localStorage.setItem('travel-city',JSON.stringify(cityValue));localStorage.setItem('travel-meeting',JSON.stringify(state.meeting));Object.assign(meetingSaved,state.meeting);$('meeting-time').value=state.meeting.time||'';render();$('meeting-point').value=state.meeting.point||'';}
async function flushStorage(){if(!storageReady||storageBusy||storageConflict)return;storageBusy=true;try{while(storagePending){storagePending=false;syncStatus.textContent='正在保存…';const result=await requestState('PUT',{revision:serverRevision,state:stateSnapshot()});serverRevision=result.revision}syncStatus.textContent='已保存到后端'}catch(error){storagePending=true;syncStatus.textContent=storageConflict?'保存冲突：请先导出备份':'后端未保存：点击重试';toast(error.message)}finally{storageBusy=false}}
function queueStorage(){storagePending=true;void flushStorage()}
const localSave=save;save=function(){const result=localSave();queueStorage();return result};
const localSaveMeeting=saveMeeting;saveMeeting=function(){localSaveMeeting();queueStorage()};
syncStatus.onclick=()=>{if(!storageReady){void initializeStorage()}else if(storageConflict){toast('其他页面已修改行程；请先导出当前行程，再刷新加载后端数据')}else{void flushStorage()}};
async function initializeStorage(){const controls=[...document.querySelectorAll('main button,main input,main select')];controls.forEach(e=>e.disabled=true);try{const current=await requestState();serverRevision=current.revision;const local=stateSnapshot();const backup=localStorage.getItem('travel-recovery-before-server');if(!backup)localStorage.setItem('travel-recovery-before-server',JSON.stringify(local));
 // Only an untouched database auto-imports. Existing server records are never overwritten by an old browser cache.
 if(current.revision===0){if(local.points.length||Object.keys(local.meeting).length){await requestState('PUT',{revision:0,state:local});serverRevision=1;syncStatus.textContent='旧行程已迁移到后端'}else{syncStatus.textContent='已连接后端'}}else{applyServer(current.state);syncStatus.textContent='已连接后端'}storageReady=true;storagePending=false;
 }catch(error){syncStatus.textContent='后端未连接：点击重试';toast(error.message)}finally{controls.forEach(e=>e.disabled=!storageReady)}}
window.addEventListener('storage',event=>{if(storageReady&&['travel-points','travel-city','travel-meeting'].includes(event.key)){points=read('travel-points',[]).filter(validPoint);cityValue=read('travel-city','');render();queueStorage()}});
window.addEventListener('beforeunload',event=>{if(storageBusy||storagePending){event.preventDefault();event.returnValue=''}});
void initializeStorage();
