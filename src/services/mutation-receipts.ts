import type {QueryClient} from './allocation-queries.js';
import {invalid} from './planning-store.js';
import {digest,stale} from './scheduling-common.js';
export function retryKey(value:unknown){if(value===undefined)return undefined;if(typeof value!=='string'||! /^[a-zA-Z0-9_-]{8,128}$/.test(value))invalid('Use a valid retry key.');return value;}
export async function priorReceipt(client:QueryClient,actorId:number,scope:string,key:string|undefined,payload:unknown){if(!key)return null;const row=(await client.query<{resultId:number;requestHash:string}>('SELECT "resultId","requestHash" FROM "MutationReceipt" WHERE "actorId"=$1 AND "scope"=$2 AND "requestKey"=$3',[actorId,scope,key])).rows[0];if(row&&row.requestHash!==digest(payload))throw stale();return row?.resultId??null;}
export async function saveReceipt(client:QueryClient,actorId:number,scope:string,key:string|undefined,payload:unknown,resultId:number){if(key)await client.query('INSERT INTO "MutationReceipt" ("actorId","scope","requestKey","requestHash","resultId") VALUES ($1,$2,$3,$4,$5)',[actorId,scope,key,digest(payload),resultId]);}
