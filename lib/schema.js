/** 原始 JSON Schema 辅助：只用 DSH 支持的子集。description 缺省时不写该键，保证 lossless JSON。 */
export const str = (description, extra) => ({ type:'string', ...(description ? { description } : {}), ...(extra||{}) });
export const num = (description, extra) => ({ type:'number', ...(description ? { description } : {}), ...(extra||{}) });
export const int = (description, extra) => ({ type:'integer', ...(description ? { description } : {}), ...(extra||{}) });
export const bool = (description) => ({ type:'boolean', ...(description ? { description } : {}) });
export const arr = (items, description) => ({ type:'array', items, ...(description ? { description } : {}) });
export const OBJ = (properties, required) => ({ type:'object', properties, required: required||[], additionalProperties:false });

/** 构造工具 output.schema（DSH 宿主注册时强制要求 output.schema 是 schema object）。
 *  只用 DSH 支持的 JSON Schema 子集：type/properties/items/required/additionalProperties。 */
export function makeOutputSchema(fields, required) {
    const props = { text:{type:'string'}, path:{type:'string'}, files:{type:'array',items:{type:'string'}}, success:{type:'boolean'}, duration_ms:{type:'number'}, notes:{type:'array',items:{type:'string'}} };
    for (const [k,v] of Object.entries(fields||{})) props[k]=v;
    const req = ['text','path','files','success','duration_ms','notes'].concat(required||[]);
    return OBJ(props, req);
}
