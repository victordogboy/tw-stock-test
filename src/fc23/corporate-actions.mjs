/**
 * Confirmed, date-scoped cash capital reduction. Never treat an arbitrary >25%
 * jump as a corporate action. The money and new shares must both enter the
 * simulated account; merely allowing the new OHLC would fabricate profit.
 * Announcement: https://m.moneydj.com/f1a.aspx?a=80E8B6EA-1B62-4870-93F1-6CCE1D660ED1
 */
export const ENNOSTAR_3714 = Object.freeze({
  code:'3714', date:'2026-11-16', oldSharesPerThousand:1000,
  newSharesPerThousand:542.0491512,
  cashPerOldShare:4.579508488,
  source:'https://m.moneydj.com/f1a.aspx?a=80E8B6EA-1B62-4870-93F1-6CCE1D660ED1'
});
const ratio=ENNOSTAR_3714.newSharesPerThousand/1000;
const cash=ENNOSTAR_3714.cashPerOldShare;
const scaleArray=(array,mul)=>{if(Array.isArray(array))for(let i=0;i<array.length;i++)if(Number.isFinite(array[i]))array[i]*=mul};

/** Apply once to an isolated copy, before validation, feature and execution.
 * `oldClose` is mandatory for accounts that do not store raw stock features.
 */
export function apply3714CashReduction(state, tradeDate, oldClose=null) {
  if(tradeDate!==ENNOSTAR_3714.date||!state?.codes?.includes(ENNOSTAR_3714.code))return null;
  state.corporateActionsApplied??={};
  const key=tradeDate+':'+ENNOSTAR_3714.code;
  if(state.corporateActionsApplied[key])return null;
  const stock=state.stocks?.[ENNOSTAR_3714.code];
  const prior=stock?.p??oldClose;
  if(!(Number.isFinite(prior)&&prior>cash))throw Error('3714 減資前最後成交價缺漏，禁止推估權益');
  // A backward price scale makes the last old close equal to its cash-adjusted
  // new-share equivalent. It is used only for indicator continuity.
  const factor=(prior-cash)/(ratio*prior);
  if(!(factor>0.5&&factor<5))throw Error('3714 減資價格調整倍率異常');
  if(stock){
    scaleArray(stock.c,factor);
    scaleArray(stock.pc,factor);
    scaleArray(stock.e,factor);
    scaleArray(stock.tr,factor);
    scaleArray(stock.v,ratio); // old-volume shares expressed as new shares
    for(const chip of stock.chips||[])if(chip)for(const k of ['volume','foreign','trust','hedge','margin','short'])if(Number.isFinite(chip[k]))chip[k]*=ratio;
    stock.p*=factor;
    for(let i=0;i<(state.marketCodes||[]).length;i++)if(state.marketCodes[i]==='3714'&&Number.isFinite(state.marketBase?.[i]))state.marketBase[i]*=factor;
  }
  const j=state.codes.indexOf('3714'),qty=state.qty?.[j]||0;
  if(qty>0){
    const distributed=qty*cash;
    if(!(state.basis?.[j]>cash))throw Error('3714 持倉成本無法在減資後對帳');
    state.cash+=distributed;
    state.qty[j]=qty*ratio;
    state.basis[j]=(state.basis[j]-cash)/ratio;
    if(state.firstPrices?.['3714']>cash)state.firstPrices['3714']=(state.firstPrices['3714']-cash)/ratio;
  }
  if(state.peak?.[j]>0)state.peak[j]*=factor;
  if(state.watchPrice?.[j]>0)state.watchPrice[j]*=factor;
  const entry={...ENNOSTAR_3714,oldClose:prior,referenceNewSharePrice:prior*factor,priceScale:factor,
    oldQuantity:qty,newQuantity:qty*ratio,cashDistribution:qty*cash};
  state.corporateActionsApplied[key]=entry;
  return entry;
}
