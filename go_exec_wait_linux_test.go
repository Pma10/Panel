//go:build linux

package main

import (
 "errors"
 "os/exec"
 "testing"
 "time"
)

func TestJavaOutputWriterDoesNotHangWhenChildInheritsPipe(t *testing.T){
 writer:=&boundedConsoleWriter{writeLog:func(string){}}
 cmd:=exec.Command("sh","-c","(sleep 2) & echo ready")
 cmd.Stdout=writer
 cmd.Stderr=writer
 cmd.WaitDelay=150*time.Millisecond
 started:=time.Now()
 err:=cmd.Run()
 elapsed:=time.Since(started)
 if err!=nil&&!errors.Is(err,exec.ErrWaitDelay){t.Fatal(err)}
 if elapsed>1600*time.Millisecond{
  t.Fatalf("inherited child pipe blocked shutdown for %s",elapsed)
 }
}
