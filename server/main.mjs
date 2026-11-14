import { makePanel } from "./http.mjs";

const host=process.env.PANEL_BIND_HOST||"127.0.0.1";
const port=Number(process.env.PANEL_PORT||4173);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("PANEL_PORT must be between 1 and 65535");
const origin=process.env.PANEL_PUBLIC_ORIGIN||"http://127.0.0.1:"+port;
if(!["127.0.0.1","localhost","::1"].includes(host) && !origin.startsWith("https://")) {
  throw new Error("Remote access requires PANEL_PUBLIC_ORIGIN=https://... with a TLS reverse proxy.");
}
const app=await makePanel({origin});
app.server.listen(port,host,()=>{
  console.log("Panel 관리 패널: "+origin);
  console.log("관리 폴더: "+app.manager.root);
  console.log("관리자 비밀번호는 PANEL_ADMIN_PASSWORD 환경 변수에서 읽었습니다.");
});
let shuttingDown=false;
for(const signal of ["SIGINT","SIGTERM"]){
  process.on(signal,async()=>{
    if(shuttingDown)return;
    shuttingDown=true;
    console.log("패널 종료 중, Java 서버에 정지 요청:",signal);
    const timeout=setTimeout(()=>{console.error("종료 타임아웃");process.exit(1);},45000);
    try{await app.close();clearTimeout(timeout);process.exit(0);}
    catch(error){console.error(error);process.exit(1);}
  });
}
