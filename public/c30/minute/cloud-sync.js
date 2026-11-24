/* C30 cloud archive client. The access secret stays in this browser only. */
window.C30Cloud={
 key(){return localStorage.getItem('C30_ARCHIVE_KEY')||sessionStorage.getItem('C30_ARCHIVE_KEY')||''},
 setKey(value,remember){const k=String(value||'').trim();localStorage.removeItem('C30_ARCHIVE_KEY');sessionStorage.removeItem('C30_ARCHIVE_KEY');if(k)(remember?localStorage:sessionStorage).setItem('C30_ARCHIVE_KEY',k)},
 clearKey(){localStorage.removeItem('C30_ARCHIVE_KEY');sessionStorage.removeItem('C30_ARCHIVE_KEY')},
 async call(path,method='GET',data=null){const k=this.key();if(!k)throw Error('請先在 /c30/archive/ 輸入雲端封存金鑰');const init={method,cache:'no-store',headers:{'x-c30-archive-key':k}};if(data!==null){init.headers['content-type']='application/json';init.body=JSON.stringify(data)}const r=await fetch('/api/c30/archive/'+path,init);const j=await r.json();if(!r.ok||j.ok===false)throw Error(j.error||j.code||'ARCHIVE_HTTP_'+r.status);return j},
 status(){return this.call('status')},
 coverage(since='2020-01-01'){return this.call('coverage?since='+encodeURIComponent(since))},
 async saveBars(code,market,result){if(!Array.isArray(result?.bars)||!result.bars.length)return {ok:false,error:'NO_BARS'};return this.call('bars','POST',{code,market,provider:result.provider,bars:result.bars})}
};
