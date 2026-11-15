package main

import (
 "context"
 "time"
)

type scheduledJob struct{id string; action string}

func (m *manager) scheduledWorker(){
 for{
  select{
  case <-m.stopScheduler:
   return
  case work:=<-m.jobQueue:
   m.mu.Lock()
   closed:=m.closing
   m.mu.Unlock()
   if closed{return}
   m.runScheduledJob(work)
  }
 }
}

func (m *manager) runScheduledJob(work scheduledJob){
 ctx,cancel:=context.WithTimeout(context.Background(),15*time.Minute)
 defer cancel()
 // Abort cold backups if the panel is shutting down rather than racing a JVM restart.
 stopped:=make(chan struct{})
 go func(){
  select{
  case <-m.stopScheduler:cancel()
  case <-stopped:
  }
 }()
 defer close(stopped)
 if work.action=="restart"{
  if _,err:=m.restart(work.id);err!=nil{
   m.log(work.id,"WARN","예약 재시작 실패: "+err.Error())
  }
  return
 }
 // Cold backup: stop -> snapshot -> start. There is scheduled downtime.
 m.mu.Lock()
 s,err:=m.get(work.id)
 var process *managedProcess
 if err==nil{process=s.process}
 m.mu.Unlock()
 if err!=nil{return}
 if process!=nil{
  if err:=m.stop(work.id);err!=nil{
   m.log(work.id,"WARN","예약 백업 전 종료 실패: "+err.Error());return
  }
  select{
  case <-process.done:
  case <-ctx.Done():
   m.log(work.id,"WARN","예약 백업을 위한 서버 종료 시간 초과")
   return
  }
 }
 if _,err:=m.backup(ctx,work.id);err!=nil{
  m.log(work.id,"WARN","예약 백업 실패: "+err.Error())
 }
 m.mu.Lock()
 closing:=m.closing
 m.mu.Unlock()
 if process!=nil&&!closing{
  if _,err:=m.start(work.id);err!=nil{
   m.log(work.id,"WARN","백업 후 서버 재시작 실패: "+err.Error())
  }
 }
}
