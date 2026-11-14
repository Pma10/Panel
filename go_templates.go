package main

import (
 "context"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "fmt"
 "io"
 "net/http"
 "net/url"
 "os"
 "path/filepath"
 "regexp"
 "sort"
 "strconv"
 "strings"
 "time"
)
const paperAPI="https://fill.papermc.io"
const paperDownloadHost="fill-data.papermc.io"
var versionPattern=regexp.MustCompile("^[0-9]+(?:\\.[0-9]+){1,3}(?:-[a-zA-Z0-9._-]+)?$")
var shaPattern=regexp.MustCompile("^[0-9a-f]{64}$")
var officialClient=&http.Client{Timeout:3*time.Minute,CheckRedirect:func(_ *http.Request,_ []*http.Request)error{return http.ErrUseLastResponse}}
func templateCatalogue()[]map[string]any{
 return []map[string]any{
  {"id":"manual","name":"직접 JAR 업로드","automatic":false},
  {"id":"paper","name":"Paper","automatic":true},
  {"id":"folia","name":"Folia","automatic":true},
 }
}
func templateOK(project string)bool{return project=="paper"||project=="folia"}
func officialGET(ctx context.Context,uri string,limit int64)([]byte,error){
 req,err:=http.NewRequestWithContext(ctx,"GET",uri,nil);if err!=nil{return nil,err}
 req.Header.Set("User-Agent","PConnPanel/0.2 (https://github.com/Pma10/Panel)")
 req.Header.Set("Accept","application/json")
 res,err:=officialClient.Do(req);if err!=nil{return nil,apiError{502,"PaperMC API 연결 실패"}}
 defer res.Body.Close()
 if res.StatusCode!=200{return nil,apiError{502,"PaperMC API 응답 오류"}}
 data,err:=io.ReadAll(io.LimitReader(res.Body,limit+1));if err!=nil{return nil,err}
 if int64(len(data))>limit{return nil,apiError{502,"PaperMC 응답 크기 제한 초과"}}
 return data,nil
}
func templateVersions(ctx context.Context,project string)([]string,error){
 if !templateOK(project){return nil,apiError{400,"Paper/Folia만 지원합니다."}}
 ctx,cancel:=context.WithTimeout(ctx,20*time.Second);defer cancel()
 data,err:=officialGET(ctx,paperAPI+"/v3/projects/"+project,1<<20)
 if err!=nil{return nil,err}
 var result struct{Versions map[string][]string `json:"versions"`}
 if json.Unmarshal(data,&result)!=nil{return nil,apiError{502,"버전 목록 해석 실패"}}
 versions:=[]string{}
 seen:=map[string]bool{}
 for _,list:=range result.Versions{
  for _,v:=range list{
   if len(versions)>=120{break}
   if !seen[v]&&versionPattern.MatchString(v){seen[v]=true;versions=append(versions,v)}
  }
 }
 sort.Slice(versions,func(i,j int)bool{
  left,right:=strings.Split(versions[i],"-")[0],strings.Split(versions[j],"-")[0]
  a,b:=strings.Split(left,"."),strings.Split(right,".")
  for k:=0;k<len(a)||k<len(b);k++{
   var x,y int
   if k<len(a){x,_=strconv.Atoi(a[k])}
   if k<len(b){y,_=strconv.Atoi(b[k])}
   if x!=y{return x>y}
  }
  return versions[i]>versions[j]
 })
 return versions,nil
}
type officialBuild struct{
 ID int `json:"id"`
 Channel string `json:"channel"`
 Downloads map[string]struct{
  URL string `json:"url"`
  Size int64 `json:"size"`
  Checksums struct{SHA256 string `json:"sha256"`} `json:"checksums"`
 } `json:"downloads"`
}
func (m *manager)installTemplate(ctx context.Context,id,project,version string,updating bool)(map[string]any,error){
 if !templateOK(project)||len(version)>48||!versionPattern.MatchString(version){
  return nil,apiError{400,"프로젝트 또는 버전이 올바르지 않습니다."}
 }
 m.mu.Lock()
 s,err:=m.get(id)
 if err!=nil{m.mu.Unlock();return nil,err}
 if s.busy||s.process!=nil{m.mu.Unlock();return nil,apiError{409,"서버를 중지하고 설치하세요."}}
 if updating && (s.cfg.Template!=project||s.cfg.InstalledVersion==""){
  m.mu.Unlock()
  return nil,apiError{409,"다른 종류의 서버 JAR은 자동 업데이트하지 않습니다. 수동으로 교체하세요."}
 }
 s.busy=true
 m.mu.Unlock()
 defer func(){m.mu.Lock();s.busy=false;m.mu.Unlock()}()
 dest:=filepath.Join(m.dir(id),"server.jar")
 info,jarErr:=os.Lstat(dest)
 if updating {
  if jarErr!=nil||!info.Mode().IsRegular(){return nil,apiError{409,"업데이트할 server.jar이 없습니다."}}
 }else{
  if jarErr==nil{return nil,apiError{409,"server.jar 파일이 이미 있습니다. 기존 파일은 덮어쓰지 않습니다."}}
  if !os.IsNotExist(jarErr){return nil,jarErr}
 }
 uri:=fmt.Sprintf("%s/v3/projects/%s/versions/%s/builds",paperAPI,project,url.PathEscape(version))
 ctx,cancel:=context.WithTimeout(ctx,3*time.Minute);defer cancel()
 raw,err:=officialGET(ctx,uri,1<<20);if err!=nil{return nil,err}
 var builds []officialBuild
 if json.Unmarshal(raw,&builds)!=nil{return nil,apiError{502,"빌드 목록을 확인할 수 없습니다."}}
 var selected *officialBuild
 for i:=range builds{if builds[i].Channel=="STABLE"{selected=&builds[i];break}}
 if selected==nil{return nil,apiError{404,"선택한 버전에 안정 빌드가 없습니다."}}
 jar,ok:=selected.Downloads["server:default"]
 if !ok || jar.Size<1024 || jar.Size>256<<20 || !shaPattern.MatchString(strings.ToLower(jar.Checksums.SHA256)){
  return nil,apiError{502,"공식 빌드 메타데이터가 올바르지 않습니다."}
 }
 download,err:=url.Parse(jar.URL)
 if err!=nil||download.Scheme!="https"||download.Host!=paperDownloadHost||
  download.User!=nil||download.RawQuery!=""||download.Fragment!=""||
  !strings.HasPrefix(download.Path,"/v1/objects/"+strings.ToLower(jar.Checksums.SHA256)+"/")||
  !strings.HasSuffix(download.Path,".jar"){
  return nil,apiError{502,"공식 다운로드 주소가 아닙니다."}
 }
 req,err:=http.NewRequestWithContext(ctx,"GET",jar.URL,nil);if err!=nil{return nil,err}
 req.Header.Set("User-Agent","PConnPanel/0.2 (https://github.com/Pma10/Panel)")
 response,err:=officialClient.Do(req);if err!=nil{return nil,apiError{502,"JAR 다운로드에 실패했습니다."}}
 defer response.Body.Close()
 if response.StatusCode!=200{return nil,apiError{502,"JAR 응답 오류"}}
 tmp:=filepath.Join(m.dir(id),".panel-"+makeID()+".download")
 out,err:=os.OpenFile(tmp,os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600);if err!=nil{return nil,err}
 defer os.Remove(tmp)
 hash:=sha256.New()
 size,copyErr:=io.Copy(io.MultiWriter(out,hash),io.LimitReader(response.Body,jar.Size+1))
 syncErr:=out.Sync();closeErr:=out.Close()
 if copyErr!=nil{return nil,copyErr};if syncErr!=nil{return nil,syncErr};if closeErr!=nil{return nil,closeErr}
 if size!=jar.Size||hex.EncodeToString(hash.Sum(nil))!=strings.ToLower(jar.Checksums.SHA256){
  return nil,apiError{502,"다운로드한 JAR의 SHA-256 또는 크기가 일치하지 않습니다."}
 }
 // This mutation happens only after the complete JAR is hash-verified.
 // Keep one previous JAR on disk so an operator can roll back safely.
 previous:=filepath.Join(m.dir(id),".panel-previous.jar")
 if updating{
  oldBackup:=previous+".older-"+makeID()
  movedOld:=false
  if _,statErr:=os.Lstat(previous);statErr==nil{
   if err:=os.Rename(previous,oldBackup);err!=nil{return nil,err}
   movedOld=true
  }else if !os.IsNotExist(statErr){return nil,statErr}
  if err:=os.Rename(dest,previous);err!=nil{
   if movedOld{_ = os.Rename(oldBackup,previous)}
   return nil,err
  }
  if err:=os.Rename(tmp,dest);err!=nil{
   _ = os.Rename(previous,dest)
   if movedOld{_ = os.Rename(oldBackup,previous)}
   return nil,err
  }
  if movedOld{_ = os.Remove(oldBackup)}
 }else{
  if _,err:=os.Lstat(dest);err==nil{return nil,apiError{409,"설치 중 JAR이 생성되었습니다."}}
  if err:=os.Rename(tmp,dest);err!=nil{return nil,err}
 }
 m.mu.Lock()
 oldCfg:=s.cfg
 s.cfg.Template=project
 s.cfg.RollbackVersion=""
 if updating{s.cfg.RollbackVersion=oldCfg.InstalledVersion}
 s.cfg.InstalledVersion=version
 err=m.saveLocked()
 if err!=nil{
  s.cfg=oldCfg
  if updating{
   failed:=dest+".failed-"+makeID()
   if os.Rename(dest,failed)==nil{
    _ = os.Rename(previous,dest)
    _ = os.Remove(failed)
   }
  }else{_ = os.Remove(dest)}
 }
 m.mu.Unlock()
 if err!=nil{return nil,err}
 verb:="설치";if updating{verb="업데이트"}
 m.log(id,"INFO","공식 "+project+" "+version+" "+verb+" 완료")
 return map[string]any{"project":project,"version":version,"size":size,"sha256":hex.EncodeToString(hash.Sum(nil)),"buildId":selected.ID,"updated":updating},nil
}

