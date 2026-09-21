/* R21: keep the original Hold / Action scores unchanged.
   The separate change metric adds today's volume confirmation points to raw ΔHold.
   Current volume is projected intraday, actual after close; prior volume is actual. */
(function(root){
  'use strict';
  const schema='hold-change-r21';
  const valid=Number.isFinite;
  function calculate(current,previous,currentVolume,previousVolume){
    const holdDelta=valid(current?.hold)&&valid(previous?.hold)?current.hold-previous.hold:null;
    const holdVolumeRatio=valid(currentVolume)&&currentVolume>=0&&valid(previousVolume)&&previousVolume>0
      ?currentVolume/previousVolume:null;
    const holdVolumeBonus=holdVolumeRatio===null?null:
      holdVolumeRatio>=2?10:holdVolumeRatio>=1.5?7:holdVolumeRatio>=1.2?4:holdVolumeRatio<0.6?-4:0;
    return {
      holdDelta,holdVolumeRatio,holdVolumeBonus,
      holdVolumeChangePct:holdVolumeRatio===null?null:(holdVolumeRatio-1)*100,
      holdVolumeDelta:holdDelta===null||holdVolumeBonus===null?null:holdDelta+holdVolumeBonus
    };
  }
  function signed(value,digits=0){
    if(!valid(value))return '—';
    const rounded=Number(value.toFixed(digits));
    return (rounded>0?'+':'')+rounded.toFixed(digits);
  }
  function volumeText(change,projected=false){
    if(!valid(change?.holdVolumeRatio))return '前一交易日成交量不足，暫無法比較';
    return `${projected?'預估量':'成交量'}較前交易日 ${signed(change.holdVolumeChangePct,1)}%（${change.holdVolumeRatio.toFixed(2)}×）｜量能 ${signed(change.holdVolumeBonus)} 分`;
  }
  root.TWHoldChange={schema,calculate,signed,volumeText};
})(globalThis);
