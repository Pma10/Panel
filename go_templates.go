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
func (m *manager)installTemplate(ctx context.Context,id,project,version string)(map[string]any,error){
 if !templateOK(project)||len(version)>48||!versionPattern.MatchString(version){
  return nil,apiError{400,"프로젝트 또는 버전이 올바르지 않습니다."}
 }
 m.mu.Lock()
 s,err:=m.get(id)
 if err!=nil{m.mu.Unlock();return nil,err}
 if s.busy||s.process!=nil{m.mu.Unlock();return nil,apiError{409,"서버를 중지하고 설치하세요."}}
 s.busy=true
 m.mu.Unlock()
 defer func(){m.mu.Lock();s.busy=false;m.mu.Unlock()}()
 dest:=filepath.Join(m.dir(id),"server.jar")
 if _,err:=os.Lstat(dest);err==nil{return nil,apiError{409,"기존 server.jar을 백업하고 삭제해야 합니다."}}
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
 if _,err:=os.Lstat(dest);err==nil{return nil,apiError{409,"설치 중 server.jar이 생성되었습니다."}}
 if err:=os.Rename(tmp,dest);err!=nil{return nil,err}
 m.mu.Lock()
 s.cfg.Template=project
 s.cfg.InstalledVersion=version
 err=m.saveLocked()
 m.mu.Unlock()
 if err!=nil{return nil,err}
 m.log(id,"INFO","공식 "+project+" "+version+" 설치 완료")
 return map[string]any{"project":project,"version":version,"size":size,"sha256":hex.EncodeToString(hash.Sum(nil)),"buildId":selected.ID},nil
}
