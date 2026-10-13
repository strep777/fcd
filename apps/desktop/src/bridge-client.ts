import {desktopClient,type DesktopTransport} from '../../../packages/api/client';
const transport=(window as unknown as {fpcadTransport:DesktopTransport}).fpcadTransport;
Object.defineProperty(window,'fpcad',{value:desktopClient(transport),writable:false,configurable:false});
