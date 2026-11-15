//go:build linux

package main

import (
 "context"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"
)

func TestManagedJavaLifecycleWithFakeProcess(t *testing.T){
 root:=t.TempDir()
 fakeJava:=filepath.Join(root,"java-stub.sh")
 script:="#!/bin/sh\n"+
  "echo 'Minecraft stub starting'\n"+
  "while IFS= read -r command; do\n"+
  "  echo \"CONSOLE: $command\"\n"+
  "  if [ \"$command\" = 'stop' ]; then exit 0; fi\n"+
  "done\n"
 if err:=os.WriteFile(fakeJava,[]byte(script),0700);err!=nil{t.Fatal(err)}
 manager,err:=newManager(filepath.Join(root,"panel"),fakeJava)
 if err!=nil{t.Fatal(err)}
 t.Cleanup(func(){ctx,cancel:=context.WithTimeout(context.Background(),5*time.Second);defer cancel();_ = manager.shutdown(ctx)})
 created,err:=manager.create(serverConfig{Name:"Integration",Port:26292,MemoryMb:1024,EulaAccepted:true})
 if err!=nil{t.Fatal(err)}
 id:=created["id"].(string)
 if err:=os.WriteFile(filepath.Join(manager.dir(id),"server.jar"),[]byte("test stub"),0600);err!=nil{t.Fatal(err)}
 started,err:=manager.start(id)
 if err!=nil{t.Fatalf("start failed: %v",err)}
 if started["status"]!="starting"{t.Fatalf("expected starting: %v",started)}
 if _,err:=os.Stat(filepath.Join(manager.dir(id),".panel-process"));err!=nil{t.Fatal("missing PID marker: ",err)}
 if err:=manager.command(id,"say verification");err!=nil{t.Fatalf("console command: %v",err)}
 found:=false
 for retry:=0;retry<50;retry++{
  logs,err:=manager.history(id)
  if err!=nil{t.Fatal(err)}
  for _,entry:=range logs{if strings.Contains(entry.Message,"CONSOLE: say verification"){found=true;break}}
  if found{break}
  time.Sleep(20*time.Millisecond)
 }
 if !found{t.Fatal("console command did not reach Java stdin")}
 if _,err:=manager.start(id);err==nil{t.Fatal("double start was allowed")}
 if err:=manager.stop(id);err!=nil{t.Fatalf("stop failed: %v",err)}
 deadline:=time.After(3*time.Second)
 for{
  current,err:=manager.summary(id)
  if err!=nil{t.Fatal(err)}
  if current["status"]=="stopped"{break}
  select{
   case <-deadline:t.Fatal("Java stub did not exit after stop command")
   default:time.Sleep(20*time.Millisecond)
  }
 }
 if _,err:=os.Stat(filepath.Join(manager.dir(id),".panel-process"));!os.IsNotExist(err){
  t.Fatalf("PID marker not removed after process exit: %v",err)
 }
}
func TestLinuxPanelLockExclusivity(t *testing.T){
 dir:=t.TempDir()
 unlock,err:=lockPanelData(dir)
 if err!=nil{t.Fatal(err)}
 defer unlock()
 if second,err:=lockPanelData(dir);err==nil{
  second()
  t.Fatal("concurrent panel lock was allowed")
 }
 unlock()
 fresh,err:=lockPanelData(dir)
 if err!=nil{t.Fatalf("released lock was not reusable: %v",err)}
 fresh()
}
