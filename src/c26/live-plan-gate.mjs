/**
 * C26 LIVE paper plan publication gate.
 * No trade signal may be emitted from FC23/R1494 or from historical C26 CSVs.
 * This validates *only* a plan created after a separate frozen-Python replay.
 * User must still reconcile holdings and confirm broker execution manually.
 */
export const C26_LOCK='C26-EVENT-CORR-LOCK-20261112';
export const C26_ENGINE_SHA='741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5';
const dateLike=x=>/^20\d\d-\d\d-\d\d$/.test(x||'');
const codeLike=x=>/^\d{4,6}$/.test(String(x??''));
const fail=reason=>({ok:false,reason,plan:null});

export function validateC26NextDayPlan(p,coverage){
 if(!p||typeof p!=='object')return fail('no frozen Python paper plan was published');
 if(!coverage||coverage.state!=='source_staged'||coverage.checkpoint_ohlc_parity?.pass!==true)return fail('FinMind source/10-27 overlap is incomplete');
 if(p.model_version!=='C26'||p.lock_id!==C26_LOCK||p.simulator_sha256!==C26_ENGINE_SHA)return fail('wrong frozen C26 code/version');
 if(p.engine!=='frozen_python_c26' || p.strategy_source!=='original_C26_LOCK' ||
    p.fc23_reused===true ||p.r1494a_reused===true)return fail('unverified or borrowed strategy engine');
 if(p.historical_replay?.days!==1407||p.historical_replay?.orders!==1758||
    p.historical_replay?.passed!==true||
    Math.abs(p.historical_replay.net_return_pct-1720.495844396837)>1e-7 ||
    Math.abs(p.historical_replay.max_drawdown_pct+17.989769234703846)>1e-7)return fail('frozen historical parity not passed');
 const date=coverage.full_market_last_verified;
 if(!dateLike(p.signal_as_of)||p.signal_as_of!==date||!dateLike(p.trade_date)||
    p.trade_date!==coverage.next_exchange_trade_date)return fail('signal or exchange trade date does not match completed market feed');
 if(p.trade_date<=p.signal_as_of)return fail('future trading day missing or invalid');
 const d=p.forward_replay;
 if(!d || d.first_date!=='2026-10-28'||d.last_date!==date || d.complete!==true ||
    !Number.isInteger(d.trading_days)||d.trading_days<12 || !Array.isArray(d.verified_dates) ||
    d.verified_dates.length!==d.trading_days || d.verified_dates[0]!==d.first_date ||
    d.verified_dates.at(-1)!==date ||new Set(d.verified_dates).size!==d.verified_dates.length ||
    d.verified_dates.some((x,i)=>!dateLike(x)||(i>0&&x<=d.verified_dates[i-1])))return fail('continuous forward replay not independently verified');
 if(p.factors?.full_parity!==true||p.factors?.causal_previous_close!==true||
    p.positions?.inventory_parity!==true ||p.positions?.cash_parity!==true ||
    p.orders_frozen_same_day_check!==true) return fail('factor/portfolio/order parity missing');
 if(p.transaction_cost_roundtrip_pct!==0.5855||
    !Array.isArray(p.actions)||!Array.isArray(p.positions?.holdings)||
    p.positions.holdings.length>8||
    p.positions.holdings.some(x=>!codeLike(x.stock_id)||!Number.isFinite(x.quantity)||x.quantity<0))return fail('fees, holdings or order schema invalid');
 if(!Number.isFinite(p.positions.cash_ntd)||p.positions.cash_ntd<0||
    !Number.isFinite(p.positions.equity_ntd)||p.positions.equity_ntd<=0)return fail('account balances missing');
 const allowed=new Set(['BUY','SELL','HOLD','TOPUP','TRIM','NO_ACTION']);
 if(p.actions.some(x=>!allowed.has(x.action)|| (x.action!=='NO_ACTION'&&!codeLike(x.stock_id)) ||
     !dateLike(x.signal_date)||x.signal_date!==p.signal_as_of ||
     !dateLike(x.execute_date)||x.execute_date!==p.trade_date ||
     (x.action==='BUY'&&(!Number.isFinite(x.notional_ntd)||x.notional_ntd<10000)) ||
     (['BUY','SELL'].includes(x.action)&&(!Number.isFinite(x.limit_or_stop_ntd)||x.limit_or_stop_ntd<=0))))return fail('unexecutable or misdated order');
 if(new Set(p.actions.filter(x=>x.action!=='NO_ACTION').map(x=>x.action+':'+x.stock_id)).size!==p.actions.filter(x=>x.action!=='NO_ACTION').length)
  return fail('duplicate same-side stock order');
 return {ok:true,reason:null,plan:{...p,readiness:'ready_for_manual_review',live_trading_enabled:false,broker_orders_submitted:false}};
}
