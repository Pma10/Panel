package main

import (
 "bufio"
 "context"
 "crypto/rand"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "os"
 "os/exec"
 "net"
 "path/filepath"
 "strconv"
 "strings"
 "sync"
 "time"
)

type serverConfig struct {
 ID string `json:"id"`
 Name string `json:"name"`
 MemoryMb int `json:"memoryMb"`
 Port int `json:"port"`
 Jar string `json:"jar"`
 EulaAccepted bool `json:"eulaAccepted"`
 AutoRestart bool `json:"autoRestart"`
 Template string `json:"template"`
 InstalledVersion string `json:"installedVersion,omitempty"`
 Schedules []schedule `json:"schedules"`
}
type schedule struct {
 ID string `json:"id"`
 Name string `json:"name"`
 Cron string `json:"cron"`
 Type string `json:"type"`
 Enabled bool `json:"enabled"`
 LastRun string `json:"lastRun"`
}
type logEntry struct {
 Time string `json:"time"`
 Level string `json:"level"`
 Message string `json:"message"`
}
type managedProcess struct{
 cmd *exec.Cmd
 stdin io.WriteCloser
 done chan struct{}
 state string
 started time.Time
 expectedStop bool
}
type managedServer struct{
 cfg serverConfig
 process *managedProcess
 busy bool
 logs []logEntry
 subscribers map[chan logEntry]struct{}
 mcStatus *minecraftStatus
 memoryGB float64
 memoryValid bool
}
type manager struct{
 mu sync.Mutex
 root,javaBin string
 servers map[string]*managedServer
 closing bool
 stopScheduler chan struct{}
 crashHistory map[string][]time.Time
 pendingRestarts map[string]*time.Timer
}
func makeID()string{
 b:=make([]byte,8)
 if _,err:=rand.Read(b);err!=nil{panic(err)}
 return hex.EncodeToString(b)
}
func newManager(root,javaBin string)(*manager,error){
 if err:=os.MkdirAll(filepath.Join(root,"servers"),0700);err!=nil{return nil,err}
 if err:=os.MkdirAll(filepath.Join(root,"backups"),0700);err!=nil{return nil,err}
 m:=&manager{root:root,javaBin:javaBin,servers:map[string]*managedServer{},stopScheduler:make(chan struct{}),crashHistory:map[string][]time.Time{},pendingRestarts:map[string]*time.Timer{}}
 buf,err:=os.ReadFile(filepath.Join(root,"config.json"))
 if err!=nil && !errors.Is(err,os.ErrNotExist){return nil,err}
 if len(buf)>0{
  var file struct{Servers []serverConfig `json:"servers"`}
  if err:=json.Unmarshal(buf,&file);err!=nil{return nil,fmt.Errorf("invalid config.json: %w",err)}
  for _,c:=range file.Servers{
   if len(c.ID)!=16 || !isHex(c.ID){continue}
   if c.Jar==""{c.Jar="server.jar"}
   m.servers[c.ID]=&managedServer{cfg:c,subscribers:map[chan logEntry]struct{}{}}
   m.loadPreviousLog(c.ID)
  }
 }
 go m.scheduleLoop()
 go m.statusLoop()
 return m,nil
}
func (m *manager)loadPreviousLog(id string){
 logfile:=filepath.Join(m.dir(id),"logs","latest.log")
 file,err:=os.Open(logfile);if err!=nil{return}
 defer file.Close()
 info,err:=file.Stat();if err!=nil||!info.Mode().IsRegular(){return}
 const maxTail int64=64*1024
 offset:=int64(0)
 if info.Size()>maxTail{
  offset=info.Size()-maxTail
  if _,err=file.Seek(offset,io.SeekStart);err!=nil{return}
 }
 buf,err:=io.ReadAll(io.LimitReader(file,maxTail));if err!=nil{return}
 lines:=strings.Split(string(buf),"\n")
 if offset>0 && len(lines)>0{lines=lines[1:]}
 if len(lines)>100{lines=lines[len(lines)-100:]}
 loaded:=[]logEntry{}
 for _,line:=range lines{
  line=strings.TrimSpace(line)
  if line==""{continue}
  if len(line)>2048{line=line[:2048]}
  level:="INFO"
  if strings.Contains(line,"/ERROR")||strings.Contains(line," [ERROR]"){level="ERROR"
  }else if strings.Contains(line,"/WARN")||strings.Contains(line," [WARN]"){level="WARN"}
  loaded=append(loaded,logEntry{Time:"이전",Level:level,Message:line})
 }
 if state:=m.servers[id];state!=nil{state.logs=loaded}
}

