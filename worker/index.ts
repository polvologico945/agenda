import {DIGITS,normalize,validCPF,validateStudent,validateLesson,pinError} from './rules';
import {randomToken,sha,hmacCPF,pbkdf2,timingEqual,encrypt,decrypt} from './crypto';
interface Env {
 DB:D1Database;PHOTOS:R2Bucket;ASSETS:FetchHandler;
 CPF_HMAC_SECRET:string;DATA_ENCRYPTION_KEY:string;RESEND_API_KEY:string;EMAIL_FROM:string;
 TURNSTILE_SECRET:string;APP_URL:string;ENVIRONMENT:string;
}
type Obj=Record<string,unknown>;
const serialize=(v:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
const fail=(message:string,status=400)=>serialize({error:message},status);
const cookieName='agenda_session';
const iso=(offsetMs=0)=>new Date(Date.now()+offsetMs).toISOString();
const clean=(v:unknown,max=300)=>String(v??'').trim().slice(0,max);
function need(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(message);}
function secrets(env:Env){if(!env.CPF_HMAC_SECRET||env.CPF_HMAC_SECRET.length<32||!env.DATA_ENCRYPTION_KEY||env.DATA_ENCRYPTION_KEY.length<32)throw new Error('Secrets de segurança não configurados.');}
async function body(request:Request):Promise<Obj>{if(!(request.headers.get('content-type')||'').startsWith('application/json'))throw new Error('Corpo JSON obrigatório.');const raw=await request.text();if(raw.length>100_000)throw new Error('Requisição muito grande.'); const parsed=JSON.parse(raw);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('Dados JSON inválidos.');return parsed;}
function setCookie(token:string,seconds:number,secure:boolean,remember:boolean){return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax${secure?'; Secure':''}${remember?`; Max-Age=${seconds}`:''}`;}
const clearCookie=(secure:boolean)=>`${cookieName}=; Path=/; HttpOnly; SameSite=Lax${secure?'; Secure':''}; Max-Age=0`;
async function session(req:Request,env:Env){
 const t=(req.headers.get('cookie')||'').match(/(?:^|;\s*)agenda_session=([0-9a-f]{64})(?:;|$)/)?.[1]; if(!t)return null;
 return env.DB.prepare(`SELECT i.* ,s.token_digest AS session_digest FROM sessions s JOIN instructors i ON i.id=s.instructor_id WHERE s.token_digest=? AND s.expires_at>? AND i.verified_at IS NOT NULL`).bind(await sha(t),iso()).first<Record<string,any>>();
}
async function createSession(env:Env,instructorId:string,remember:boolean,req:Request){
 const t=randomToken();const expires=remember?30*86400:12*3600;
 await env.DB.prepare('INSERT INTO sessions(token_digest,instructor_id,expires_at,device_label) VALUES(?,?,?,?)').bind(await sha(t),instructorId,iso(expires*1000),deviceLabel(req.headers.get('user-agent')||'')).run();
 return setCookie(t,expires,new URL(req.url).protocol==='https:',remember);
}
function deviceLabel(ua:string){return `${/iPhone|iPad/i.test(ua)?'iOS':/Android/i.test(ua)?'Android':/Windows/i.test(ua)?'Windows':/Mac/i.test(ua)?'macOS':'Outro sistema'} · ${/Firefox/i.test(ua)?'Firefox':/Edg\//i.test(ua)?'Edge':/Chrome/i.test(ua)?'Chrome':/Safari/i.test(ua)?'Safari':'Navegador'}`;}
async function throttle(env:Env,req:Request,route:string,maximum=8,windowMinutes=15){
 const addr=req.headers.get('CF-Connecting-IP')||req.headers.get('X-Forwarded-For')||'local';
 const key=await sha(route+':'+addr+':'+env.CPF_HMAC_SECRET);
 await env.DB.prepare(`INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<? THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN rate_limits.reset_at<? THEN excluded.reset_at ELSE rate_limits.reset_at END`).bind(key,iso(windowMinutes*60_000),iso(),iso()).run();
 const row=await env.DB.prepare('SELECT count FROM rate_limits WHERE key=?').bind(key).first<{count:number}>();
 if((row?.count??0)>maximum)return false;return true;
}
async function captcha(req:Request,env:Env,token:string){
 if(!env.TURNSTILE_SECRET||!token)return false;
 const form=new URLSearchParams({secret:env.TURNSTILE_SECRET,response:token,remoteip:req.headers.get('CF-Connecting-IP')||''});
 const res=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:form});
 const r=await res.json() as {success:boolean};return r.success===true;
}
async function sendEmail(env:Env,to:string,subject:string,html:string){
 need(env.RESEND_API_KEY&&env.EMAIL_FROM,'Serviço de e-mail ainda não configurado.');
 const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,html})});
 if(!res.ok)throw new Error('Não foi possível enviar o e-mail. Verifique o domínio e o serviço de e-mail.');
}
async function issueToken(env:Env,id:string,purpose:'verify'|'reset'){
 const t=randomToken();await env.DB.prepare('DELETE FROM tokens WHERE instructor_id=? AND purpose=?').bind(id,purpose).run();
 await env.DB.prepare('INSERT INTO tokens(token_digest,instructor_id,purpose,expires_at) VALUES(?,?,?,?)').bind(await sha(t),id,purpose,iso((purpose==='verify'?24*60:30)*60_000)).run();return t;
}
const escapeHTML=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
async function sendLink(env:Env,user:{id:string;name:string;email:string},purpose:'verify'|'reset'){
 const token=await issueToken(env,user.id,purpose);
 const verify=purpose==='verify';const path=verify?'/verificar':'/redefinir';
 const link=`${env.APP_URL.replace(/\/$/,'')}${path}?token=${encodeURIComponent(token)}`;
 const subject=verify?'Confirme seu e-mail · Agenda CNH':'Redefina sua senha · Agenda CNH';
 await sendEmail(env,user.email,subject,`<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#17314b"><h1>Agenda CNH</h1><p>Olá, ${escapeHTML(user.name)}.</p><p>${verify?'Confirme seu e-mail para ativar sua conta.':'Você solicitou a troca de sua senha.'}</p><p><a href="${link}" style="display:inline-block;background:#13416c;color:white;text-decoration:none;padding:14px 24px;border-radius:10px">${verify?'Confirmar e-mail':'Criar nova senha'}</a></p><p>Este link expira em ${verify?'24 horas':'30 minutos'}. Se não foi você, ignore.</p></div>`);
}
function safeInstructor(i:Record<string,any>){return {id:i.id,name:i.name,email:i.email,phone:i.phone||'',categories:(i.categories||'A,B').split(','),photo:!!i.photo_key,verified_device:i.verified_device||''};}
async function studentResponse(row:Record<string,any>,env:Env){return {...row,cpf:row.cpf_cipher?await decrypt(row.cpf_cipher,env.DATA_ENCRYPTION_KEY):'',cpf_cipher:undefined,cpf_digest:undefined};}
async function conflict(env:Env,owner:string,start:string,end:string,except?:string){return env.DB.prepare(`SELECT s.name FROM lessons l JOIN students s ON s.id=l.student_id WHERE l.instructor_id=? AND (? IS NULL OR l.id!=?) AND s.deleted_at IS NULL AND s.archived_at IS NULL AND s.status!='finalizada' AND ?<l.end_local AND ?>l.start_local LIMIT 1`).bind(owner,except||null,except||null,start,end).first<{name:string}>();}
const errorConflict=(name?:string)=>fail(name?`Horário já agendado para ${name}. Altere a data ou o horário.`:'Horário já agendado para outro aluno. Altere a data ou o horário.',409);
async function handle(req:Request,env:Env):Promise<Response>{
 const url=new URL(req.url),path=url.pathname,method=req.method;
 if(method!=='GET'&&method!=='HEAD'&&method!=='OPTIONS'){
  const origin=req.headers.get('Origin');const allowed=new URL(env.APP_URL||req.url).origin;
  if(!origin||(origin!==url.origin&&origin!==allowed))return fail('Origem da requisição não autorizada.',403);
 }
 if(method==='POST'&&path==='/api/auth/register'){
  secrets(env);if(!await throttle(env,req,'register',5,60))return fail('Muitas tentativas de cadastro. Tente mais tarde.',429);
  const d=await body(req),name=clean(d.name,100).replace(/\s+/g,' '),email=clean(d.email,254).toLowerCase(),cpf=DIGITS(d.cpf),pin=clean(d.pin,20);
  need(name.split(' ').length>=2&&name.length>=5,'Informe nome e sobrenome.');need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'E-mail inválido.');
  need(validCPF(cpf),'CPF inválido.');const err=pinError(pin,cpf);need(!err,err||'Senha inválida.');
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM||!env.TURNSTILE_SECRET)return fail('Cadastro indisponível até configurar envio de e-mails e verificação antirobô.',503);
  if(!await captcha(req,env,clean(d.turnstile,2048)))return fail('Confirme a verificação antirobô antes de continuar.',403);
  const digest=await hmacCPF(cpf,env.CPF_HMAC_SECRET),existing=await env.DB.prepare('SELECT id FROM instructors WHERE email=? OR cpf_digest=?').bind(email,digest).first();
  if(existing)return fail('CPF ou e-mail já cadastrado. Use a opção de recuperação de acesso.',409);
  const {salt,hash}=await pbkdf2(pin),id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO instructors(id,name,email,cpf_digest,password_salt,password_hash) VALUES(?,?,?,?,?,?)').bind(id,name,email,digest,salt,hash).run();
  try{await sendLink(env,{id,name,email},'verify');}catch(e){await env.DB.prepare('DELETE FROM instructors WHERE id=?').bind(id).run();throw e;}
  return serialize({message:'Cadastro recebido. Verifique seu e-mail para ativar a conta.'},201);
 }
 if(method==='POST'&&path==='/api/auth/verify'){
  if(!await throttle(env,req,'verify',15,30))return fail('Muitas tentativas.',429);
  const d=await body(req),digest=await sha(clean(d.token,256));
  const row=await env.DB.prepare(`SELECT t.instructor_id,i.verified_at FROM tokens t JOIN instructors i ON i.id=t.instructor_id WHERE t.token_digest=? AND t.purpose='verify' AND t.expires_at>?`).bind(digest,iso()).first<Record<string,any>>();
  if(!row)return fail('Link inválido ou expirado. Solicite outro e-mail.',400);
  await env.DB.batch([env.DB.prepare('UPDATE instructors SET verified_at=?,verified_device=? WHERE id=?').bind(iso(),deviceLabel(req.headers.get('user-agent')||''),row.instructor_id),env.DB.prepare('DELETE FROM tokens WHERE token_digest=?').bind(digest)]);
  return serialize({message:'E-mail confirmado. Agora você já pode entrar.'});
 }
 if(method==='POST'&&path==='/api/auth/login'){
  secrets(env);if(!await throttle(env,req,'login',12,15))return fail('Muitas tentativas de login. Tente novamente em 15 minutos.',429);
  const d=await body(req),cpf=DIGITS(d.cpf),pin=clean(d.pin,20);
  if(!/^\d{11}$/.test(cpf)||!/^\d{6}$/.test(pin))return fail('CPF ou senha inválidos.',401);
  const digest=await hmacCPF(cpf,env.CPF_HMAC_SECRET),row=await env.DB.prepare('SELECT * FROM instructors WHERE cpf_digest=?').bind(digest).first<Record<string,any>>();
  // Custo comparável para CPF inexistente, evitando enumeração por tempo de resposta.
  const result=await pbkdf2(pin,row?.password_salt||'dummy-salt-32-chars-invalido');
  if(!row||!timingEqual(result.hash,row.password_hash)||row.locked_until&&row.locked_until>iso()){
   if(row){const failCount=Number(row.failed_logins)+1;await env.DB.prepare('UPDATE instructors SET failed_logins=?,locked_until=? WHERE id=?').bind(failCount,failCount>=5?iso(15*60_000):null,row.id).run();}
   return fail('CPF ou senha inválidos. Verifique seus dados ou recupere o acesso.',401);
  }
  if(!row.verified_at)return fail('Confirme seu e-mail antes de entrar.',403);
  await env.DB.prepare('UPDATE instructors SET failed_logins=0,locked_until=NULL WHERE id=?').bind(row.id).run();
  const ck=await createSession(env,row.id,d.remember===true,req);
  return serialize({instructor:safeInstructor(row)},200,{'Set-Cookie':ck});
 }
 if(method==='POST'&&path==='/api/auth/forgot'){
  secrets(env);if(!await throttle(env,req,'forgot',5,60))return fail('Muitas solicitações. Tente novamente mais tarde.',429);
  const d=await body(req),email=clean(d.email,254).toLowerCase();
  const row=await env.DB.prepare('SELECT id,name,email,verified_at FROM instructors WHERE email=?').bind(email).first<Record<string,any>>();
  if(row?.verified_at)await sendLink(env,{id:row.id,name:row.name,email:row.email},'reset');
  return serialize({message:'Se existir uma conta com este e-mail, enviaremos um link de recuperação.'});
 }
 if(method==='POST'&&path==='/api/auth/reset'){
  secrets(env);if(!await throttle(env,req,'reset',8,30))return fail('Muitas tentativas.',429);
  const d=await body(req),digest=await sha(clean(d.token,256));
  const row=await env.DB.prepare("SELECT i.* FROM tokens t JOIN instructors i ON i.id=t.instructor_id WHERE t.token_digest=? AND t.purpose='reset' AND t.expires_at>?").bind(digest,iso()).first<Record<string,any>>();
  if(!row)return fail('Link de redefinição inválido ou expirado.');
  const pin=clean(d.pin,20);need(pin===clean(d.confirmPin,20),'As duas senhas precisam ser iguais.');
  // CPF não é armazenado em texto puro: para o reset, o formulário exige o CPF e o HMAC deve coincidir.
  const cpf=DIGITS(d.cpf);need(validCPF(cpf)&&await hmacCPF(cpf,env.CPF_HMAC_SECRET)===row.cpf_digest,'Confirme o CPF cadastrado.');
  const err=pinError(pin,cpf);need(!err,err||'Senha inválida.');
  const {salt,hash}=await pbkdf2(pin);
  await env.DB.batch([env.DB.prepare('UPDATE instructors SET password_salt=?,password_hash=?,failed_logins=0,locked_until=NULL WHERE id=?').bind(salt,hash,row.id),env.DB.prepare('DELETE FROM tokens WHERE token_digest=?').bind(digest),env.DB.prepare('DELETE FROM sessions WHERE instructor_id=?').bind(row.id)]);
  return serialize({message:'Senha redefinida. Faça login novamente.'});
 }
 if(method==='POST'&&path==='/api/auth/resend'){
  secrets(env);if(!await throttle(env,req,'resend',3,60))return fail('Muitas solicitações. Tente novamente mais tarde.',429);
  const d=await body(req),email=clean(d.email,254).toLowerCase();const row=await env.DB.prepare('SELECT id,name,email FROM instructors WHERE email=? AND verified_at IS NULL').bind(email).first<Record<string,string>>();
  if(row)await sendLink(env,row,'verify');return serialize({message:'Se o cadastro estiver pendente, um novo link será enviado.'});
 }
 const i=await session(req,env);
 if(!i)return fail('Sua sessão expirou. Entre novamente.',401);
 if(method==='GET'&&path==='/api/auth/session')return serialize({instructor:safeInstructor(i)});
 if(method==='POST'&&path==='/api/auth/logout'){
  await env.DB.prepare('DELETE FROM sessions WHERE token_digest=?').bind(i.session_digest).run();return serialize({ok:true},200,{'Set-Cookie':clearCookie(url.protocol==='https:')});
 }
 if(method==='PATCH'&&path==='/api/profile'){
  const d=await body(req),name=clean(d.name,100).replace(/\s+/g,' '),phone=DIGITS(d.phone);
  need(name.split(' ').length>=2,'Informe nome e sobrenome.');need(!phone||phone.length===11,'Informe um celular com DDD (11 dígitos).');
  need(Array.isArray(d.categories)&&d.categories.length>=1,'Escolha pelo menos uma categoria.');
  const categories=[...new Set((d.categories as unknown[]).map(x=>String(x)))].sort();
  need(categories.every(x=>['A','B','C','D','E'].includes(x)),'Categoria inválida.');
  await env.DB.prepare('UPDATE instructors SET name=?,phone=?,categories=? WHERE id=?').bind(name,phone,categories.join(','),i.id).run();
  return serialize({instructor:{...safeInstructor(i),name,phone,categories}});
 }
 if(method==='POST'&&path==='/api/profile/photo'){
  const form=await req.formData(),file=form.get('file');
  if(!(file instanceof File))return fail('Selecione uma imagem.');
  if(file.size>3_000_000)return fail('A foto deve ter no máximo 3 MB.');
  if(!['image/jpeg','image/png'].includes(file.type))return fail('Converta HEIC para JPG antes de enviar.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
  if(!(jpg||png))return fail('Arquivo de imagem inválido.');
  const key=`avatars/${i.id}/${crypto.randomUUID()}.${png?'png':'jpg'}`;
  await env.PHOTOS.put(key,bytes,{httpMetadata:{contentType:png?'image/png':'image/jpeg'}});
  await env.DB.prepare('UPDATE instructors SET photo_key=? WHERE id=?').bind(key,i.id).run();
  if(i.photo_key)await env.PHOTOS.delete(i.photo_key);
  return serialize({ok:true});
 }
 if(method==='GET'&&path==='/api/profile/photo'){
  if(!i.photo_key)return new Response(null,{status:404});
  const o=await env.PHOTOS.get(i.photo_key);if(!o)return new Response(null,{status:404});
  return new Response(o.body,{headers:{'Content-Type':o.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(method==='GET'&&path==='/api/students'){
  const state=url.searchParams.get('state')||'active';if(!['active','archived','deleted'].includes(state))return fail('Estado de listagem inválido.');
  const where=["instructor_id=?",state==='deleted'?"deleted_at>=datetime('now','-70 days')":'deleted_at IS NULL'];
  if(state==='active')where.push('archived_at IS NULL');else if(state==='archived')where.push('archived_at IS NOT NULL');
  if(state==='deleted')where.push('deleted_at IS NOT NULL');
  const vals:unknown[]=[i.id];const search=normalize(clean(url.searchParams.get('search'),80));
  if(search){where.push("search_name LIKE ? ESCAPE '\\'");vals.push('%'+search.replace(/[\\%_]/g,x=>'\\'+x)+'%');}
  const st=url.searchParams.get('status');if(st&&st!=='todos'){where.push('status=?');vals.push(st);}
  const ct=url.searchParams.get('category');if(ct&&ct!=='todas'){where.push('category=?');vals.push(ct);}
  const q=where.join(' AND '),page=Math.max(1,Math.min(100000,Number(url.searchParams.get('page')||1)||1)),descending=url.searchParams.get('order')==='desc';
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM students WHERE '+q).bind(...vals).first<{n:number}>();
  const rows=await env.DB.prepare(`SELECT * FROM students WHERE ${q} ORDER BY search_name ${descending?'DESC':'ASC'},name ${descending?'DESC':'ASC'},id ${descending?'DESC':'ASC'} LIMIT 12 OFFSET ?`).bind(...vals,(page-1)*12).all<Record<string,any>>();
  return serialize({total:count?.n||0,page,items:await Promise.all((rows.results||[]).map(r=>studentResponse(r,env)))});
 }
 if(method==='GET'&&path==='/api/stats'){
  const row=await env.DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='em_andamento' THEN 1 ELSE 0 END) AS active,SUM(amount_total_cents-amount_paid_cents) AS remaining, SUM(lessons_total-lessons_done) AS remainingLessons FROM students WHERE instructor_id=? AND deleted_at IS NULL AND archived_at IS NULL`).bind(i.id).first();
  const month=new Date().toISOString().slice(0,7);const lessons=await env.DB.prepare(`SELECT COUNT(*) AS n FROM lessons l JOIN students s ON s.id=l.student_id WHERE l.instructor_id=? AND l.start_local LIKE ? AND s.deleted_at IS NULL AND s.archived_at IS NULL AND s.status!='finalizada'`).bind(i.id,month+'%').first<{n:number}>();
  return serialize({...(row||{}),scheduled:lessons?.n||0});
 }
 if(method==='POST'&&path==='/api/students'){
  secrets(env);const raw=await body(req),d=validateStudent(raw);
  need([...d.category].every(x=>i.categories.split(',').includes(x)),'Categoria fora das habilitações cadastradas no seu perfil.');
  const initial=raw.initial_lesson&&typeof raw.initial_lesson==='object'&&!Array.isArray(raw.initial_lesson)?validateLesson(raw.initial_lesson as Obj):null;
  if(initial){need(d.status!=='finalizada','Alunos finalizados não podem ter aulas novas.');const found=await conflict(env,i.id,initial.start_local,initial.end_local);if(found)return errorConflict(found.name);}
  const id=crypto.randomUUID(),cpf_digest=d.cpf?await hmacCPF(d.cpf,env.CPF_HMAC_SECRET):null,cpf_cipher=d.cpf?await encrypt(d.cpf,env.DATA_ENCRYPTION_KEY):null;
  const queries=[env.DB.prepare(`INSERT INTO students(id,instructor_id,name,search_name,category,phone,cpf_cipher,cpf_digest,lessons_total,lessons_done,amount_total_cents,amount_paid_cents,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,i.id,d.name,d.search_name,d.category,d.phone,cpf_cipher,cpf_digest,d.lessons_total,d.lessons_done,d.amount_total_cents,d.amount_paid_cents,d.status)];
  if(initial)queries.push(env.DB.prepare('INSERT INTO lessons(id,instructor_id,student_id,start_local,end_local,notes) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),i.id,id,initial.start_local,initial.end_local,initial.notes));
  await env.DB.batch(queries);
  return serialize({id},201);
 }
 const stMatch=path.match(/^\/api\/students\/([0-9a-f-]{36})$/);
 if(stMatch){
  const id=stMatch[1],old=await env.DB.prepare('SELECT * FROM students WHERE id=? AND instructor_id=?').bind(id,i.id).first<Record<string,any>>();if(!old)return fail('Aluno não encontrado.',404);
  if(method==='PATCH'){
   if(old.deleted_at)return fail('Recupere o aluno da lixeira antes de editar.');
   const raw=await body(req),d=validateStudent(raw);need([...d.category].every(x=>i.categories.split(',').includes(x)),'Categoria fora das habilitações cadastradas no perfil.');
   const cpf_digest=d.cpf?await hmacCPF(d.cpf,env.CPF_HMAC_SECRET):null,cpf_cipher=d.cpf?await encrypt(d.cpf,env.DATA_ENCRYPTION_KEY):null;
   await env.DB.prepare(`UPDATE students SET name=?,search_name=?,category=?,phone=?,cpf_cipher=?,cpf_digest=?,lessons_total=?,lessons_done=?,amount_total_cents=?,amount_paid_cents=?,status=?,updated_at=datetime('now') WHERE id=? AND instructor_id=?`).bind(d.name,d.search_name,d.category,d.phone,cpf_cipher,cpf_digest,d.lessons_total,d.lessons_done,d.amount_total_cents,d.amount_paid_cents,d.status,id,i.id).run();
   return serialize({ok:true});
  }
  if(method==='POST'){
   const d=await body(req),action=String(d.action||'');need(['archive','restore','delete','recover'].includes(action),'Ação inválida.');
   if(action==='recover'){need(!!old.deleted_at,'Aluno não está na lixeira.');await env.DB.prepare(`UPDATE students SET deleted_at=NULL,archived_at=NULL,updated_at=datetime('now') WHERE id=? AND instructor_id=?`).bind(id,i.id).run();}
   if(action==='restore'){await env.DB.prepare(`UPDATE students SET archived_at=NULL,updated_at=datetime('now') WHERE id=? AND instructor_id=? AND deleted_at IS NULL`).bind(id,i.id).run();}
   if(action==='archive'){await env.DB.prepare(`UPDATE students SET archived_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND instructor_id=? AND deleted_at IS NULL`).bind(id,i.id).run();}
   if(action==='delete'){await env.DB.prepare(`UPDATE students SET deleted_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND instructor_id=?`).bind(id,i.id).run();}
   return serialize({ok:true});
  }
 }
 if(method==='POST'&&path==='/api/students/bulk'){
  const d=await body(req);need(Array.isArray(d.ids)&&d.ids.length>0&&d.ids.length<=12,'Selecione até 12 alunos por vez.');
  const ids=d.ids.map(String);need(ids.every(id=>/^[0-9a-f-]{36}$/.test(id)),'IDs inválidos.');
  const action=String(d.action||'');need(['archive','delete'].includes(action),'Ação inválida.');
  // Todas as mutações filtradas por instructor_id, inclusive operações em lote.
  const sql=action==='archive'?"UPDATE students SET archived_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND instructor_id=? AND deleted_at IS NULL":"UPDATE students SET deleted_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND instructor_id=? AND deleted_at IS NULL";
  await env.DB.batch(ids.map(id=>env.DB.prepare(sql).bind(id,i.id)));return serialize({ok:true});
 }
 if(method==='GET'&&path==='/api/lessons'){
  const month=url.searchParams.get('month')||new Date().toISOString().slice(0,7);if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))return fail('Mês inválido.');
  const rows=await env.DB.prepare(`SELECT l.*,s.name AS student_name,s.category AS student_category FROM lessons l JOIN students s ON s.id=l.student_id WHERE l.instructor_id=? AND l.start_local>=? AND l.start_local<? AND s.deleted_at IS NULL AND s.archived_at IS NULL AND s.status!='finalizada' ORDER BY l.start_local`).bind(i.id,month+'-01T00:00',month==='9999-12'?'9999-12-31T23:59':nextMonth(month)+'-01T00:00').all();
  return serialize({items:rows.results||[]});
 }
 if(method==='GET'&&path==='/api/students/options'){
  const rows=await env.DB.prepare(`SELECT id,name,category FROM students WHERE instructor_id=? AND archived_at IS NULL AND deleted_at IS NULL AND status!='finalizada' ORDER BY search_name LIMIT 5000`).bind(i.id).all();return serialize({items:rows.results||[]});
 }
 if(method==='POST'&&path==='/api/lessons'){
  const d=await body(req),studentId=clean(d.student_id,50),v=validateLesson(d);
  const s=await env.DB.prepare(`SELECT id,name FROM students WHERE id=? AND instructor_id=? AND deleted_at IS NULL AND archived_at IS NULL AND status!='finalizada'`).bind(studentId,i.id).first();if(!s)return fail('Aluno indisponível para agendamento.',404);
  const found=await conflict(env,i.id,v.start_local,v.end_local);if(found)return errorConflict(found.name);
  const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO lessons(id,instructor_id,student_id,start_local,end_local,notes) VALUES(?,?,?,?,?,?)').bind(id,i.id,studentId,v.start_local,v.end_local,v.notes).run();return serialize({id},201);
 }
 const lessonMatch=path.match(/^\/api\/lessons\/([0-9a-f-]{36})$/);
 if(lessonMatch){
  const id=lessonMatch[1],old=await env.DB.prepare('SELECT * FROM lessons WHERE id=? AND instructor_id=?').bind(id,i.id).first<Record<string,any>>();if(!old)return fail('Aula não encontrada.',404);
  if(method==='DELETE'){await env.DB.prepare('DELETE FROM lessons WHERE id=? AND instructor_id=?').bind(id,i.id).run();return serialize({ok:true});}
  if(method==='PATCH'){
   const d=await body(req),v=validateLesson(d),studentId=clean(d.student_id||old.student_id,50);
   const s=await env.DB.prepare(`SELECT id FROM students WHERE id=? AND instructor_id=? AND deleted_at IS NULL AND archived_at IS NULL AND status!='finalizada'`).bind(studentId,i.id).first();if(!s)return fail('Aluno indisponível para agendamento.',404);
   const found=await conflict(env,i.id,v.start_local,v.end_local,id);if(found)return errorConflict(found.name);
   await env.DB.prepare('UPDATE lessons SET student_id=?,start_local=?,end_local=?,notes=? WHERE id=? AND instructor_id=?').bind(studentId,v.start_local,v.end_local,v.notes,id,i.id).run();return serialize({ok:true});
  }
 }
 return fail('Rota não encontrada.',404);
}
function nextMonth(v:string){const [y,m]=v.split('-').map(Number);return `${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}`;}
export default {
 async fetch(req:Request,env:Env):Promise<Response>{
  if(!new URL(req.url).pathname.startsWith('/api/'))return env.ASSETS.fetch(req);
  try{return await handle(req,env);}catch(e){
   const msg=e instanceof Error?e.message:'Falha inesperada.';
   if(/horario_conflitante/.test(msg))return errorConflict();
   if(/UNIQUE constraint failed/.test(msg))return fail('Registro duplicado para este instrutor.',409);
   if(/CHECK constraint failed|FOREIGN KEY constraint failed/.test(msg))return fail('Os dados informados violam uma regra de integridade.',400);
   if(/JSON|SyntaxError/i.test(msg))return fail('JSON inválido.');
   if(/not configured|configurad|encrypt|decrypt|D1_|SQLITE|database|fetch failed|secrets/i.test(msg))return fail('Serviço temporariamente indisponível.',503);
   return fail(msg,400);
  }
 },
 async scheduled(_event:ScheduledEvent,env:Env){
  // Exclusão definitiva após 70 dias, em cascata para as aulas, sessões expiradas e tokens.
  await env.DB.batch([
   env.DB.prepare("DELETE FROM students WHERE deleted_at IS NOT NULL AND deleted_at<datetime('now','-70 days')"),
   env.DB.prepare("DELETE FROM sessions WHERE expires_at<datetime('now')"),
   env.DB.prepare("DELETE FROM tokens WHERE expires_at<datetime('now')"),
   env.DB.prepare("DELETE FROM rate_limits WHERE reset_at<datetime('now','-1 day')")
  ]);
 }
} satisfies ExportedHandler<Env>;
