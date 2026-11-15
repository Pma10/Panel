//go:build linux

package main

import (
 "fmt"
 "os"
 "os/exec"
 "path/filepath"
 "syscall"
 "sync"
)

// The kernel releases flock automatically if the panel crashes.
func lockPanelData(root string)(func(),error){
 file,err:=os.OpenFile(filepath.Join(root,".panel-instance.lock"),os.O_CREATE|os.O_RDWR,0600)
 if err!=nil{return nil,err}
 if err=syscall.Flock(int(file.Fd()),syscall.LOCK_EX|syscall.LOCK_NB);err!=nil{
  file.Close()
  return nil,fmt.Errorf("another panel is managing this data folder: %w",err)
 }
 var once sync.Once
 return func(){once.Do(func(){_ = syscall.Flock(int(file.Fd()),syscall.LOCK_UN);_ = file.Close()})},nil
}

// Signal JVMs when the parent dies unexpectedly and isolate their process group.
func configureJavaChild(cmd *exec.Cmd){
 cmd.SysProcAttr=&syscall.SysProcAttr{Setpgid:true,Pdeathsig:syscall.SIGTERM}
}
