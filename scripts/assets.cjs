const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {PNG}=require('pngjs');
// Fit the visible badge, not the source canvas. Keep a 3% optical margin
// around the solid artwork and fade only the outer shadow at the crop edge.
function fitArtwork(source){
  let left=source.width,top=source.height,right=-1,bottom=-1;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    if(source.data[(y*source.width+x)*4+3]<128)continue;
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<left)throw Error('Logo source has no visible artwork');
  const side=Math.ceil(Math.max(right-left+1,bottom-top+1)/.94);
  const originX=Math.floor((left+right+1-side)/2),originY=Math.floor((top+bottom+1-side)/2);
  const result=new PNG({width:side,height:side}),fade=side*.012;
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const sx=x+originX,sy=y+originY;
    if(sx<0||sy<0||sx>=source.width||sy>=source.height)continue;
    const src=(sy*source.width+sx)*4,dst=(y*side+x)*4;
    source.data.copy(result.data,dst,src,src+4);
    const edge=Math.min(x,y,side-1-x,side-1-y);
    result.data[dst+3]=Math.round(result.data[dst+3]*Math.min(1,edge/fade));
  }
  return result;
}
// Area-average in premultiplied alpha so the supplied artwork keeps clean
// transparent edges when Windows displays the icon at small sizes.
function resizeIcon(source,size){
  const result=new PNG({width:size,height:size});
  const scaleX=source.width/size,scaleY=source.height/size;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const left=x*scaleX,right=(x+1)*scaleX,top=y*scaleY,bottom=(y+1)*scaleY;
    let r=0,g=0,b=0,alpha=0;
    for(let sy=Math.floor(top);sy<Math.ceil(bottom)&&sy<source.height;sy++){
      const wy=Math.min(bottom,sy+1)-Math.max(top,sy);
      for(let sx=Math.floor(left);sx<Math.ceil(right)&&sx<source.width;sx++){
        const weight=wy*(Math.min(right,sx+1)-Math.max(left,sx));
        const index=(sy*source.width+sx)*4,a=source.data[index+3]/255*weight;
        alpha+=a;r+=source.data[index]*a;g+=source.data[index+1]*a;b+=source.data[index+2]*a;
      }
    }
    const index=(y*size+x)*4;
    result.data[index]=alpha?Math.round(r/alpha):0;
    result.data[index+1]=alpha?Math.round(g/alpha):0;
    result.data[index+2]=alpha?Math.round(b/alpha):0;
    result.data[index+3]=Math.round(alpha/(scaleX*scaleY)*255);
  }
  return PNG.sync.write(result);
}
async function main(){
  const root=path.join(__dirname,'../assets');await fs.mkdir(path.join(root,'ocr'),{recursive:true});
  const source=PNG.sync.read(await fs.readFile(path.join(root,'logo-source.png')));
  if(source.width!==source.height)throw Error('Logo source must be square');
  const artwork=fitArtwork(source);
  await fs.writeFile(path.join(root,'icon.png'),resizeIcon(artwork,1024));
  // Windows title bar/tray/taskbar sizes at 100–400% scaling, plus 128px.
  const sizes=[16,20,24,30,32,36,40,48,60,64,72,80,96,128,256],images=sizes.map(size=>resizeIcon(artwork,size));
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
  let offset=header.length;
  for(let i=0;i<sizes.length;i++){
    const entry=6+i*16;header[entry]=header[entry+1]=sizes[i]===256?0:sizes[i];
    header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);
    header.writeUInt32LE(images[i].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[i].length;
  }
  await fs.writeFile(path.join(root,'icon.ico'),Buffer.concat([header,...images]));
  const manifest={};
  for(const lang of ['eng','chi_sim']){
    const dest=path.join(root,'ocr',lang+'.traineddata.gz');
    try {await fs.access(dest);}catch{
      console.log('Bundling offline OCR model:',lang);
      const model=require(`@tesseract.js-data/${lang}`);
      const bytes=await fs.readFile(path.join(model.langPath,lang+'.traineddata.gz'));if(bytes[0]!==31||bytes[1]!==139)throw Error('模型文件格式错误');
      await fs.writeFile(dest+'.tmp',bytes);await fs.rename(dest+'.tmp',dest);
    }
    const bytes=await fs.readFile(dest);manifest[lang]={sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  }
  await fs.writeFile(path.join(root,'models.json'),JSON.stringify(manifest,null,2));console.log('Icons and offline OCR models ready.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
