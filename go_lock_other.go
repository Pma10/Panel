//go:build !linux

package main

import (
 "fmt"
 "os"
 "os/exec"
 "path/filepath"
)

// A portable exclusive lock marker on non-Linux platforms.
// If the panel crashes, verify it is stopped before removing this file.
func lockPanelData(root string)(func(),error){
 path:=filepath.Join(root,".panel-instance.lock")
 file,err:=os.OpenFile(path,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
 if err!=nil{return nil,fmt.Errorf("data folder is locked; stop the old panel before removing %s: %w",path,err)}
 if _,err=file.WriteString(fmt.Sprintf("%d\n",os.Getpid()));err!=nil{file.Close();os.Remove(path);return nil,err}
 return func(){_ = file.Close();_ = os.Remove(path)},nil
}
func configureJavaChild(cmd *exec.Cmd){}
