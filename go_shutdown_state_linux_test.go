//go:build linux

package main

import (
 "context"
 "encoding/json"
 "net"
 "os"
 "os/exec"
 "path/filepath"
 "strings"
 "testing"
 "time"
)

// A successful Minecraft status ping must never turn an operator's
// stop-in-progress back into "running".
func TestStatusPingPreservesStoppingState(t *testing.T) {
 listener, err := net.Listen("tcp", "127.0.0.1:0")
 if err != nil { t.Fatal(err) }
 defer listener.Close()
 port := listener.Addr().(*net.TCPAddr).Port
 go func() {
  conn, err := listener.Accept()
  if err != nil { return }
  defer conn.Close()
  _ = conn.SetDeadline(time.Now().Add(2 * time.Second))
  received := make([]byte, 256)
  _, _ = conn.Read(received)
  payload := []byte(`{"version":{"name":"Mock Paper"},"players":{"online":3,"max":20}}`)
  response := append([]byte{0}, writeVarint(len(payload))...)
  response = append(response, payload...)
  frame := append(writeVarint(len(response)), response...)
  _, _ = conn.Write(frame)
 }()
 m, err := newManager(t.TempDir(), "java")
 if err != nil { t.Fatal(err) }
 defer m.shutdown(context.Background())
 created, err := m.create(serverConfig{Name:"status-test", Port:port, MemoryMb:1024, EulaAccepted:true})
 if err != nil { t.Fatal(err) }
 id := created["id"].(string)
 process, err := os.FindProcess(os.Getpid())
 if err != nil { t.Fatal(err) }
 m.mu.Lock()
 s := m.servers[id]
 s.process = &managedProcess{cmd:&exec.Cmd{Process:process}, state:"stopping", started:time.Now()}
 m.mu.Unlock()
 m.pollStatuses()
 m.mu.Lock()
 state := s.process.state
 players := -1
 if s.mcStatus != nil { players = s.mcStatus.Players }
 s.process = nil // synthetic process: never signal the current test process
 m.mu.Unlock()
 if state != "stopping" { t.Fatalf("ping changed stopping to %q", state) }
 if players != 3 { t.Fatalf("mock status ping not processed: players=%d", players) }
}

func TestPanelShutdownDoesNotResumeOperatorStoppedJVM(t *testing.T) {
 root := t.TempDir()
 script := filepath.Join(root,"fake-java.sh")
 // Keep stop in flight long enough for the panel shutdown to observe it.
 fakeJava := "#!/bin/sh\nwhile IFS= read -r command; do\n if [ \"$command\" = stop ]; then sleep 0.5; exit 0; fi\ndone\n"
 if err := os.WriteFile(script, []byte(fakeJava), 0700); err != nil { t.Fatal(err) }
 m, err := newManager(filepath.Join(root,"data"),script)
 if err != nil { t.Fatal(err) }
 ports := []int{27511,27512}
 ids := []string{}
 for i,port := range ports {
  value, err := m.create(serverConfig{Name:"instance-"+string(rune('A'+i)),Port:port,MemoryMb:1024,EulaAccepted:true})
  if err != nil { t.Fatal(err) }
  id := value["id"].(string)
  ids = append(ids,id)
  if err := os.WriteFile(filepath.Join(m.dir(id),"server.jar"),[]byte("test jar"),0600);err!=nil { t.Fatal(err) }
  if _,err := m.start(id);err!=nil { t.Fatal(err) }
 }
 if err := m.stop(ids[1]);err!=nil { t.Fatal(err) }
 ctx,cancel := context.WithTimeout(context.Background(),8*time.Second)
 defer cancel()
 if err := m.shutdown(ctx);err!=nil { t.Fatal(err) }
 data,err := os.ReadFile(filepath.Join(m.root,".panel-resume.json"))
 if err!=nil { t.Fatal(err) }
 var resumed []string
 if err:=json.Unmarshal(data,&resumed);err!=nil { t.Fatal(err) }
 if len(resumed)!=1 || resumed[0]!=ids[0] {
  t.Fatalf("expected only running JVM, got %+v",resumed)
 }
 if strings.Contains(string(data),ids[1]) { t.Fatal("operator-stopped JVM was scheduled to resume") }
}
