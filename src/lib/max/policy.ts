import { hasCapability } from "@/lib/permission-presets";

export type MaxActor = {role:string;isRoot?:boolean;permissionPreset?:string|null;canManageSettings?:boolean;orgPresetOverrides?:Record<string,string[]>|null};
export function maxMenuPolicy(actor:MaxActor) {
  return {
    root:actor.isRoot===true,
    settings:actor.isRoot===true || actor.canManageSettings===true || hasCapability(actor,"admin.full"),
    staff:hasCapability(actor,"staff.view") || hasCapability(actor,"staff.manage"),
    verify:hasCapability(actor,"tasks.verify"),
    dashboard:hasCapability(actor,"stats.view"),
  };
}
export function canConfirmMaxRequest(request:{userId:string;expiresAt:Date;usedAt:Date|null;claimedMaxUserId:string|null},userId:string,now=new Date()):boolean {
  return request.userId===userId && request.expiresAt>now && !request.usedAt && !!request.claimedMaxUserId;
}
