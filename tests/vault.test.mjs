import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sealCredentials,openCredentials} from '../lib/vault.ts';
const vault=randomBytes(32).toString('base64url');
const sample={key:'DUMMY_KEY_FOR_LOCAL_UNIT_TEST',secret:'DUMMY_SECRET_NOT_A_PROVIDER_CREDENTIAL'};
test('credentials encrypt and decrypt without storing plaintext',async()=>{
 const sealed=await sealCredentials(sample,'user-a',vault);
 assert.deepEqual(await openCredentials(sealed,'user-a',vault),sample);
 assert.equal(sealed.includes(sample.key),false);assert.equal(sealed.includes(sample.secret),false);
});
test('a saved connection cannot be opened for a different user',async()=>{
 const sealed=await sealCredentials(sample,'user-a',vault);
 await assert.rejects(openCredentials(sealed,'user-b',vault));
});
test('tampering and wrong encryption keys fail closed',async()=>{
 const sealed=await sealCredentials(sample,'user-a',vault);
 const parts=sealed.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
 await assert.rejects(openCredentials(parts.join('.'),'user-a',vault));
 await assert.rejects(openCredentials(sealed,'user-a',randomBytes(32).toString('base64url')));
});
test('each encryption gets a fresh nonce',async()=>{
 const first=await sealCredentials(sample,'user-a',vault),second=await sealCredentials(sample,'user-a',vault);
 assert.notEqual(first,second);assert.notEqual(first.split('.')[1],second.split('.')[1]);
});
