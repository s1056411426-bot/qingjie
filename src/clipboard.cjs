const{clipboard,ClipboardItem,nativeImage}=require('electron');
async function writeImage(image){await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(image.toPNG())],{type:'image/png'})})]);}
async function readImage(){for(const item of await clipboard.read()){for(const type of ['image/png','image/jpeg','image/bmp']){if(item.types.includes(type)){const blob=await item.getType(type);const image=nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));if(!image.isEmpty())return image;}}}return nativeImage.createEmpty();}
module.exports={writeImage,readImage};
