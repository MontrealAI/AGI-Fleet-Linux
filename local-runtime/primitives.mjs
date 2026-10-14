// Transport-safe primitives: no registry, filesystem state or module-relative reads.
export {parseStrict,canonical} from '../fleet/successor/vendor/manager/site/assets/successor/safe.mjs';
export const MAX_BYTES=4_000_000;
export const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
export function keys(value,allowed,required=allowed){
  need(value&&typeof value==='object'&&!Array.isArray(value),'OBJECT_REQUIRED');
  need(Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(value,k)),'FIELDS_INVALID');
}
export function uuid(value){need(typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value),'IDENTITY_INVALID');return value;}
