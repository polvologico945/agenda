export type Status='nao_iniciadas'|'em_andamento'|'finalizada';
export type Category='A'|'B'|'C'|'D'|'E'|'AB'|'AC'|'AD'|'AE';
export type Instructor={id:string;name:string;email:string;phone:string;categories:string[];photo:boolean;verified_device:string};
export type Student={id:string;name:string;category:Category;phone:string;cpf:string;lessons_total:number;lessons_done:number;amount_paid_cents:number;amount_total_cents:number;status:Status;archived_at:string|null;deleted_at:string|null};
export type Lesson={id:string;student_id:string;student_name:string;student_category:string;start_local:string;end_local:string;notes:string};
export type StudentInput=Omit<Student,'id'|'archived_at'|'deleted_at'>;
export async function api<T>(path:string,init:RequestInit={}):Promise<T>{
 const headers=new Headers(init.headers);
 if(init.body && !(init.body instanceof FormData))headers.set('Content-Type','application/json');
 const res=await fetch('/api'+path,{...init,credentials:'same-origin',headers});
 const data=await res.json().catch(()=>({error:'Resposta inesperada do servidor.'}));
 if(!res.ok)throw new Error(data.error||`Não foi possível concluir a operação (${res.status}).`);
 return data as T;
}
export const post=<T>(path:string,obj:unknown)=>api<T>(path,{method:'POST',body:JSON.stringify(obj)});
export const patch=<T>(path:string,obj:unknown)=>api<T>(path,{method:'PATCH',body:JSON.stringify(obj)});
export const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const moneyToCents=(v:string)=>Math.round(Number(v.replace(',','.'))*100);
export const statusName:Record<Status,string>={nao_iniciadas:'Não iniciadas',em_andamento:'Em andamento',finalizada:'Finalizada'};
export const statusClass:Record<Status,string>={nao_iniciadas:'unstarted',em_andamento:'progress',finalizada:'completed'};
export const digits=(v:string)=>v.replace(/\D/g,'');
export const folded=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
export function pinError(pin:string,cpf:string):string|null{
 if(!/^\d{6}$/.test(pin))return 'Use exatamente 6 números.';
 if(/^(\d)\1{5}$/.test(pin))return 'Não use seis números iguais.';
 if(/^(\d{1,3})\1+$/.test(pin))return 'Não repita padrões (121212, 123123).';
 if([...pin].every((d,i)=>!i||(Number(d)-Number(pin[i-1])+10)%10===1)||[...pin].every((d,i)=>!i||(Number(pin[i-1])-Number(d)+10)%10===1))return 'Não use sequências crescentes ou decrescentes.';
 if(digits(cpf).length===11 && digits(cpf).includes(pin))return 'Não use 6 dígitos consecutivos do CPF.';
 return null;
}
export const localDate=(v:string)=>new Date(v+'-03:00');
