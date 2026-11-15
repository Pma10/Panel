//go:build linux

package main

import (
 "context"
 "os"
 "path/filepath"
 "testing"
 "time"
)

// Simulate an app-binary replacement with two server records: only the JVM
// that was running before the graceful shutdown should return.
func TestGracefulPanelUpgradeResumesOnlyRunningServers(t *testing.T){
 root:=t.TempDir()
 fakeJava:=filepath.Join(root,"java-upgrade-stub.sh")
 script:="#!/bin/sh\nwhile IFS= read -r command; do\n  if [ \"$command\" = stop ]; then exit 0; fi\ndone\n"
 if err:=os.WriteFile(fakeJava,[]byte(script),0700);err!=nil{t.Fatal(err)}
 data:=filepath.Join(root,"panel")
 first,err:=newManager(data,fakeJava)
 if err!=nil{t.Fatal(err)}
 active,err:=first.create(serverConfig{Name:"running",Port:27150,MemoryMb:1024,EulaAccepted:true})
 if err!=nil{t.Fatal(err)}
 stopped,err:=first.create(serverConfig{Name:"stopped",Port:27151,MemoryMb:1024,EulaAccepted:true})
 if err!=nil{t.Fatal(err)}
 runningID:=active["id"].(string)
 stoppedID:=stopped["id"].(string)
 if err:=os.WriteFile(filepath.Join(first.dir(runningID),"server.jar"),[]byte("stub"),0600);err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(filepath.Join(first.dir(stoppedID),"server.jar"),[]byte("stub"),0600);err!=nil{t.Fatal(err)}
 if _,err:=first.start(runningID);err!=nil{t.Fatal(err)}
 shutdownCtx,cancel:=context.WithTimeout(context.Background(),6*time.Second)
 if err:=first.shutdown(shutdownCtx);err!=nil{t.Fatal(err)}
 cancel()
 if _,err:=os.Stat(filepath.Join(data,".panel-resume.json"));err!=nil{t.Fatalf("running-server marker not written: %v",err)}
 second,err:=newManager(data,fakeJava)
 if err!=nil{t.Fatal(err)}
 defer second.shutdown(context.Background())
 second.resumePending()
 restored,err:=second.summary(runningID)
 if err!=nil{t.Fatal(err)}
 if restored["status"]!="starting" && restored["status"]!="running"{
  t.Fatalf("running server not resumed: %#v",restored)
 }
 untouched,err:=second.summary(stoppedID)
 if err!=nil{t.Fatal(err)}
 if untouched["status"]!="stopped"{t.Fatalf("previously stopped server auto-started: %#v",untouched)}
 if _,err:=os.Stat(filepath.Join(data,".panel-resume.json"));!os.IsNotExist(err){
  t.Fatalf("resume marker not consumed: %v",err)
 }
}
