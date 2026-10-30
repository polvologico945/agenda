import {DIGITS,pinError,validCPF} from './rules';
const te=new TextEncoder();
export const hex=(a:ArrayBuffer)=>[...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('');
export const randomToken=()=>{const b=new Uint8Array(32);crypto.getRandomValues(b);return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');};
export async function sha(v:string){return hex(await crypto.subtle.digest('SHA-256',te.encode(v)));}
export async function hmacCPF(cpf:string,secret:string){
 const key=await crypto.subtle.importKey('raw',te.encode(secret),'HMAC',false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,te.encode(DIGITS(cpf))));
}
export async function pbkdf2(pin:string,salt?:string){
 const s=salt??randomToken().slice(0,32);
 const key=await crypto.subtle.importKey('raw',te.encode(pin),'PBKDF2',false,['deriveBits']);
 const hash=await crypto.subtle.deriveBits({name:'PBKDF2',salt:te.encode(s),iterations:600_000,hash:'SHA-256'},key,256);
 return {salt:s,hash:hex(hash)};
}
export const timingEqual=(a:string,b:string)=>{
 if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;
};
export function ensurePIN(pin:string,cpf:string){if(!validCPF(cpf))throw new Error('CPF inválido.');const error=pinError(pin,cpf);if(error)throw new Error(error);}
function b64(buf:Uint8Array){let s='';for(const c of buf)s+=String.fromCharCode(c);return btoa(s);}
function unb64(s:string){return Uint8Array.from(atob(s),x=>x.charCodeAt(0));}
async function aesKey(secret:string){const bits=await crypto.subtle.digest('SHA-256',te.encode(secret));return crypto.subtle.importKey('raw',bits,'AES-GCM',false,['encrypt','decrypt']);}
export async function encrypt(v:string,secret:string){
 const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await aesKey(secret),te.encode(v));
 return b64(iv)+'.'+b64(new Uint8Array(data));
}
export async function decrypt(v:string,secret:string){
 const [a,b]=v.split('.'); const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(a)},await aesKey(secret),unb64(b));return new TextDecoder().decode(data);
}
