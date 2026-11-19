const path=require('node:path');
const {build,Platform,Arch}=require('electron-builder');
build({targets:Platform.WINDOWS.createTarget('portable',Arch.x64),publish:'never',config:{electronDist:path.dirname(require('electron'))}}).then(files=>console.log(files.join('\n'))).catch(e=>{console.error(e);process.exitCode=1;});
