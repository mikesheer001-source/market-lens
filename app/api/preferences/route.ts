import { DEFAULT_PREFS } from "@/lib/market";
import { json } from "@/lib/server";
export async function GET(){return json(DEFAULT_PREFS);}
export async function POST(){return json({error:"Screens and watchlists are saved in this browser."},405);}
