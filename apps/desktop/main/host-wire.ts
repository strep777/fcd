export const textReplyPrefix='fpcad:text\t';

/** The backend has already serialized text responses. Keep their exact JSON
 * bytes instead of escaping the full project inside a second JSON string. */
export function replyFrame(id:number,channel:string,value:unknown){
 return channel==='fpcad:request-text'&&typeof value==='string'
  ?`${textReplyPrefix}${id}\t${value}\n`
  :JSON.stringify({id,value})+'\n';
}
