package main

import (
 "context"
 "fmt"
 "strings"
 "testing"
)

func TestFixedConsoleRingPreservesNewestEntriesInOrder(t *testing.T){
 m,err:=newManager(t.TempDir(),"java")
 if err!=nil{t.Fatal(err)}
 t.Cleanup(func(){_ = m.shutdown(context.Background())})
 cfg,err:=m.create(serverConfig{Name:"ring",Port:27205,MemoryMb:1024,EulaAccepted:true})
 if err!=nil{t.Fatal(err)}
 id:=cfg["id"].(string)
 for i:=0;i<2000;i++{m.log(id,"INFO",fmt.Sprintf("line-%d",i))}
 result,err:=m.history(id)
 if err!=nil{t.Fatal(err)}
 if len(result)!=400{t.Fatalf("expected exactly 400 entries, got %d",len(result))}
 for i,item:=range result{
  expected:=fmt.Sprintf("line-%d",i+1600)
  if item.Message!=expected{t.Fatalf("entry %d: wanted %q, got %q",i,expected,item.Message)}
 }
 m.mu.Lock()
 backing:=cap(m.servers[id].logs)
 m.mu.Unlock()
 if backing>1024{t.Fatalf("excessive backing allocation: %d",backing)}
}
func BenchmarkFixedConsoleRing(b *testing.B){
 m,err:=newManager(b.TempDir(),"java")
 if err!=nil{b.Fatal(err)}
 defer m.shutdown(context.Background())
 cfg,err:=m.create(serverConfig{Name:"benchmark",Port:27206,MemoryMb:1024,EulaAccepted:true})
 if err!=nil{b.Fatal(err)}
 id:=cfg["id"].(string)
 message:=strings.Repeat("log ",128)
 b.ReportAllocs()
 b.ResetTimer()
 for i:=0;i<b.N;i++{m.log(id,"INFO",message)}
}
