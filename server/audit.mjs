import { appendFile, readFile, rename, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Bounded, persistent metadata-only audit trail. No passwords or command bodies. */
export class AuditLog {
  constructor(root) {
    this.file=join(root,"audit.jsonl");
    this.entries=[];
    this.pending=Promise.resolve();
  }
  async init() {
    try {
      const info=await stat(this.file);
      // Read bounded tail only after normal rotation; older oversized files
      // are rotated before reading to avoid a large startup allocation.
      if(info.size>4*1024*1024){
        await rename(this.file,this.file+".previous");
        return;
      }
      const lines=(await readFile(this.file,"utf8")).split("\n").filter(Boolean);
      this.entries=lines.slice(-500).flatMap(line=>{
        try{const value=JSON.parse(line);return value&&typeof value.action==="string"?[value]:[];}catch{return [];}
      });
    }catch(e){if(e.code!=="ENOENT")throw e;}
  }
  list(){return [...this.entries].reverse();}
  async record({action,serverId=null}){
    const entry={time:new Date().toISOString(),action:String(action).slice(0,120),serverId:serverId||null,actor:"관리자"};
    this.entries.push(entry);
    if(this.entries.length>500)this.entries.splice(0,this.entries.length-500);
    this.pending=this.pending.catch(()=>{}).then(async()=>{
      await appendFile(this.file,JSON.stringify(entry)+"\n",{mode:0o600});
      const info=await stat(this.file);
      if(info.size>4*1024*1024){
        const tmp=this.file+".tmp";
        await writeFile(tmp,this.entries.map(e=>JSON.stringify(e)).join("\n")+"\n",{mode:0o600});
        await rename(tmp,this.file);
      }
    });
    await this.pending;
  }
}
