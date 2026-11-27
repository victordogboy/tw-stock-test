const iso = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value);
const number = value => typeof value === 'number' && Number.isFinite(value);

export function verifiedC30Forward(forward, history) {
 if (!forward || forward.lock_id !== history.lock_id || forward.anchor !== history.as_of
     || forward.readiness !== 'verified_replay' || forward.no_execution_prices !== true
     || forward.anchor_days !== history.dates.length || !iso(forward.signal_date) || !iso(forward.trade_date)
     || forward.trade_date <= forward.signal_date || !number(forward.target) || forward.target < 0 || forward.target > 1.000001
     || !Array.isArray(forward.snapshots) || !forward.snapshots.length || !Array.isArray(forward.replayed_dates)
     || !Array.isArray(forward.engine_plan) || !Array.isArray(forward.orders)) return false;
 const dates = forward.snapshots.map(row => row.date);
 if (dates.length !== forward.replayed_dates.length || dates.at(-1) !== forward.signal_date
     || dates.some((date, i) => !iso(date) || date !== forward.replayed_dates[i] || date <= (dates[i-1] || history.as_of))) return false;
 if (forward.snapshots.some(row => ![row.nav,row.cash,row.core,row.side,row.target,row.benchmark].every(number)
     || row.nav <= 0 || row.cash < 0 || row.core < 0 || row.side < 0 || row.benchmark <= 0
     || Math.abs(row.nav - row.cash - row.core - row.side) > 1e-8
     || !Array.isArray(row.holdings) || !Number.isInteger(row.coreCount) || !Number.isInteger(row.sideCount)
     || row.holdings.length !== row.coreCount + row.sideCount || row.holdings.length > 8
     || row.holdings.some(h => !/^\d{4}$/.test(h.code) || ![h.q,h.p,h.entry].every(number) || Math.min(h.q,h.p,h.entry) <= 0)
     || Math.abs(row.holdings.reduce((sum,h) => sum + h.q*h.p,0) - row.core - row.side) > 1e-8)) return false;
 if (forward.engine_plan.some(order => !/^\d{4}$/.test(order.code)
     || !['core','reversal'].includes(order.sleeve) || typeof order.method !== 'string'
     || ['open','high','low','close','filled','price'].some(key => Object.hasOwn(order,key)))) return false;
 // Never advance the verified forward ledger with a reversal fill whose execution
 // minute is missing, or with inconsistent normalized quantities/notional.
 // This is an integrity gate, NOT a substitute for independent market-data replay.
 const calendar = [...history.dates, ...dates];
 return forward.orders.every(order => dates.includes(order.date) && iso(order.signal) && order.signal === calendar[calendar.indexOf(order.date)-1]
   && /^\d{4}$/.test(order.code) && ['BUY','SELL'].includes(order.side) && typeof order.filled === 'boolean'
   && (!order.filled || (number(order.price) && order.price > 0 && number(order.quantity) && order.quantity > 0
      && number(order.notional) && order.notional > 0 && Math.abs(order.price*order.quantity-order.notional)<1e-9
      && (order.sleeve!=='reversal'||(Number.isInteger(order.minute)&&order.minute>=0&&order.minute<=270)))));
}

export function c30PlanMode(plan, now = Date.now()) {
 if (!plan) return 'blocked';
 const local = new Date(now + 8 * 3600000).toISOString();
 const today = local.slice(0,10);
 return plan.trade_date < today || (plan.trade_date === today && local.slice(11,16) >= '13:30') ? 'historical' : 'ready';
}
