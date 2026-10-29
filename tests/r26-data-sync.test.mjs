import test from "node:test";
import assert from "node:assert/strict";
import {taipeiParts,dayShift,nextRegularDay,referenceTxMonth,buildPhysicalSessions,summarizeCoverage} from "../public/r26-data-sync.mjs";
test("Taipei trading day and active contract are correct on 2026-10-29",()=>{
 const now=new Date("2026-10-29T18:20:00+08:00");
 assert.equal(taipeiParts(now).date,"2026-10-29");
 assert.equal(referenceTxMonth("2026-10-29"),"202611");
 assert.equal(nextRegularDay("2026-10-29"),"2026-10-30");
 const sessions=buildPhysicalSessions("2026-10-28",now);
 const latest=sessions.at(-1);
 assert.equal(latest.key,"night:2026-10-29");
 assert.equal(latest.tradeDate,"2026-10-30");
 assert.equal(latest.elapsed,200);
 assert.equal(latest.complete,false);
});
test("post-midnight Friday night remains one physical session with Monday trade-date estimate",()=>{
 const now=new Date("2026-10-31T03:00:00+08:00");
 const night=buildPhysicalSessions("2026-10-30",now).find(x=>x.key==="night:2026-10-30");
 assert.ok(night);
 assert.equal(night.tradeDate,"2026-11-02");
 assert.equal(night.elapsed,720);
});
test("contract isolation and missing bars are not treated as confirmed current strategy state",()=>{
 const now=new Date("2026-10-29T18:20:00+08:00");
 const sessions=buildPhysicalSessions("2026-10-29",now);
 const bars=[
  {timestamp_tpe:"2026-10-29 08:45:00",contract_date:"202611",session_key:"day:2026-10-29"},
  {timestamp_tpe:"2026-10-29 13:44:00",contract_date:"202611",session_key:"day:2026-10-29"},
  {timestamp_tpe:"2026-10-29 18:19:00",contract_date:"202612",session_key:"night:2026-10-29"}
 ];
 const result=summarizeCoverage(bars,sessions,"202611");
 assert.equal(result.find(x=>x.key==="day:2026-10-29").count,2);
 const night=result.find(x=>x.key==="night:2026-10-29");
 assert.equal(night.count,0);
 assert.equal(night.gapEstimate,200);
 assert.equal(night.tradeDateVerified,false);
 assert.equal(dayShift("2026-10-29",1),"2026-10-30");
});
