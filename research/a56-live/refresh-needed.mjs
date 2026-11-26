/** Decide from verified dates, not just a page's queued flag. No credentials. */
export function refreshDecision({event,cron,queue,status,c30,now=new Date()}){
 const local=new Date(now.getTime()+8*3600000).toISOString();
 const through=local.slice(11,16)>='20:00'?local.slice(0,10):new Date(Date.parse(local.slice(0,10)+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const yes=reason=>({proceed:true,reason,requested_through:through});
 if(event!=='schedule')return yes('explicit_run');
 if(['50 13 * * 1-5','30 23 * * 0-4'].includes(cron))return yes('daily_refresh');
 if(c30?.signalDate && c30.sourceDate && c30.signalDate<c30.sourceDate)
  return yes('c30_behind_verified_source');
 if(!queue||!status||status.model_version!=='A56')return yes('status_unavailable_retry_source');
 if(['queued','running','failed','unavailable'].includes(queue.state))return yes('pending_or_failed_request');
 const source=status.source,account=status.model_archive;
 if(!source?.as_of||!source.next_trade_date||!account?.as_of)return yes('coverage_unverified');
 if(account.as_of<source.as_of)return yes('account_behind_verified_source');
 // Use the exchange calendar's next trade date. Weekends/holidays do not
 // repeatedly refetch a market session that does not exist.
 if(source.next_trade_date<=through)return yes('next_completed_session_due');
 return {proceed:false,reason:'account_and_source_current',requested_through:through};
}