func isHex(s string)bool{_,err:=hex.DecodeString(s);return err==nil}
func (m *manager) get(id string)(*managedServer,error){
 s,ok:=m.servers[id];if !ok{return nil,apiError{404,"서버를 찾을 수 없습니다."}};return s,nil
}
func (m *manager) dir(id string)string{return filepath.Join(m.root,"servers",id)}
func (m *manager) saveLocked()error{
 f:=struct{Servers []serverConfig `json:"servers"`}{Servers:[]serverConfig{}}
 for _,s:=range m.servers{f.Servers=append(f.Servers,s.cfg)}
 buf,err:=json.MarshalIndent(f,"","  ");if err!=nil{return err}
 tmp:=filepath.Join(m.root,".panel-"+makeID()+".json")
 file,err:=os.OpenFile(tmp,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
 if err!=nil{return err}
 if _,err=file.Write(buf);err!=nil{file.Close();os.Remove(tmp);return err}
 if err=file.Sync();err!=nil{file.Close();os.Remove(tmp);return err}
 if err=file.Close();err!=nil{os.Remove(tmp);return err}
 if err:=os.Rename(tmp,filepath.Join(m.root,"config.json"));err!=nil{os.Remove(tmp);return err}
 if directory,err:=os.Open(m.root);err==nil{_ = directory.Sync();_ = directory.Close()}
 return nil
}
func (m *manager) describe(s *managedServer)map[string]any{
 state,uptime:="stopped","—"
 if s.process!=nil{state=s.process.state;uptime=fmt.Sprintf("%d초",int(time.Since(s.process.started).Seconds()))}
 if s.process==nil&&orphanJavaRunning(m.dir(s.cfg.ID)){state="unmanaged"}
 var players,maxPlayers,mem any
 version:=s.cfg.InstalledVersion
 if s.mcStatus!=nil&&time.Since(s.mcStatus.CheckedAt)<60*time.Second{
  players=s.mcStatus.Players;maxPlayers=s.mcStatus.MaxPlayers
  if s.mcStatus.Version!=""{version=s.mcStatus.Version}
 }
 if s.memoryValid{mem=s.memoryGB}
 return map[string]any{
  "id":s.cfg.ID,"name":s.cfg.Name,"kind":"마인크래프트","status":state,
  "memoryMb":s.cfg.MemoryMb,"memoryLimitGb":float64(s.cfg.MemoryMb)/1024,"memoryGb":mem,
  "players":players,"maxPlayers":maxPlayers,"tps":nil,"mspt":nil,"cpu":nil,"port":s.cfg.Port,
  "jar":s.cfg.Jar,"version":version,"directory":m.dir(s.cfg.ID),"uptime":uptime,
  "eulaAccepted":s.cfg.EulaAccepted,"autoRestart":s.cfg.AutoRestart,
  "template":s.cfg.Template,"installedVersion":s.cfg.InstalledVersion,
 }
}
func (m *manager) list()[]map[string]any{
 m.mu.Lock();defer m.mu.Unlock()
 result:=[]map[string]any{}
 for _,s:=range m.servers{result=append(result,m.describe(s))}
 return result
}
func (m *manager) summary(id string)(map[string]any,error){
 m.mu.Lock();defer m.mu.Unlock()
 s,err:=m.get(id);if err!=nil{return nil,err}
 return m.describe(s),nil
}
func (m *manager) startup(id string)(serverConfig,error){
 m.mu.Lock();defer m.mu.Unlock()
 s,err:=m.get(id);if err!=nil{return serverConfig{},err}
 return s.cfg,nil
}
func (m *manager) create(c serverConfig)(map[string]any,error){
 if len(strings.TrimSpace(c.Name))==0||len(c.Name)>64{return nil,apiError{400,"서버 이름은 1~64자여야 합니다."}}
 if c.Port<1024||c.Port>65535{return nil,apiError{400,"포트 범위는 1024~65535입니다."}}
 if c.MemoryMb==0{c.MemoryMb=2048}
 if c.MemoryMb<512||c.MemoryMb>32768{return nil,apiError{400,"메모리 범위는 512~32768MiB입니다."}}
 if c.Template==""{c.Template="manual"}
 if c.Template!="manual"&&c.Template!="paper"&&c.Template!="folia"{return nil,apiError{400,"템플릿이 올바르지 않습니다."}}
 m.mu.Lock();defer m.mu.Unlock()
 if m.closing{return nil,apiError{503,"종료 중입니다."}}
 if len(m.servers)>=100{return nil,apiError{409,"서버 수 제한을 초과했습니다."}}
 for _,s:=range m.servers{if s.cfg.Port==c.Port{return nil,apiError{409,"중복 포트입니다."}}}
 c.ID=makeID();c.Jar="server.jar";c.Schedules=[]schedule{}
 dir:=m.dir(c.ID)
 if err:=os.Mkdir(dir,0700);err!=nil{return nil,err}
 success:=false
 defer func(){if !success{os.RemoveAll(dir)}}()
 if err:=os.WriteFile(filepath.Join(dir,"eula.txt"),[]byte(fmt.Sprintf("eula=%t\n",c.EulaAccepted)),0600);err!=nil{return nil,err}
 if err:=os.WriteFile(filepath.Join(dir,"server.properties"),[]byte(fmt.Sprintf("server-port=%d\nonline-mode=true\nenable-rcon=false\n",c.Port)),0600);err!=nil{return nil,err}
 s:=&managedServer{cfg:c,subscribers:map[chan logEntry]struct{}{}}
 m.servers[c.ID]=s
 if err:=m.saveLocked();err!=nil{delete(m.servers,c.ID);return nil,err}
 success=true
 return m.describe(s),nil
}
func validJar(name string)bool{
 if len(name)<5||len(name)>100||!strings.HasSuffix(strings.ToLower(name),".jar"){return false}
 for _,r:=range name{if !((r>='a'&&r<='z')||(r>='A'&&r<='Z')||(r>='0'&&r<='9')||r=='.'||r=='_'||r=='-'){return false}}
 return true
}
func (m *manager) update(id string,body map[string]json.RawMessage)(map[string]any,error){
 m.mu.Lock();defer m.mu.Unlock()
 s,err:=m.get(id);if err!=nil{return nil,err}
 if s.process!=nil||s.busy{return nil,apiError{409,"서버를 중지한 후 수정하세요."}}
 old:=s.cfg;next:=old
 if v,ok:=body["name"];ok{if json.Unmarshal(v,&next.Name)!=nil||strings.TrimSpace(next.Name)==""||len(next.Name)>64{return nil,apiError{400,"이름이 올바르지 않습니다."}}}
 if v,ok:=body["memoryMb"];ok{if json.Unmarshal(v,&next.MemoryMb)!=nil||next.MemoryMb<512||next.MemoryMb>32768{return nil,apiError{400,"메모리가 올바르지 않습니다."}}}
 if v,ok:=body["jar"];ok{if json.Unmarshal(v,&next.Jar)!=nil||!validJar(next.Jar){return nil,apiError{400,"JAR 이름이 올바르지 않습니다."}}}
 if v,ok:=body["autoRestart"];ok{if json.Unmarshal(v,&next.AutoRestart)!=nil{return nil,apiError{400,"자동 재시작 값이 올바르지 않습니다."}}}
 if v,ok:=body["eulaAccepted"];ok{if json.Unmarshal(v,&next.EulaAccepted)!=nil{return nil,apiError{400,"EULA 값이 올바르지 않습니다."}}}
 eulaChanged:=old.EulaAccepted!=next.EulaAccepted
 if eulaChanged{
  if err:=os.WriteFile(filepath.Join(m.dir(id),"eula.txt"),[]byte(fmt.Sprintf("eula=%t\n",next.EulaAccepted)),0600);err!=nil{return nil,err}
 }
 s.cfg=next
 if err:=m.saveLocked();err!=nil{
  s.cfg=old
  if eulaChanged{_ = os.WriteFile(filepath.Join(m.dir(id),"eula.txt"),[]byte(fmt.Sprintf("eula=%t\n",old.EulaAccepted)),0600)}
  return nil,err
 }
 return m.describe(s),nil
}
func javaEnv()[]string{
 keep:=map[string]bool{"PATH":true,"HOME":true,"USER":true,"LANG":true,"TZ":true,"JAVA_HOME":true,
 "TMPDIR":true,"TEMP":true,"TMP":true,"SystemRoot":true,"USERPROFILE":true,"APPDATA":true,
 "LOCALAPPDATA":true,"PATHEXT":true}
 env:=[]string{}
 for _,v:=range os.Environ(){k,_,_:=strings.Cut(v,"=");if keep[k]{env=append(env,v)}}
 return env
}
func (m *manager) log(id,level,msg string){
 m.mu.Lock();defer m.mu.Unlock()
 s,ok:=m.servers[id];if !ok{return}
 if len(msg)>2048{msg=msg[:2048]}
 e:=logEntry{Time:time.Now().Format("15:04:05"),Level:level,Message:msg}
 s.logs=append(s.logs,e)
 if len(s.logs)>400{s.logs=append([]logEntry(nil),s.logs[len(s.logs)-400:]...)}
 for ch:=range s.subscribers{select{case ch<-e:default:close(ch);delete(s.subscribers,ch)}}
}
func (m *manager) history(id string)([]logEntry,error){
 m.mu.Lock();defer m.mu.Unlock()
 s,err:=m.get(id);if err!=nil{return nil,err}
 return append([]logEntry{},s.logs...),nil
}
func (m *manager) subscribe(id string)(<-chan logEntry,func(),error){
 m.mu.Lock();defer m.mu.Unlock()
 s,err:=m.get(id);if err!=nil{return nil,nil,err}
 if len(s.subscribers)>=32{return nil,nil,apiError{429,"로그 구독 한도를 초과했습니다."}}
 ch:=make(chan logEntry,64);s.subscribers[ch]=struct{}{}
 return ch,func(){m.mu.Lock();defer m.mu.Unlock();if _,ok:=s.subscribers[ch];ok{delete(s.subscribers,ch);close(ch)}},nil
}
func scanLines(r io.Reader,cb func(string)){
 scanner:=bufio.NewScanner(r);scanner.Buffer(make([]byte,8192),256*1024)
 for scanner.Scan(){cb(scanner.Text())}
 if err:=scanner.Err();err!=nil{cb("[console stream error: "+err.Error()+"]")}
}
func (m *manager) start(id string)(map[string]any,error){
 m.mu.Lock()
 s,err:=m.get(id);if err!=nil{m.mu.Unlock();return nil,err}
 if s.process!=nil||s.busy||m.closing{m.mu.Unlock();return nil,apiError{409,"서버가 실행 중이거나 작업 중입니다."}}
 if timer:=m.pendingRestarts[id];timer!=nil{timer.Stop();delete(m.pendingRestarts,id)}
 if !s.cfg.EulaAccepted{m.mu.Unlock();return nil,apiError{409,"Minecraft EULA 동의가 필요합니다."}}
 if !validJar(s.cfg.Jar){m.mu.Unlock();return nil,apiError{400,"JAR 이름이 올바르지 않습니다."}}
 folder:=m.dir(id)
 rootInfo,rootErr:=os.Lstat(folder)
 if rootErr!=nil||!rootInfo.IsDir()||rootInfo.Mode()&os.ModeSymlink!=0{
  m.mu.Unlock();return nil,apiError{409,"관리 서버 폴더가 누락됐거나 안전하지 않습니다."}
 }
 if orphanJavaRunning(folder) {m.mu.Unlock();return nil,apiError{409,"이전 패널에서 실행한 Java가 아직 살아 있습니다. 먼저 기존 프로세스를 안전하게 종료하세요."}}
 portAddr:=net.JoinHostPort("127.0.0.1",strconv.Itoa(s.cfg.Port))
 probe,portErr:=net.Listen("tcp",portAddr)
 if portErr!=nil{m.mu.Unlock();return nil,apiError{409,"서버 포트가 이미 사용 중입니다. 기존 Minecraft 프로세스가 실행 중인지 확인하세요."}}
 _=probe.Close()
 jar:=filepath.Join(folder,s.cfg.Jar)
 info,err:=os.Lstat(jar)
 if err!=nil||!info.Mode().IsRegular(){m.mu.Unlock();return nil,apiError{409,"서버 JAR 파일을 업로드하세요."}}
 cmd:=exec.Command(m.javaBin,fmt.Sprintf("-Xms%dM",min(s.cfg.MemoryMb,512)),
  fmt.Sprintf("-Xmx%dM",s.cfg.MemoryMb),"-jar",s.cfg.Jar,"nogui")
 cmd.Dir=folder;cmd.Env=javaEnv();configureJavaChild(cmd)
 stdout,err:=cmd.StdoutPipe();if err!=nil{m.mu.Unlock();return nil,err}
 stderr,err:=cmd.StderrPipe();if err!=nil{m.mu.Unlock();return nil,err}
 stdin,err:=cmd.StdinPipe();if err!=nil{m.mu.Unlock();return nil,err}
 if err:=cmd.Start();err!=nil{m.mu.Unlock();stdin.Close();return nil,apiError{500,"Java 실행 실패: "+err.Error()}}
 if err:=os.WriteFile(filepath.Join(folder,".panel-process"),[]byte(strconv.Itoa(cmd.Process.Pid)+"\n"),0600);err!=nil{
  _=cmd.Process.Kill();_ = cmd.Wait();m.mu.Unlock();stdin.Close()
  return nil,apiError{500,"Java PID 기록에 실패해 실행을 취소했습니다."}
 }
 p:=&managedProcess{cmd:cmd,stdin:stdin,done:make(chan struct{}),state:"starting",started:time.Now()}
 s.process=p
 result:=m.describe(s)
 m.mu.Unlock()
 m.log(id,"INFO",fmt.Sprintf("Java 시작 PID %d",cmd.Process.Pid))
 var pipes sync.WaitGroup
 pipes.Add(2)
 go func(){defer pipes.Done();scanLines(stdout,func(line string){m.log(id,"INFO",line)})}()
 go func(){defer pipes.Done();scanLines(stderr,func(line string){m.log(id,"WARN",line)})}()
 go func(){
  pipes.Wait()
  err:=cmd.Wait()
  stdin.Close()
  _=os.Remove(filepath.Join(folder,".panel-process"))
  m.mu.Lock()
  if s.process==p{s.process=nil;s.mcStatus=nil;s.memoryValid=false}
  restart:=err!=nil&&!p.expectedStop&&s.cfg.AutoRestart&&!m.closing
  m.mu.Unlock()
  if err!=nil{m.log(id,"WARN","Java 종료: "+err.Error())}else{m.log(id,"INFO","Java 정상 종료")}
  close(p.done)
  if restart{m.scheduleCrashRestart(id,p.started)}
 }()
 return result,nil
}
func (m *manager) command(id,raw string)error{
 if len(raw)==0||len(raw)>512||strings.ContainsAny(raw,"\r\n\x00"){return apiError{400,"명령어는 1~512자 한 줄이어야 합니다."}}
 m.mu.Lock();s,err:=m.get(id)
 if err!=nil{m.mu.Unlock();return err}
 p:=s.process
 if p==nil||p.state=="stopping"{m.mu.Unlock();return apiError{409,"서버가 실행 중이 아닙니다."}}
 stdin:=p.stdin
 m.mu.Unlock()
 _,err=io.WriteString(stdin,raw+"\n")
 if err!=nil{return apiError{409,"서버 콘솔에 전송할 수 없습니다."}}
 return nil
}
func (m *manager) stop(id string)error{
 m.mu.Lock();s,err:=m.get(id)
 if err!=nil{m.mu.Unlock();return err}
 p:=s.process
 if p==nil{
  if timer:=m.pendingRestarts[id];timer!=nil{timer.Stop();delete(m.pendingRestarts,id);m.mu.Unlock();return nil}
  m.mu.Unlock();return apiError{409,"서버가 중지 상태입니다."}
 }
 if p.state=="stopping"{m.mu.Unlock();return nil}
 p.state="stopping";p.expectedStop=true;m.mu.Unlock()
 _,_=io.WriteString(p.stdin,"stop\n")
 go func(){
  select{case <-p.done:return;case <-time.After(25*time.Second):}
  if p.cmd.Process!=nil{p.cmd.Process.Kill()}
 }()
 return nil
}
func (m *manager) restart(id string)(map[string]any,error){
 m.mu.Lock();s,err:=m.get(id);if err!=nil{m.mu.Unlock();return nil,err}
 p:=s.process;m.mu.Unlock()
 if p!=nil{
  if err=m.stop(id);err!=nil{return nil,err}
  select{case <-p.done:case <-time.After(40*time.Second):return nil,apiError{504,"서버 종료 시간 초과"}}
 }
 return m.start(id)
}
func (m *manager) scheduleCrashRestart(id string,started time.Time){
 m.mu.Lock()
 s,ok:=m.servers[id]
 if !ok||m.closing||!s.cfg.AutoRestart||s.process!=nil||m.pendingRestarts[id]!=nil{
  m.mu.Unlock();return
 }
 now:=time.Now()
 recent:=[]time.Time{}
 for _,at:=range m.crashHistory[id]{if now.Sub(at)<10*time.Minute{recent=append(recent,at)}}
 if now.Sub(started)>10*time.Minute{recent=nil}
 if len(recent)>=3{
  m.crashHistory[id]=recent;m.mu.Unlock()
  m.log(id,"ERROR","10분 동안 3회 재시작 실패: 자동 재시작을 중단했습니다.")
  return
 }
 recent=append(recent,now)
 m.crashHistory[id]=recent
 delay:=time.Duration(5<<uint(len(recent)-1))*time.Second
 m.pendingRestarts[id]=time.AfterFunc(delay,func(){
  m.mu.Lock()
  delete(m.pendingRestarts,id)
  stopped:=m.closing||!m.servers[id].cfg.AutoRestart
  m.mu.Unlock()
  if stopped{return}
  if _,err:=m.start(id);err!=nil{m.log(id,"ERROR","자동 재시작 실패: "+err.Error())}
 })
 m.mu.Unlock()
 m.log(id,"WARN",fmt.Sprintf("비정상 종료: %s 후 자동 재시작 (%d/3)",delay,len(recent)))
}
func (m *manager) shutdown(ctx context.Context)error{
 m.mu.Lock()
 if !m.closing{m.closing=true;close(m.stopScheduler)}
 for id,timer:=range m.pendingRestarts{timer.Stop();delete(m.pendingRestarts,id)}
 ids:=[]string{}
 for id,s:=range m.servers{if s.process!=nil{ids=append(ids,id)}}
 m.mu.Unlock()
 for _,id:=range ids{_ = m.stop(id)}
 ticker:=time.NewTicker(100*time.Millisecond);defer ticker.Stop()
 for{
  m.mu.Lock();active:=0
  for _,s:=range m.servers{if s.process!=nil{active++}}
  m.mu.Unlock()
  if active==0{return nil}
  select{case <-ticker.C:case <-ctx.Done():
   m.mu.Lock()
   for _,s:=range m.servers{if s.process!=nil&&s.process.cmd.Process!=nil{s.process.cmd.Process.Kill()}}
   m.mu.Unlock()
   return ctx.Err()
  }
 }
}
func (m *manager) scheduleLoop(){
 ticker:=time.NewTicker(30*time.Second);defer ticker.Stop()
 for{select{case <-m.stopScheduler:return;case moment:=<-ticker.C:m.scheduleTick(moment)}}
}
