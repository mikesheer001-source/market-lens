import { connectionStatus, json } from "@/lib/server";
export async function GET(){return json({configured:await connectionStatus()});}
// Connection installation is complete. No public credential mutation is supported.
export async function POST(){return json({error:"The connection is managed on the backend."},405);}
export async function DELETE(){return json({error:"The connection is managed on the backend."},405);}
