package main

import (
 "context"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func TestBoundedHistoricalMinecraftLogRecovery(t *testing.T){
 root:=t.TempDir()
 original,err:=newManager(root,"java")
 if err!=nil{t.Fatal(err)}
 created,err:=original.create(serverConfig{Name:"History",Port:26296,MemoryMb:1024,EulaAccepted:true})
 if err!=nil{t.Fatal(err)}
 id:=created["id"].(string)
 logDir:=filepath.Join(original.dir(id),"logs")
 if err:=os.MkdirAll(logDir,0700);err!=nil{t.Fatal(err)}
 var contents strings.Builder
 for i:=0;i<5000;i++{
  if i==4999{contents.WriteString("[12:00:00] [Server thread/ERROR]: Last line\n")
  }else{contents.WriteString("[11:00:00] [Server thread/INFO]: old log\n")}
 }
 if err:=os.WriteFile(filepath.Join(logDir,"latest.log"),[]byte(contents.String()),0600);err!=nil{t.Fatal(err)}
 if err:=original.shutdown(context.Background());err!=nil{t.Fatal(err)}
 resumed,err:=newManager(root,"java")
 if err!=nil{t.Fatal(err)}
 t.Cleanup(func(){_ = resumed.shutdown(context.Background())})
 entries,err:=resumed.history(id)
 if err!=nil{t.Fatal(err)}
 if len(entries)==0||len(entries)>100{t.Fatalf("expected bounded recovery, got %d lines",len(entries))}
 final:=entries[len(entries)-1]
 if final.Level!="ERROR"||!strings.Contains(final.Message,"Last line"){t.Fatalf("bad final entry: %+v",final)}
}
