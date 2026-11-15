export type AlpacaCredentials = {key:string;secret:string};
function decode(value:string){
  const padded=value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=");
  return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
}
function encode(value:Uint8Array){return btoa(String.fromCharCode(...value)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
async function keyFor(secret:string){
  const bytes=decode(secret);if(bytes.length!==32)throw new Error("Invalid vault configuration");
  return crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
export async function sealCredentials(credentials:AlpacaCredentials,owner:string,vaultKey:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(owner)},await keyFor(vaultKey),new TextEncoder().encode(JSON.stringify(credentials)));
  return "v1."+encode(iv)+"."+encode(new Uint8Array(ciphertext));
}
export async function openCredentials(envelope:string,owner:string,vaultKey:string):Promise<AlpacaCredentials>{
  const [version,iv,body]=envelope.split(".");if(version!=="v1"||!iv||!body)throw new Error("Invalid credential envelope");
  const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(iv),additionalData:new TextEncoder().encode(owner)},await keyFor(vaultKey),decode(body));
  const parsed=JSON.parse(new TextDecoder().decode(plaintext));
  if(typeof parsed.key!=="string"||typeof parsed.secret!=="string")throw new Error("Invalid credentials");
  return parsed;
}
