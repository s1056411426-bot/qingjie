'use strict';
const { PNG } = require('pngjs');
function cropRect(rect, logical, pixels) {
  if (!rect || !['x','y','width','height'].every(k => Number.isFinite(rect[k]))) throw Error('无效选区');
  const x = Math.max(0, Math.min(pixels.width - 1, Math.round(rect.x * pixels.width / logical.width)));
  const y = Math.max(0, Math.min(pixels.height - 1, Math.round(rect.y * pixels.height / logical.height)));
  const right = Math.max(x + 1, Math.min(pixels.width, Math.round((rect.x + rect.width) * pixels.width / logical.width)));
  const bottom = Math.max(y + 1, Math.min(pixels.height, Math.round((rect.y + rect.height) * pixels.height / logical.height)));
  if (rect.width < 2 || rect.height < 2) throw Error('选区至少为 2 × 2 像素');
  return { x, y, width: right - x, height: bottom - y };
}
// Compare the bottom of the previous frame with the top of the next frame.
// Flat or ambiguous overlaps are rejected, avoiding silent duplicate/missing text.
function findShift(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { kind: 'mismatch' };
  const w = a.width, h = a.height;
  const xs = Array.from({length: Math.min(48, w)}, (_, i) => Math.min(w-1, Math.floor((i+.5)*w/Math.min(48,w))));
  function score(d, detailed = false) {
    const overlap = h-d, rows = Math.min(detailed ? 64 : 20, overlap);
    let error=0, count=0, sum=0, sq=0;
    for (let r=0;r<rows;r++) {
      const y=Math.min(overlap-1, Math.floor((r+.5)*overlap/rows));
      for (const x of xs) for (let c=0;c<3;c++) {
        const av=a.data[((y+d)*w+x)*4+c], bv=b.data[(y*w+x)*4+c];
        error+=Math.abs(av-bv); sum+=av; sq+=av*av; count++;
      }
    }
    return { shift:d, score:error/count, variance:sq/count-(sum/count)**2 };
  }
  if (score(0,true).score < .8) return { kind:'same', shift:0 };
  const minOverlap=Math.max(24,Math.floor(h*.18));
  let candidates=[];
  // Full integer search retains pixel-level accuracy even on text and thin rules.
  for (let d=2;d<=h-minOverlap;d++) candidates.push(score(d));
  candidates.sort((x,y)=>x.score-y.score);
  const best=candidates.slice(0,8).map(c=>score(c.shift,true)).sort((x,y)=>x.score-y.score)[0];
  if (!best || best.score>8 || best.variance<36) return { kind:'unmatched' };
  const alternative=candidates.find(c=>Math.abs(c.shift-best.shift)>3);
  if (alternative && alternative.score <= best.score + .15) return { kind:'ambiguous' };
  return {kind:'append', ...best};
}
function appendFrame(base, next, shift) {
  if (!Number.isInteger(shift) || shift < 1 || shift > next.height || base.width !== next.width) throw Error('无效拼接尺寸');
  const height=base.height+shift;
  if (height>24000 || height*base.width>60000000) throw Error('已达到长图大小上限，请先保存当前长图');
  const out=new PNG({width:base.width,height});
  base.data.copy(out.data);
  next.data.copy(out.data,base.data.length,(next.height-shift)*next.width*4);
  return out;
}
function safeImage(data) {
  if (typeof data!=='string' || data.length>100*1024*1024 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)) throw Error('无效图片');
  const bytes=Buffer.from(data.split(',')[1],'base64');
  if (bytes.length<24 || bytes.toString('hex',0,8)!=='89504e470d0a1a0a') throw Error('无效 PNG 图片');
  const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
  if (!w || !h || w*h>60000000 || w>30000 || h>30000) throw Error('图片过大，最多 6000 万像素');
  return bytes;
}
module.exports={cropRect,findShift,appendFrame,safeImage};
