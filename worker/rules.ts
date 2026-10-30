export const DIGITS=(v:unknown)=>String(v??'').replace(/\D/g,'');
export const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim().replace(/\s+/g,' ');
export function validCPF(v:unknown):boolean {
 const s=DIGITS(v);
 if(s.length!==11 || /^(\d)\1+$/.test(s))return false;
 for(let n=9;n<=10;n++){
  let sum=0;for(let i=0;i<n;i++)sum+=Number(s[i])*(n+1-i);
  const digit=(sum*10)%11%10;if(digit!==Number(s[n]))return false;
 }return true;
}
export function pinError(pin:string,cpf:unknown):string|null {
 const cpfDigits=DIGITS(cpf);
 if(!/^\d{6}$/.test(pin)) return 'A senha deve conter exatamente 6 números.';
 if(/^(\d)\1{5}$/.test(pin)) return 'Não use seis números iguais.';
 if(/^(\d{1,3})\1+$/.test(pin)) return 'Não repita padrões como 121212 ou 123123.';
 if([...pin].every((c,i)=>i===0||(Number(c)-Number(pin[i-1])+10)%10===1) || [...pin].every((c,i)=>i===0||(Number(pin[i-1])-Number(c)+10)%10===1)) return 'Não use sequências como 123456 ou 654321.';
 if(cpfDigits.length===11&&cpfDigits.includes(pin))return 'Não use uma sequência de 6 dígitos presente no seu CPF.';
 return null;
}
export function validLocalDateTime(s:unknown):s is string {
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)) return false;
 const [date] = s.split('T'); const [year,month,day] = date.split('-').map(Number);
 if(year<2020||year>2100||month<1||month>12||day<1) return false;
 const d=new Date(Date.UTC(year,month-1,day));
 return d.getUTCFullYear()===year&&d.getUTCMonth()+1===month&&d.getUTCDate()===day;
}
// Operação de minuto em UTC; o horário civil da agenda é America/Fortaleza (UTC-3, sem horário de verão atual).
export function addMinutes(start:string,minutes:number):string {const ms=Date.parse(start+':00-03:00')+minutes*60_000;return new Date(ms-3*3600_000).toISOString().slice(0,16);}
export function validateStudent(d:Record<string,unknown>) {
 const name=String(d.name??'').trim().replace(/\s+/g,' ');
 if(name.length<3||name.length>100)throw new Error('Informe o nome completo do aluno (3 a 100 caracteres).');
 const category=String(d.category??'');if(!['A','B','C','D','E','AB','AC','AD','AE'].includes(category))throw new Error('Categoria de CNH inválida.');
 const phone=DIGITS(d.phone);if(phone.length<10||phone.length>11)throw new Error('Informe um celular com DDD válido.');
 const cpf=DIGITS(d.cpf);if(cpf&&!validCPF(cpf))throw new Error('CPF do aluno inválido.');
 const lessons_total=Number(d.lessons_total),lessons_done=Number(d.lessons_done);
 if(!Number.isInteger(lessons_total)||lessons_total<0||lessons_total>9999)throw new Error('Número de aulas contratadas inválido.');
 if(!Number.isInteger(lessons_done)||lessons_done<0||lessons_done>lessons_total)throw new Error('Aulas concluídas não podem ultrapassar as contratadas.');
 const amount_total_cents=Number(d.amount_total_cents),amount_paid_cents=Number(d.amount_paid_cents);
 if(!Number.isSafeInteger(amount_total_cents)||amount_total_cents<0||!Number.isSafeInteger(amount_paid_cents)||amount_paid_cents<0)throw new Error('Informe valores monetários válidos.');
 const status=String(d.status??'nao_iniciadas');if(!['nao_iniciadas','em_andamento','finalizada'].includes(status))throw new Error('Status inválido.');
 return {name,category,phone,cpf,lessons_total,lessons_done,amount_total_cents,amount_paid_cents,status,search_name:normalize(name)};
}
export function validateLesson(d:Record<string,unknown>){
 const start=String(d.start_local??'');const count=Number(d.count??1);
 if(!validLocalDateTime(start))throw new Error('Data ou horário de aula inválido.');
 if(!Number.isInteger(count)||count<1||count>8)throw new Error('Agende de 1 a 8 aulas consecutivas (60 minutos cada).');
 const notes=String(d.notes??'').trim();if(notes.length>500)throw new Error('Observação deve ter até 500 caracteres.');
 return {start_local:start,end_local:addMinutes(start,count*60),notes};
}
