/* Backward-compatible C30 native dashboard adapter. All new queries use Free sources.
 * Never issue a no-data_id all-market FinMind request on a Free plan.
 */
import {c30FreeToken,c30FreeStatus,c30FreeSummary,updateC30A56Free,stopC30FreeSync,c30FreeDownloadDay} from './free-sync.mjs?v=20261125-sponsor-diagnose-v5';
export const c30DeviceToken=c30FreeToken;
export const readC30StoredStatus=c30FreeStatus;
export const c30StatusSummary=c30FreeSummary;
export const syncC30FinMind=updateC30A56Free;
export const stopC30Sync=stopC30FreeSync;
export const readC30FreeDay=c30FreeDownloadDay;
