//go:build linux

package main

import (
 "context"
 "net"
 "os"
 "path/filepath"
 "testing"
 "time"
)

func TestGoServerCannotStartOnOccupiedPort(t *testing.T){
 root:=t.TempDir()
 manager,err:=newManager(filepath.Join(root,"data"),"java")
 if err!=nil{t.Fatal(err)}
 t.Cleanup(func(){ctx,cancel:=context.WithTimeout(context.Background(),3*time.Second);defer cancel();_ = manager.shutdown(ctx)})
 listener,err:=net.Listen("tcp","127.0.0.1:0")
 if err!=nil{t.Fatal(err)}
 defer listener.Close()
 port:=listener.Addr().(*net.TCPAddr).Port
 created,err:=manager.create(serverConfig{Name:"occupied",Port:port,MemoryMb:1024,EulaAccepted:true})
 if err!=nil{t.Fatal(err)}
 id:=created["id"].(string)
 if err:=os.WriteFile(filepath.Join(manager.dir(id),"server.jar"),[]byte("placeholder"),0600);err!=nil{t.Fatal(err)}
 if _,err:=manager.start(id);err==nil{t.Fatal("startup should refuse occupied TCP port")}
}

func TestGoServerRootSymlinkReplacementIsRejected(t *testing.T){
 root:=t.TempDir()
 manager,err:=newManager(filepath.Join(root,"data"),"java")
 if err!=nil{t.Fatal(err)}
 t.Cleanup(func(){ctx,cancel:=context.WithTimeout(context.Background(),3*time.Second);defer cancel();_ = manager.shutdown(ctx)})
 created,err:=manager.create(serverConfig{Name:"symlink",Port:26294,MemoryMb:1024,EulaAccepted:true})
 if err!=nil{t.Fatal(err)}
 id:=created["id"].(string)
 original:=manager.dir(id)
 saved:=original+".saved"
 if err:=os.Rename(original,saved);err!=nil{t.Fatal(err)}
 defer func(){_ = os.Remove(original);_ = os.Rename(saved,original)}()
 if err:=os.Symlink(t.TempDir(),original);err!=nil{t.Fatal(err)}
 if _,err:=manager.filePath(id,"server.jar",true);err==nil{t.Fatal("file operation followed symlinked server root")}
 if _,err:=manager.start(id);err==nil{t.Fatal("Java start was allowed through symlinked server root")}
}
