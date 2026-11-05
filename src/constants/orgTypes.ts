// src/constants/orgTypes.ts
// Kinds of organization an org can be. Picked at sign-up (CreateOrgScreen)
// and editable by admins in Org Setup → Profile. Stored as `orgType` on the
// org doc; firestore.rules restricts it to these values — keep both in sync.

export type OrgType =
  | 'university'
  | 'k12'
  | 'corporate'
  | 'healthcare'
  | 'government'
  | 'nonprofit'
  | 'other';

export const ORG_TYPES: { value: OrgType; label: string }[] = [
  { value: 'university', label: 'University / College' },
  { value: 'k12', label: 'K-12 School' },
  { value: 'corporate', label: 'Corporate Campus' },
  { value: 'healthcare', label: 'Hospital / Healthcare' },
  { value: 'government', label: 'Government / Municipal' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'other', label: 'Other' },
];

/**
 * Parent accounts only make sense where riders are minors. Orgs with no type
 * set yet don't get the option either — every live org today is a
 * university, and an admin can set "K-12 School" to turn it on.
 */
export function allowsParentRole(orgType: string | null | undefined): boolean {
  return orgType === 'k12';
}
