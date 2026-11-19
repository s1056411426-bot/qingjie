import {iconpark} from './iconpark-data.js';
export const icon=(name,size=20)=>{
  const svg=iconpark[name];
  if(!svg)throw new Error('Unknown UI icon: '+name);
  const px=Number(size);
  if(!Number.isFinite(px)||px<=0)throw new Error('Invalid icon size');
  return svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" data-iconpark="'+name+'" ').replace('width="20" height="20"','width="'+px+'" height="'+px+'"');
};
export const esc=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
