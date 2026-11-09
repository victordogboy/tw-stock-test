// P193 preopen h/w 1:1 causal port of archived Python p193_preopen_features.py.
// Inputs must be previously COMPLETED sessions, including P40 realized PnL.
// The source of P40 & R26 core is NOT reconstructed here; paper research ONLY.
const sum=a=>a.reduce((p,n)=>p+n,0);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const floorStep=(n,step)=>Math.floor(n/step+1e-8)*step;
const bankRound=x=>{const a=Math.floor(x),f=x-a;return f<.5?a:f>.5?a+1:(a%2===0?a:a+1);};
const round8=x=>Number(x.toFixed(8));
export function p193Weights(atr20,session,priorP40Pnl,priorMarketMoves){
 if(!finite(atr20)||atr20<=0)throw Error('P193_ 20-period ATR must be finite and positive');
 if(!['day','night'].includes(session))throw Error('P193 invalid session');
 if(!Array.isArray(priorP40Pnl)||!Array.isArray(priorMarketMoves)||
    priorP40Pnl.length!==priorMarketMoves.length||priorP40Pnl.length<60||
    !priorP40Pnl.every(finite)||!priorMarketMoves.every(finite))
  throw Error('P193 requires ≥60 aligned verified completed P40/market sessions');
 const roll=(array,count)=>sum(array.slice(-count));
 const p5=roll(priorP40Pnl,5),p15=roll(priorP40Pnl,15);
 let w41=floorStep(Math.min(.4,300/atr20),.1);
 if(p5< -400)w41=0;
 const w174=floorStep(w41*1.25,.05);
 const w=Math.max(0,Math.min(.8,floorStep(w174+(p15/atr20>1.507?.1:0)+(atr20<181.43?.35:0),.05)));
 const night=session==='night',m20=roll(priorMarketMoves,20),m30=roll(priorMarketMoves,30),
   m15=roll(priorMarketMoves,15),m8=roll(priorMarketMoves,8),m60=roll(priorMarketMoves,60);
 let h=0;
 if(atr20>=1000&&m20>.25*atr20)h-=.4;
 if(atr20>=300&&m30<-.25*atr20&&!night)h-=.3;
 if(m15< -3*atr20)h+=.4;
 if(m15>.5*atr20&&atr20>=600&&!night)h-=.4;
 if(m8< -2*atr20&&night)h+=.3;
 if(m60>6.861*atr20&&night)h-=.6;
 h=bankRound(Math.max(-(1-w),Math.min(1-w,h))/.05)*.05;
 return {w:round8(w),h:round8(h),atr20,source:'P193 CAUSAL RECONSTRUCTION (requires externally verified P40 pnl)',paper_only:true,
   input_completed_sessions:priorP40Pnl.length};
}
