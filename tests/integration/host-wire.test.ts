import {expect,it} from 'vitest';
import {replyFrame,textReplyPrefix} from '../../apps/desktop/main/host-wire';

it('transports serialized project JSON without a second layer of escaping',()=>{
 const coordinates=[-5.5108101000737325e-15,421.31319111392395,1.177772994699332,-59.95374217444337,.1,1800.0000000000002,Number.MIN_VALUE];
 const json=JSON.stringify({ok:true,data:{name:'兽装 🐾',note:'first\nsecond\tline',coordinates}}),frame=replyFrame(42,'fpcad:request-text',json);
 expect(frame.startsWith(textReplyPrefix+'42\t')).toBe(true);expect(frame.split('\n')).toHaveLength(2);
 const received=frame.slice((textReplyPrefix+'42\t').length,-1);expect(received).toBe(json);expect(JSON.parse(received).data.coordinates).toEqual(coordinates);
});

it.each(['fpcad:request','fpcad:assistant','fpcad:assistant-settings','shutdown'])('keeps %s replies in the existing object protocol',channel=>{
 const value={ok:true,data:{name:'兽装',coordinates:[421.31319111392395]}};
 expect(JSON.parse(replyFrame(7,channel,value))).toEqual({id:7,value});
 expect(JSON.parse(replyFrame(8,channel,'a\nb'))).toEqual({id:8,value:'a\nb'});
});

it('keeps a non-text reply from a starting or older backend in the existing protocol',()=>{
 expect(JSON.parse(replyFrame(9,'fpcad:request-text',{ok:false,error:{code:'BACKEND_STARTING'}}))).toEqual({id:9,value:{ok:false,error:{code:'BACKEND_STARTING'}}});
});
