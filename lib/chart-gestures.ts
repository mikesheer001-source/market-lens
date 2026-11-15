/** Axis drag scales exponentially, avoiding zero or negative ranges. */
export function priceScaleFromDrag(startScale:number, deltaY:number):number {
  if (!Number.isFinite(startScale) || !Number.isFinite(deltaY)) return 1;
  return Math.max(0.05, Math.min(20, startScale * Math.exp(deltaY / 200)));
}

/** Zoom around the center of the current visible interval. */
export function timeScaleFromDrag(startCount:number, startEnd:number, deltaX:number, total:number) {
  if (![startCount,startEnd,deltaX,total].every(Number.isFinite) || total <= 0) return {count:1,end:0};
  const count = Math.max(Math.min(15,total), Math.min(total, Math.round(startCount * Math.exp(-deltaX / 180))));
  const center = startEnd - Math.min(startCount,total) / 2;
  const end = startEnd >= total ? total : Math.max(count, Math.min(total, Math.round(center + count / 2)));
  return {count,end};
}