/** Switch the verified JAR back to the previous known version; never run while
 *  a Minecraft process or another file/backup operation is active. */
func (m *manager)rollbackJar(id string)(map[string]any,error){
 m.mu.Lock()
 state,err:=m.get(id)
 if err!=nil{m.mu.Unlock();return nil,err}
 if state.busy||state.process!=nil{m.mu.Unlock();return nil,apiError{409,"서버를 중지한 뒤 롤백하세요."}}
 if state.cfg.RollbackVersion==""{m.mu.Unlock();return nil,apiError{404,"롤백할 이전 버전이 없습니다."}}
 state.busy=true
 m.mu.Unlock()
 defer func(){m.mu.Lock();state.busy=false;m.mu.Unlock()}()
 dir:=m.dir(id)
 current:=filepath.Join(dir,"server.jar")
 previous:=filepath.Join(dir,".panel-previous.jar")
 for _,name:=range []string{current,previous}{
  info,err:=os.Lstat(name)
  if err!=nil||!info.Mode().IsRegular(){return nil,apiError{409,"이전 버전 JAR이 없거나 안전한 파일이 아닙니다."}}
 }
 temporary:=filepath.Join(dir,".panel-"+makeID()+".swap")
 if err:=os.Rename(current,temporary);err!=nil{return nil,err}
 if err:=os.Rename(previous,current);err!=nil{
  _=os.Rename(temporary,current)
  return nil,err
 }
 if err:=os.Rename(temporary,previous);err!=nil{
  // The old JAR remains intact in temporary; do not delete it.
  m.log(id,"WARN","JAR 롤백 후 이전 파일 정리 실패: "+temporary)
  return nil,fmt.Errorf("JAR swap incomplete: %w",err)
 }
 m.mu.Lock()
 oldCfg:=state.cfg
 state.cfg.InstalledVersion,state.cfg.RollbackVersion=oldCfg.RollbackVersion,oldCfg.InstalledVersion
 err=m.saveLocked()
 if err!=nil{
  state.cfg=oldCfg
  // Best-effort rollback to the previous disk state. Retain files on error.
  tmp2:=filepath.Join(dir,".panel-"+makeID()+".swap-failed")
  if os.Rename(current,tmp2)==nil{
   if os.Rename(previous,current)==nil{
    _=os.Rename(tmp2,previous)
   }else{_ = os.Rename(tmp2,current)}
  }
 }
 newVersion:=state.cfg.InstalledVersion
 m.mu.Unlock()
 if err!=nil{return nil,err}
 m.log(id,"WARN","서버 JAR 롤백 완료: "+newVersion)
 return map[string]any{"restored":true,"version":newVersion},nil
}
