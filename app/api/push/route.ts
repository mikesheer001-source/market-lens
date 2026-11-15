import { env } from "cloudflare:workers";
import { bodyOf,errorResponse,HttpError,json,publicRequest } from "@/lib/server";
import { parseSymbols, type Rule } from "@/lib/market";
import { PUSH_PREFIX,sendPush,validEndpoint } from "@/lib/push";
export async function GET(){return json({publicKey:env.VAPID_PUBLIC_KEY??null});}
export async function POST(request:Request){
  try{
    publicRequest(request);const body=await bodyOf(request);const db=env.DB;
    if(!db||!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY)throw new HttpError("Background notifications are not configured.",503);
    if(typeof body.id!=="string"||!/^[a-f0-9]{64}$/.test(body.id))throw new HttpError("Invalid subscription.");
    const owner=PUSH_PREFIX+body.id;
    if(body.action==="remove"){await db.prepare("DELETE FROM preferences WHERE owner=?").bind(owner).run();return json({removed:true});}
    if(body.action==="test"){
      const row=await db.prepare("SELECT payload FROM preferences WHERE owner=?").bind(owner).first<{payload:string}>();if(!row)throw new HttpError("Enable notifications first.");
      const now=Date.now();const allowed=await db.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?, '{}', ?) ON CONFLICT(owner) DO UPDATE SET updated_at=excluded.updated_at WHERE preferences.updated_at < ? RETURNING owner").bind("push-test:"+body.id,now,now-30000).first();if(!allowed)throw new HttpError("Wait 30 seconds before sending another test.",429);
      const result=await sendPush(JSON.parse(row.payload).subscription,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY,JSON.stringify({title:"Market Lens",body:"Notifications are working.",url:"/"}));
      if(!result.ok)throw new HttpError("The browser push service rejected the test.",502);return json({sent:true});
    }
    const sub=body.subscription;const rules=body.rules as Rule[];const symbols=parseSymbols(String(body.symbols??""));
    if(!sub||!validEndpoint(sub.endpoint)||typeof sub.keys?.p256dh!=="string"||typeof sub.keys?.auth!=="string"||sub.keys.p256dh.length>200||sub.keys.auth.length>100||!symbols.length||symbols.length>50||!Array.isArray(rules)||rules.length>20||!rules.some(r=>r.enabled)||rules.some(r=>!r||!["ema","rsi","drawdown","price"].includes(r.metric)||!["weekly","daily","h2"].includes(r.timeframe)||!["lt","gt"].includes(r.op)||typeof r.enabled!=="boolean"||!Number.isFinite(r.value)||!Number.isInteger(r.period)||r.period<2||r.period>500))throw new HttpError("Invalid alert settings. Choose up to 50 symbols and at least one condition.");
    const existing=await db.prepare("SELECT owner FROM preferences WHERE owner=?").bind(owner).first();
    if(!existing){const count=await db.prepare("SELECT count(*) AS n FROM preferences WHERE owner LIKE ?").bind(PUSH_PREFIX+"%").first<{n:number}>();if((count?.n??0)>=1000)throw new HttpError("Alert capacity is full. Try again later.",503);}
    const now=Date.now();const allowed=await db.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?, '{}', ?) ON CONFLICT(owner) DO UPDATE SET updated_at=excluded.updated_at WHERE preferences.updated_at < ? RETURNING owner").bind("push-registration-budget",now,now-1000).first();if(!allowed)throw new HttpError("Please wait a moment and try again.",429);
    const payload={subscription:sub,rules,symbols,closedOnly:true,states:{},baseline:false};
    await db.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(owner,JSON.stringify(payload),Date.now()).run();return json({saved:true});
  }catch(error){return errorResponse(error);}
}
