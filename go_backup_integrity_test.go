package main

import (
 "context"
 "encoding/json"
 "errors"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func TestRestoreRefusesTamperedBackupMetadataBeforeTouchingWorld(t *testing.T){
 m,err:=newManager(t.TempDir(),"java")
 if err!=nil{t.Fatal(err)}
 defer m.shutdown(context.Background())
 created,err:=m.create(serverConfig{Name:"world-integrity",Port:27451,MemoryMb:1024,EulaAccepted:true})
 if err!=nil{t.Fatal(err)}
 id:=created["id"].(string)
 worldFile:=filepath.Join(m.dir(id),"level.dat")
 if err:=os.WriteFile(worldFile,[]byte("keep-current-world"),0600);err!=nil{t.Fatal(err)}
 backup,err:=m.backup(context.Background(),id)
 if err!=nil{t.Fatal(err)}
 meta:=filepath.Join(m.root,"backups",id,backup.ID,"meta.json")
 data,err:=os.ReadFile(meta)
 if err!=nil{t.Fatal(err)}
 var value backupMeta
 if err:=json.Unmarshal(data,&value);err!=nil{t.Fatal(err)}
 value.ServerID="ffffffffffffffff"
 damaged,_:=json.Marshal(value)
 if err:=os.WriteFile(meta,damaged,0600);err!=nil{t.Fatal(err)}
 _,err=m.restore(context.Background(),id,backup.ID)
 var api apiError
 if !errors.As(err,&api)||api.Status!=409{
  t.Fatalf("expected HTTP 409 for modified metadata, got %v",err)
 }
 current,err:=os.ReadFile(worldFile)
 if err!=nil||string(current)!="keep-current-world"{
  t.Fatalf("live world changed after rejected restore: %q %v",current,err)
 }
}

func TestRestoreRefusesSymlinkedBackupFiles(t *testing.T){
 m,err:=newManager(t.TempDir(),"java")
 if err!=nil{t.Fatal(err)}
 defer m.shutdown(context.Background())
 created,err:=m.create(serverConfig{Name:"world-link",Port:27452,MemoryMb:1024,EulaAccepted:true})
 if err!=nil{t.Fatal(err)}
 id:=created["id"].(string)
 backup,err:=m.backup(context.Background(),id)
 if err!=nil{t.Fatal(err)}
 files:=filepath.Join(m.root,"backups",id,backup.ID,"files")
 moved:=files+".real"
 if err:=os.Rename(files,moved);err!=nil{t.Fatal(err)}
 defer func(){_ = os.Remove(files);_ = os.Rename(moved,files)}()
 if err:=os.Symlink(m.dir(id),files);err!=nil{
  if strings.Contains(err.Error(),"privilege"){t.Skip("symlinks not permitted")}
  t.Fatal(err)
 }
 _,err=m.restore(context.Background(),id,backup.ID)
 if err==nil{t.Fatal("restore accepted symlinked backup files")}
}
