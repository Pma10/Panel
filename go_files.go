package main

import (
 "errors"
 "io"
 "mime"
 "net/http"
 "os"
 "path/filepath"
 "sort"
 "strings"
 "time"
 "unicode/utf8"
)

const maxUpload = 256 << 20
func safeRelativePath(value string)(string,error){
 if len(value)>1024||strings.ContainsAny(value,"\\:\x00"){return "",apiError{400,"파일 경로가 올바르지 않습니다."}}
 if value==""||value=="."{return "",nil}
 if filepath.IsAbs(value){return "",apiError{403,"절대 경로는 허용되지 않습니다."}}
 parts:=strings.Split(value,"/")
 for _,part:=range parts{
  if part==""||part=="."||part==".."||strings.HasPrefix(part,".panel-"){return "",apiError{400,"안전하지 않은 경로입니다."}}
 }
 return filepath.Join(parts...),nil
}
func (m *manager) filePath(id,path string,allowMissing bool)(string,error){
 m.mu.Lock();_,err:=m.get(id);m.mu.Unlock();if err!=nil{return "",err}
 relative,err:=safeRelativePath(path);if err!=nil{return "",err}
 root:=m.dir(id)
 // Do not follow a replaced or symlinked managed-server root.
 rootInfo,err:=os.Lstat(root)
 if err!=nil{return "",err}
 if !rootInfo.IsDir()||rootInfo.Mode()&os.ModeSymlink!=0{
  return "",apiError{403,"서버 루트 폴더가 변경되었거나 심볼릭 링크입니다."}
 }
 current:=root
 if relative==""{return root,nil}
 parts:=strings.Split(relative,string(filepath.Separator))
 for i,p:=range parts{
  current=filepath.Join(current,p)
  info,statErr:=os.Lstat(current)
  if errors.Is(statErr,os.ErrNotExist)&&allowMissing&&i==len(parts)-1{break}
  if statErr!=nil{return "",statErr}
  if info.Mode()&os.ModeSymlink!=0{return "",apiError{403,"심볼릭 링크 접근이 금지되어 있습니다."}}
  if i<len(parts)-1&&!info.IsDir(){return "",apiError{400,"상위 경로가 폴더가 아닙니다."}}
 }
 return current,nil
}
// File edits are allowed while the server runs; the busy flag still
// serializes them against backups, restores and JAR installs.
func (m *manager) beginMutation(id string)(func(),error){
 _,release,err:=m.acquireMutation(id,false)
 return release,err
}
func (m *manager) listFiles(id,rel string)([]map[string]any,error){
 dir,err:=m.filePath(id,rel,false);if err!=nil{return nil,err}
 entries,err:=os.ReadDir(dir);if err!=nil{return nil,err}
 if len(entries)>10000{return nil,apiError{413,"폴더에 항목이 너무 많습니다."}}
 result:=make([]map[string]any,0,len(entries))
 for _,entry:=range entries{
  if strings.HasPrefix(entry.Name(),".panel-"){continue}
  if entry.Type()&os.ModeSymlink!=0{continue}
  info,err:=entry.Info();if err!=nil{continue}
  if !info.Mode().IsRegular()&&!info.IsDir(){continue}
  kind:="file";if info.IsDir(){kind="folder"}
  result=append(result,map[string]any{"name":entry.Name(),"type":kind,"size":info.Size(),"modified":info.ModTime().UTC().Format(time.RFC3339)})
 }
 sort.Slice(result,func(i,j int)bool{
  it,jt:=result[i]["type"].(string),result[j]["type"].(string)
  if it!=jt{return it=="folder"}
  return strings.ToLower(result[i]["name"].(string))<strings.ToLower(result[j]["name"].(string))
 })
 return result,nil
}
func (m *manager) getFile(id,rel string)(string,os.FileInfo,error){
 if rel==""{return "",nil,apiError{400,"파일 경로를 지정하세요."}}
 full,err:=m.filePath(id,rel,false);if err!=nil{return "",nil,err}
 info,err:=os.Lstat(full);if err!=nil{return "",nil,err}
 if !info.Mode().IsRegular(){return "",nil,apiError{400,"일반 파일만 접근할 수 있습니다."}}
 return full,info,nil
}
func (m *manager) readText(id,rel string)(string,error){
 path,info,err:=m.getFile(id,rel);if err!=nil{return "",err}
 if info.Size()>1<<20{return "",apiError{413,"1MiB 이하 텍스트 파일만 읽을 수 있습니다."}}
 buf,err:=os.ReadFile(path);if err!=nil{return "",err}
 if !utf8.Valid(buf){return "",apiError{415,"UTF-8 텍스트 파일이 아닙니다."}}
 return string(buf),nil
}
func (m *manager) uploadFile(id,rel string,r io.Reader)(int64,error){
 release,err:=m.beginMutation(id);if err!=nil{return 0,err}
 defer release()
 if rel==""||rel=="."{return 0,apiError{400,"파일 이름을 지정하세요."}}
 target,err:=m.filePath(id,rel,true);if err!=nil{return 0,err}
 temp:=filepath.Join(filepath.Dir(target),".panel-"+makeID()+".upload")
 file,err:=os.OpenFile(temp,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600);if err!=nil{return 0,err}
 defer os.Remove(temp)
 total,copyErr:=io.Copy(file,io.LimitReader(r,maxUpload+1))
 syncErr:=file.Sync();closeErr:=file.Close()
 if copyErr!=nil{return 0,copyErr}
 if total>maxUpload{return 0,apiError{413,"업로드 한도는 256MiB입니다."}}
 if syncErr!=nil{return 0,syncErr};if closeErr!=nil{return 0,closeErr}
 if _,err=m.filePath(id,rel,true);err!=nil{return 0,err}
 oldBackup:=""
 if _,err:=os.Lstat(target);err==nil{
  existing,err:=os.Lstat(target);if err!=nil{return 0,err}
  if !existing.Mode().IsRegular(){return 0,apiError{409,"파일만 덮어쓸 수 있습니다."}}
  oldBackup=target+".panel-"+makeID()+".old"
  if err:=os.Rename(target,oldBackup);err!=nil{return 0,err}
 }else if !errors.Is(err,os.ErrNotExist){return 0,err}
 if err:=os.Rename(temp,target);err!=nil{
  if oldBackup!=""{_ = os.Rename(oldBackup,target)}
  return 0,err
 }
 if rel=="server.jar"{
  // A manually uploaded JAR is no longer an officially verified Paper/Folia
  // artifact. Invalidate metadata so the one-click update UI cannot mistake
  // it for the old downloaded binary.
  m.mu.Lock()
  state:=m.servers[id]
  previousCfg:=state.cfg
  state.cfg.Template="manual"
  state.cfg.InstalledVersion=""
  state.cfg.RollbackVersion=""
  persistErr:=m.saveLocked()
  if persistErr!=nil{state.cfg=previousCfg}
  m.mu.Unlock()
  if persistErr!=nil{
   _ = os.Remove(target)
   if oldBackup!=""{_ = os.Rename(oldBackup,target)}
   return 0,persistErr
  }
 }
 if oldBackup!=""{_ = os.Remove(oldBackup)}
 return total,nil
}
func (m *manager) mkdirFile(id,rel string)error{
 release,err:=m.beginMutation(id);if err!=nil{return err};defer release()
 if rel==""||rel=="."{return apiError{400,"폴더 이름을 지정하세요."}}
 full,err:=m.filePath(id,rel,true);if err!=nil{return err}
 return os.Mkdir(full,0700)
}
func (m *manager) deleteFile(id,rel string)error{
 release,err:=m.beginMutation(id);if err!=nil{return err};defer release()
 if rel==""||rel=="."{return apiError{400,"서버 루트 폴더는 삭제할 수 없습니다."}}
 full,err:=m.filePath(id,rel,false);if err!=nil{return err}
 // RemoveAll never follows symlinks inside the tree; filePath already
 // rejected a symlinked target or parent.
 return os.RemoveAll(full)
}
func (m *manager) renameFile(id,from,to string)error{
 release,err:=m.beginMutation(id);if err!=nil{return err};defer release()
 if from==""||from=="."||to==""||to=="."{return apiError{400,"파일 이름을 지정하세요."}}
 old,err:=m.filePath(id,from,false);if err!=nil{return err}
 newPath,err:=m.filePath(id,to,true);if err!=nil{return err}
 if newPath==old||strings.HasPrefix(newPath,old+string(filepath.Separator)){return apiError{400,"폴더를 자기 자신 안으로 옮길 수 없습니다."}}
 if _,err:=os.Lstat(newPath);err==nil{return apiError{409,"대상 파일이 이미 있습니다."}}else if !errors.Is(err,os.ErrNotExist){return err}
 return os.Rename(old,newPath)
}
func (a *panelAPI)filesRoute(w http.ResponseWriter,r *http.Request,id,route,actor string)error{
 rel:=r.URL.Query().Get("path")
 switch route{
 case "files":
  if r.Method=="GET"{
   entries,err:=a.manager.listFiles(id,rel);if err!=nil{return err}
   jsonReply(w,200,map[string]any{"path":rel,"entries":entries});return nil
  }
  if err:=assertMethod(r,"DELETE");err!=nil{return err}
  if err:=a.manager.deleteFile(id,rel);err!=nil{return err}
  a.audit.append(actor,"DELETE /files",id)
  jsonReply(w,200,map[string]bool{"deleted":true});return nil
 case "files/content":
  if err:=assertMethod(r,"GET");err!=nil{return err}
  text,err:=a.manager.readText(id,rel);if err!=nil{return err}
  jsonReply(w,200,map[string]string{"path":rel,"text":text});return nil
 case "files/download":
  if err:=assertMethod(r,"GET");err!=nil{return err}
  location,info,err:=a.manager.getFile(id,rel);if err!=nil{return err}
  file,err:=os.Open(location);if err!=nil{return err}
  defer file.Close()
  w.Header().Set("Content-Type","application/octet-stream")
  w.Header().Set("Cache-Control","no-store")
  w.Header().Set("Content-Disposition",mime.FormatMediaType("attachment",map[string]string{"filename":filepath.Base(location)}))
  http.ServeContent(w,r,filepath.Base(location),info.ModTime(),file)
  return nil
 case "files/upload":
  if err:=assertMethod(r,"PUT");err!=nil{return err}
  if !strings.HasPrefix(r.Header.Get("Content-Type"),"application/octet-stream"){return apiError{415,"바이너리 업로드만 허용합니다."}}
  size,err:=a.manager.uploadFile(id,rel,r.Body);if err!=nil{return err}
  a.audit.append(actor,"PUT /files/upload",id)
  jsonReply(w,201,map[string]any{"path":rel,"size":size});return nil
 case "files/mkdir":
  if err:=assertMethod(r,"POST");err!=nil{return err}
  var input struct{Path string `json:"path"`}
  if err:=decodeBody(r,&input);err!=nil{return err}
  if err:=a.manager.mkdirFile(id,input.Path);err!=nil{return err}
  a.audit.append(actor,"POST /files/mkdir",id)
  jsonReply(w,201,map[string]bool{"created":true});return nil
 case "files/rename":
  if err:=assertMethod(r,"PATCH");err!=nil{return err}
  var input struct{From string `json:"from"`;To string `json:"to"`}
  if err:=decodeBody(r,&input);err!=nil{return err}
  if err:=a.manager.renameFile(id,input.From,input.To);err!=nil{return err}
  a.audit.append(actor,"PATCH /files/rename",id)
  jsonReply(w,200,map[string]bool{"renamed":true});return nil
 case "files/plugins/search":
  if err:=assertMethod(r,"GET");err!=nil{return err}
  results,err:=a.manager.searchPlugins(r.Context(),id,r.URL.Query().Get("source"),r.URL.Query().Get("q"));if err!=nil{return err}
  target,_:=a.manager.pluginTarget(id)
  jsonReply(w,200,map[string]any{"results":results,"gameVersion":target.gameVersion});return nil
 case "files/plugins/install":
  if err:=assertMethod(r,"POST");err!=nil{return err}
  var input struct{Source string `json:"source"`;ID string `json:"id"`}
  if err:=decodeBody(r,&input);err!=nil{return err}
  result,err:=a.manager.installPlugin(r.Context(),id,input.Source,input.ID);if err!=nil{return err}
  a.audit.append(actor,"POST /plugins/install",id)
  jsonReply(w,201,result);return nil
 case "files/extract":
  if err:=assertMethod(r,"POST");err!=nil{return err}
  var input struct{Path string `json:"path"`}
  if err:=decodeBody(r,&input);err!=nil{return err}
  count,err:=a.manager.extractZip(id,input.Path);if err!=nil{return err}
  a.audit.append(actor,"POST /files/extract",id)
  jsonReply(w,200,map[string]int{"files":count});return nil
 case "files/compress":
  if err:=assertMethod(r,"POST");err!=nil{return err}
  var input struct{Folder string `json:"folder"`;Paths []string `json:"paths"`;Name string `json:"name"`}
  if err:=decodeBody(r,&input);err!=nil{return err}
  output,err:=a.manager.compressPaths(id,input.Folder,input.Paths,input.Name);if err!=nil{return err}
  a.audit.append(actor,"POST /files/compress",id)
  jsonReply(w,201,map[string]string{"path":output});return nil
 default:return apiError{404,"파일 API를 찾을 수 없습니다."}
 }
}
