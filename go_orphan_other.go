//go:build !linux

package main

func orphanJavaRunning(folder string) bool {
 // On non-Linux hosts, the TCP port probe is an additional safety check.
 return false
}
