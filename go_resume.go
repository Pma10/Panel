package main

import (
 "encoding/json"
 "errors"
 "log"
 "os"
 "path/filepath"
 "time"
)

// A graceful panel restart carries forward only JVMs that were actually
// running. It never marks a manually stopped Minecraft server for startup.
func (m *manager)saveResumeList(ids []string)error{
 target:=filepath.Join(m.root,".panel-resume.json")
 if len(ids)==0{
  if err:=os.Remove(target);err!=nil&&!errors.Is(err,os.ErrNotExist){return err}
  return nil
 }
 if len(ids)>100{return errors.New("resume list exceeds 100 managed servers")}
 data,err:=json.Marshal(ids)
 if err!=nil{return err}
 temp:=target+"."+makeID()+".tmp"
 if err:=os.WriteFile(temp,data,0600);err!=nil{return err}
 if err:=os.Rename(temp,target);err!=nil{_ = os.Remove(temp);return err}
 return nil
}

// Invoked only after the HTTP listener has successfully bound. A corrupt or
// outdated resume file is not trusted; errors leave servers stopped.
func (m *manager)resumePending(){
 target:=filepath.Join(m.root,".panel-resume.json")
 data,err:=os.ReadFile(target)
 if errors.Is(err,os.ErrNotExist){return}
 if err!=nil{log.Printf("Cannot read panel resume list: %v",err);return}
 if len(data)>8192{log.Print("Resume file is oversized; refusing startup");return}
 var ids []string
 if err:=json.Unmarshal(data,&ids);err!=nil{log.Printf("Invalid resume list: %v",err);return}
 if len(ids)>100{log.Print("Resume file has too many servers; refusing startup");return}
 for _,id:=range ids{
  if len(id)!=16||!isHex(id){log.Print("Invalid server ID in resume list");return}
 }
 if err:=os.Remove(target);err!=nil{log.Printf("Cannot clear resume list: %v",err);return}
 // Give a previously stopped JVM its final socket and PID cleanup time.
 time.Sleep(400*time.Millisecond)
 for _,id:=range ids{
  m.mu.Lock()
  closed:=m.closing
  _,known:=m.servers[id]
  m.mu.Unlock()
  if closed{return}
  if !known{continue}
  if _,err:=m.start(id);err!=nil{
   m.log(id,"WARN","패널 업데이트 이후 서버 재시작 실패: "+err.Error())
   log.Printf("Resume server %s: %v",id,err)
  }else{
   m.log(id,"INFO","패널 업데이트 이후 이전 실행 상태 복구")
  }
  // Stagger server startups to avoid a sudden disk/CPU spike.
  time.Sleep(350*time.Millisecond)
 }
}
