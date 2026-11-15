//go:build linux

package main

import (
 "os"
 "path/filepath"
 "strconv"
 "strings"
)
func orphanJavaRunning(folder string) bool {
 data,err:=os.ReadFile(filepath.Join(folder,".panel-process"))
 if err!=nil{return false}
 pid,err:=strconv.Atoi(strings.TrimSpace(string(data)))
 if err!=nil||pid<1{return false}
 cwd,err:=os.Readlink(filepath.Join("/proc",strconv.Itoa(pid),"cwd"))
 return err==nil&&filepath.Clean(cwd)==filepath.Clean(folder)
}
