package main

import (
 "bufio"
 "encoding/json"
 "os"
 "path/filepath"
 "sync"
 "time"
)
type auditEntry struct {
 Time string `json:"time"`
 Action string `json:"action"`
 ServerID string `json:"serverId,omitempty"`
 Actor string `json:"actor"`
}
type auditLog struct{
 mu sync.Mutex
 path string
 entries []auditEntry
}
func newAudit(root string)*auditLog{
 a:=&auditLog{path:filepath.Join(root,"audit.jsonl"),entries:[]auditEntry{}}
 info,err:=os.Stat(a.path)
 if err!=nil{return a}
 if info.Size()>4<<20{
  _=os.Rename(a.path,a.path+".previous")
  return a
 }
 file,err:=os.Open(a.path)
 if err!=nil{return a}
 defer file.Close()
 scanner:=bufio.NewScanner(file)
 scanner.Buffer(make([]byte,4096),65536)
 for scanner.Scan(){
  var item auditEntry
  if json.Unmarshal(scanner.Bytes(),&item)==nil && item.Action!=""{
   a.entries=append(a.entries,item)
   if len(a.entries)>500{a.entries=a.entries[len(a.entries)-500:]}
  }
 }
 return a
}
func (a *auditLog)append(action,serverID string){
 a.mu.Lock();defer a.mu.Unlock()
 entry:=auditEntry{Time:time.Now().UTC().Format(time.RFC3339),Action:action,ServerID:serverID,Actor:"관리자"}
 a.entries=append(a.entries,entry)
 if len(a.entries)>500{a.entries=a.entries[len(a.entries)-500:]}
 file,err:=os.OpenFile(a.path,os.O_CREATE|os.O_APPEND|os.O_WRONLY,0600)
 if err==nil{
  data,_:=json.Marshal(entry)
  _,_=file.Write(append(data,'\n'))
  _=file.Close()
  if info,err:=os.Stat(a.path);err==nil&&info.Size()>4<<20{
   tmp:=a.path+".compact"
   next,err:=os.OpenFile(tmp,os.O_CREATE|os.O_TRUNC|os.O_WRONLY,0600)
   if err==nil{
    encode:=json.NewEncoder(next)
    for _,saved:=range a.entries{if err=encode.Encode(saved);err!=nil{break}}
    closeErr:=next.Close()
    if err==nil&&closeErr==nil{_ = os.Rename(tmp,a.path)}else{_ = os.Remove(tmp)}
   }
  }
 }
}
func (a *auditLog)read()[]auditEntry{
 a.mu.Lock();defer a.mu.Unlock()
 result:=make([]auditEntry,len(a.entries))
 for i:=range a.entries{result[i]=a.entries[len(a.entries)-i-1]}
 return result
}
