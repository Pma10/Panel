import { createConnection } from "node:net";
const encodeVarint = (num) => {
  const bytes=[];let value=num>>>0;
  do{let b=value&0x7f;value>>>=7;if(value)b|=0x80;bytes.push(b);}while(value);
  return Buffer.from(bytes);
};
const decodeVarint = (buffer,offset=0) => {
  let result=0,shift=0;
  for(let i=0;i<5;i++){
    if(offset+i>=buffer.length)return null;
    const b=buffer[offset+i];
    result|=(b&0x7f)<<shift;
    if(!(b&0x80))return {value:result>>>0,next:offset+i+1};
    shift+=7;
  }
  throw new Error("Invalid VarInt");
};
/** Java Edition server status ping. Only probes the local managed TCP port. */
export async function pingMinecraft(port,{timeoutMs=800}={}) {
  if(!Number.isInteger(port)||port<1||port>65535)return null;
  return new Promise(resolve=>{
    const started=Date.now();
    const socket=createConnection({host:"127.0.0.1",port});
    let complete=false,buffer=Buffer.alloc(0);
    const finish=value=>{
      if(complete)return;
      complete=true;clearTimeout(timer);socket.destroy();resolve(value);
    };
    const timer=setTimeout(()=>finish(null),timeoutMs);
    timer.unref();
    socket.once("error",()=>finish(null));
    socket.once("connect",()=>{
      const name=Buffer.from("localhost");
      const portBuffer=Buffer.allocUnsafe(2);portBuffer.writeUInt16BE(port);
      const handshake=Buffer.concat([
        encodeVarint(0),encodeVarint(0),encodeVarint(name.length),name,portBuffer,encodeVarint(1)
      ]);
      socket.write(Buffer.concat([encodeVarint(handshake.length),handshake,Buffer.from([1,0])]));
    });
    socket.on("data",chunk=>{
      if(complete)return;
      if(buffer.length+chunk.length>1024*1024)return finish(null);
      buffer=Buffer.concat([buffer,chunk]);
      try{
        const packetLen=decodeVarint(buffer);
        if(!packetLen)return;
        if(packetLen.value>1024*1024)return finish(null);
        if(buffer.length<packetLen.next+packetLen.value)return;
        const id=decodeVarint(buffer,packetLen.next);
        if(!id||id.value!==0)return finish(null);
        const contentLen=decodeVarint(buffer,id.next);
        if(!contentLen||contentLen.value>packetLen.value)return finish(null);
        if(buffer.length<contentLen.next+contentLen.value)return;
        const payload=JSON.parse(buffer.subarray(contentLen.next,contentLen.next+contentLen.value).toString("utf8"));
        const online=payload?.players?.online,maximum=payload?.players?.max;
        finish({
          players:Number.isInteger(online)&&online>=0?online:null,
          maxPlayers:Number.isInteger(maximum)&&maximum>=0?maximum:null,
          version:typeof payload?.version?.name==="string"?payload.version.name.slice(0,100):null,
          latencyMs:Date.now()-started,checkedAt:Date.now()
        });
      }catch{finish(null);}
    });
    socket.once("close",()=>finish(null));
  });
}
