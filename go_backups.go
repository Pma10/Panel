package main

import (
 "context"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "os"
 "path/filepath"
 "regexp"
 "sort"
 "strconv"
 "strings"
 "time"
)

const maxBackupBytes int64 = 8 << 30
const maxBackupFiles = 100000
type backupMeta struct{
 ID string `json:"id"`
 ServerID string `json:"serverId"`
 CreatedAt string `json:"createdAt"`
 Size int64 `json:"size"`
 Files int `json:"files"`
}
func (m *manager)beginBackup(id string)(*managedServer,func(),error){
 m.mu.Lock()
 s,err:=m.get(id)
 if err!=nil{m.mu.Unlock();return nil,nil,err}
 if s.busy||s.process!=nil{m.mu.Unlock();return nil,nil,apiError{409,"백업/복원 전에 서버를 중지하세요."}}
 s.busy=true;m.mu.Unlock()
 return s,func(){m.mu.Lock();s.busy=false;m.mu.Unlock()},nil
}
func copySnapshot(ctx context.Context,source,target string)(int64,int,error){
 var total int64
 var count int
 err:=filepath.WalkDir(source,func(path string,entry os.DirEntry,walkErr error)error{
  if walkErr!=nil{return walkErr}
  if ctx.Err()!=nil{return ctx.Err()}
  rel,err:=filepath.Rel(source,path);if err!=nil{return err}
  dest:=filepath.Join(target,rel)
  info,err:=os.Lstat(path);if err!=nil{return err}
  if info.Mode()&os.ModeSymlink!=0 || (!info.IsDir()&&!info.Mode().IsRegular()){
   return apiError{409,"심볼릭 링크 또는 특수 파일은 백업할 수 없습니다."}
  }
  if entry.IsDir(){return os.MkdirAll(dest,0700)}
  count++;total+=info.Size()
  if count>maxBackupFiles||total>maxBackupBytes{return apiError{413,"백업 파일 개수 또는 8GiB 크기 제한을 넘었습니다."}}
  in,err:=os.Open(path);if err!=nil{return err}
  out,err:=os.OpenFile(dest,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
  if err!=nil{in.Close();return err}
  n,cpErr:=io.Copy(out,io.LimitReader(in,info.Size()+1))
  inErr:=in.Close();clErr:=out.Close()
  if cpErr!=nil{return cpErr};if inErr!=nil{return inErr};if clErr!=nil{return clErr}
  if n!=info.Size(){return apiError{409,"백업 중 파일 크기가 변경되었습니다."}}
  return nil
 })
 return total,count,err
}
func (m *manager) backup(ctx context.Context,id string)(backupMeta,error){
 _,release,err:=m.beginBackup(id);if err!=nil{return backupMeta{},err}
 defer release()
 snapshot:=filepath.Join(m.root,"backups",id,makeID())
 if err:=os.MkdirAll(snapshot,0700);err!=nil{return backupMeta{},err}
 completed:=false
 defer func(){if !completed{os.RemoveAll(snapshot)}}()
 size,count,err:=copySnapshot(ctx,m.dir(id),filepath.Join(snapshot,"files"))
 if err!=nil{return backupMeta{},err}
 meta:=backupMeta{ID:filepath.Base(snapshot),ServerID:id,CreatedAt:time.Now().UTC().Format(time.RFC3339),Size:size,Files:count}
 data,err:=json.Marshal(meta);if err!=nil{return backupMeta{},err}
 if err:=os.WriteFile(filepath.Join(snapshot,"meta.json"),data,0600);err!=nil{return backupMeta{},err}
 completed=true
 m.log(id,"INFO","백업 생성 완료: "+meta.ID)
 return meta,nil
}
func (m *manager) backups(id string)([]backupMeta,error){
 m.mu.Lock();_,err:=m.get(id);m.mu.Unlock();if err!=nil{return nil,err}
 root:=filepath.Join(m.root,"backups",id)
 entries,err:=os.ReadDir(root)
 if errors.Is(err,os.ErrNotExist){return []backupMeta{},nil}
 if err!=nil{return nil,err}
 list:=[]backupMeta{}
 for _,e:=range entries{
  if !e.IsDir()||len(e.Name())!=16||!isHex(e.Name()){continue}
  data,err:=os.ReadFile(filepath.Join(root,e.Name(),"meta.json"));if err!=nil{continue}
  var item backupMeta
  if json.Unmarshal(data,&item)==nil&&item.ID==e.Name()&&item.ServerID==id{list=append(list,item)}
 }
 sort.Slice(list,func(i,j int)bool{return list[i].CreatedAt>list[j].CreatedAt})
 return list,nil
}
func (m *manager)deleteBackup(id,backupID string)error{
 if len(backupID)!=16||!isHex(backupID){return apiError{400,"백업 ID가 올바르지 않습니다."}}
 m.mu.Lock()
 state,err:=m.get(id)
 if err!=nil{m.mu.Unlock();return err}
 if state.busy{m.mu.Unlock();return apiError{409,"다른 백업 또는 복원 작업이 진행 중입니다."}}
 state.busy=true
 m.mu.Unlock()
 defer func(){m.mu.Lock();state.busy=false;m.mu.Unlock()}()
 folder:=filepath.Join(m.root,"backups",id,backupID)
 data,err:=os.ReadFile(filepath.Join(folder,"meta.json"))
 if errors.Is(err,os.ErrNotExist){return apiError{404,"백업이 존재하지 않습니다."}}
 if err!=nil{return err}
 var metadata backupMeta
 if err:=json.Unmarshal(data,&metadata);err!=nil{return apiError{409,"백업 메타데이터가 손상되었습니다."}}
 if metadata.ID!=backupID||metadata.ServerID!=id{
  return apiError{409,"백업 메타데이터가 요청한 서버와 일치하지 않습니다."}
 }
 info,err:=os.Lstat(folder)
 if err!=nil{return err}
 if !info.IsDir()||info.Mode()&os.ModeSymlink!=0{
  return apiError{403,"백업 경로가 안전하지 않습니다."}
 }
 if err:=os.RemoveAll(folder);err!=nil{return err}
 m.log(id,"WARN","백업 삭제: "+backupID)
 return nil
}
func (m *manager)restore(ctx context.Context,id,backupID string)(map[string]any,error){
 if len(backupID)!=16||!isHex(backupID){return nil,apiError{400,"백업 ID가 올바르지 않습니다."}}
 _,release,err:=m.beginBackup(id);if err!=nil{return nil,err}
 defer release()
 backupRoot:=filepath.Join(m.root,"backups",id,backupID)
 backupInfo,err:=os.Lstat(backupRoot)
 if errors.Is(err,os.ErrNotExist){return nil,apiError{404,"백업을 찾을 수 없습니다."}}
 if err!=nil{return nil,err}
 if !backupInfo.IsDir()||backupInfo.Mode()&os.ModeSymlink!=0{
  return nil,apiError{403,"백업 폴더가 안전하지 않습니다."}
 }
 metadataBytes,err:=os.ReadFile(filepath.Join(backupRoot,"meta.json"))
 if err!=nil{return nil,apiError{409,"백업 메타데이터를 읽을 수 없습니다."}}
 var metadata backupMeta
 if json.Unmarshal(metadataBytes,&metadata)!=nil||metadata.ID!=backupID||metadata.ServerID!=id||
    metadata.Size<0||metadata.Size>maxBackupBytes||metadata.Files<0||metadata.Files>maxBackupFiles{
  return nil,apiError{409,"다른 서버의 백업이거나 메타데이터가 손상되었습니다."}
 }
 origin:=filepath.Join(backupRoot,"files")
 info,err:=os.Lstat(origin)
 if err!=nil||!info.IsDir()||info.Mode()&os.ModeSymlink!=0{
  return nil,apiError{409,"백업 파일 폴더가 안전하지 않거나 누락됐습니다."}
 }
 current:=m.dir(id)
 currentInfo,err:=os.Lstat(current)
 if err!=nil||!currentInfo.IsDir()||currentInfo.Mode()&os.ModeSymlink!=0{
  return nil,apiError{409,"현재 서버 폴더가 안전하지 않습니다."}
 }
 stage:=filepath.Join(m.root,"servers",id+"."+makeID()+".restore")
 previous:=filepath.Join(m.root,"servers",id+"."+makeID()+".previous")
 defer os.RemoveAll(stage)
 restoredBytes,restoredFiles,err:=copySnapshot(ctx,origin,stage)
 if err!=nil{return nil,err}
 if restoredBytes!=metadata.Size || restoredFiles!=metadata.Files{
  return nil,apiError{409,"백업 파일 수 또는 크기가 원본 기록과 다릅니다. 현재 월드는 변경하지 않았습니다."}
 }
 if err:=os.Rename(current,previous);err!=nil{return nil,err}
 if err:=os.Rename(stage,current);err!=nil{
  if rollback:=os.Rename(previous,current);rollback!=nil{
   return nil,fmt.Errorf("restore and rollback failed; previous world retained at %s: %w",previous,rollback)
  }
  return nil,err
 }
 // On cleanup failure, retain the previous world instead of failing a successful restore.
 if err:=os.RemoveAll(previous);err!=nil{m.log(id,"WARN","이전 데이터 임시 폴더 정리 실패: "+err.Error())}
 m.log(id,"WARN","백업 복원 완료: "+backupID)
 return map[string]any{"restored":true,"backupId":backupID},nil
}
var scheduleExpr=regexp.MustCompile("^(?:[0-5]?\\d) (?:[01]?\\d|2[0-3]) \\* \\* (?:\\*|[0-6])$")
func (m *manager)schedules(id string)([]schedule,error){
 m.mu.Lock();defer m.mu.Unlock()
 s,err:=m.get(id);if err!=nil{return nil,err}
 return append([]schedule{},s.cfg.Schedules...),nil
}
func (m *manager)addSchedule(id string,input schedule)(schedule,error){
 if strings.TrimSpace(input.Name)==""||len(input.Name)>64{return schedule{},apiError{400,"작업 이름을 입력하세요."}}
 if input.Type!="backup"&&input.Type!="restart"{return schedule{},apiError{400,"지원하지 않는 예약 작업입니다."}}
 if !scheduleExpr.MatchString(input.Cron){return schedule{},apiError{400,"실행식: 분 시 * * * 또는 분 시 * * 요일"}}
 m.mu.Lock();defer m.mu.Unlock()
 s,err:=m.get(id);if err!=nil{return schedule{},err}
 if len(s.cfg.Schedules)>=25{return schedule{},apiError{409,"예약 작업을 25개 넘게 등록할 수 없습니다."}}
 input.ID=makeID();input.Enabled=true;input.LastRun=""
 s.cfg.Schedules=append(s.cfg.Schedules,input)
 if err:=m.saveLocked();err!=nil{return schedule{},err}
 return input,nil
}
func (m *manager)deleteSchedule(id,sid string)error{
 m.mu.Lock();defer m.mu.Unlock()
 s,err:=m.get(id);if err!=nil{return err}
 for i,item:=range s.cfg.Schedules{
  if item.ID==sid{
   s.cfg.Schedules=append(s.cfg.Schedules[:i],s.cfg.Schedules[i+1:]...)
   return m.saveLocked()
  }
 }
 return apiError{404,"예약 작업을 찾을 수 없습니다."}
}
func (m *manager)scheduleTick(now time.Time){
 local:=now.In(time.FixedZone("KST",9*3600))
 stamp:=local.Format("2006-01-02 15:04")
 minute,hour,day:=local.Minute(),local.Hour(),int(local.Weekday())
 jobs:=[]scheduledJob{}
 m.mu.Lock()
 if m.closing{m.mu.Unlock();return}
 for id,s:=range m.servers{
  for index,item:=range s.cfg.Schedules{
   fields:=strings.Fields(item.Cron)
   if len(fields)!=5||!item.Enabled||item.LastRun==stamp{continue}
   mm,e1:=strconv.Atoi(fields[0]);hh,e2:=strconv.Atoi(fields[1])
   if e1!=nil||e2!=nil||mm!=minute||hh!=hour{continue}
   if fields[4]!="*"{
    dd,err:=strconv.Atoi(fields[4]);if err!=nil||dd!=day{continue}
   }
   s.cfg.Schedules[index].LastRun=stamp
   jobs=append(jobs,scheduledJob{id,item.Type})
  }
 }
 if len(jobs)>0{_ = m.saveLocked()}
 m.mu.Unlock()
 for _,work:=range jobs{
  select{
  case m.jobQueue<-work:
  default:
   m.log(work.id,"WARN","예약 작업 대기열이 가득 찼습니다. 다음 실행 시간을 확인하세요.")
  }
 }
}
