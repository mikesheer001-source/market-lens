import { env } from "cloudflare:workers";
import { completeSharedSnapshot } from "@/lib/shared-snapshot";
import { processPushBatch } from "@/lib/push";
import { refreshMarketHistory, importIntradayHistory } from "@/lib/market-history";

const tools=[{
  name:"refresh_market_history",
  description:"Advance one bounded daily or intraday history batch, save a shared starter snapshot, and check a batch of opted-in alerts. Site owner only. Calls alternate data phases.",
  inputSchema:{type:"object",properties:{},additionalProperties:false},
},{name:"refresh_intraday_history",description:"Advance the shared two-hour history by one bounded batch. Site owner only.",inputSchema:{type:"object",properties:{},additionalProperties:false}},{name:"complete_shared_scan",description:"Atomically save a completed scan of the default starter universe from genuine cached histories, including missing and freshness metadata. Site owner only.",inputSchema:{type:"object",properties:{},additionalProperties:false}},{name:"check_screen_alerts",description:"Evaluate one bounded batch of opted-in notification subscriptions against available cached histories. Site owner only.",inputSchema:{type:"object",properties:{},additionalProperties:false}}];

export async function POST(request:Request){
  const message=await request.json() as {id?:string|number;method?:string;params?:{name?:string}};
  const reply=(result:unknown)=>Response.json({jsonrpc:"2.0",id:message.id??null,result});
  if(message.method==="server/discover")return reply({supportedVersions:["2026-07-28"],capabilities:{tools:{}}});
  if(message.method==="tools/list")return reply({tools});
  if(message.method==="initialize")return reply({protocolVersion:"2025-03-26",capabilities:{tools:{}},serverInfo:{name:"Market Lens",version:"1.0"}});
  if(message.method?.startsWith("notifications/"))return new Response(null,{status:202});
  if(message.method==="tools/call"&&tools.some(tool=>tool.name===message.params?.name)){
    const email=request.headers.get("oai-authenticated-user-email");
    if(!env.DB||!env.MARKET_REFRESH_OWNER||!email||email.toLowerCase()!==env.MARKET_REFRESH_OWNER.toLowerCase()){
      return reply({isError:true,content:[{type:"text",text:"Market refresh requires the Site owner's connected account."}]});
    }
    try{
      let result:unknown;
      if(message.params?.name==="refresh_market_history"){
        // Backward-compatible unattended entry point. Alternate provider-heavy phases,
        // because daily and intraday share the provider's request budget.
        const state=await env.DB.prepare("SELECT payload FROM preferences WHERE owner=?").bind("refresh-phase-v1").first<{payload:string}>();
        const phase=state?.payload==="intraday"?"intraday":"daily";
        const refresh=phase==="daily"?await refreshMarketHistory(env.DB):await importIntradayHistory(env.DB);
        if(!refresh.busy)await env.DB.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind("refresh-phase-v1",phase==="daily"?"intraday":"daily",Date.now()).run();
        const snapshot=await completeSharedSnapshot(env.DB);
        const alerts=env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY?await processPushBatch(env.DB,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY):{configured:false};
        result={...refresh,phase,refresh,snapshot,alerts};
      }else result=message.params?.name==="refresh_intraday_history"?await importIntradayHistory(env.DB):message.params?.name==="complete_shared_scan"?await completeSharedSnapshot(env.DB):env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY?await processPushBatch(env.DB,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY):{configured:false};
      return reply({content:[{type:"text",text:JSON.stringify(result)}]});
    }catch{
      return reply({isError:true,content:[{type:"text",text:"Market history refresh failed. Retry shortly."}]});
    }
  }
  return Response.json({jsonrpc:"2.0",id:message.id??null,error:{code:-32601,message:"Unknown method."}});
}
