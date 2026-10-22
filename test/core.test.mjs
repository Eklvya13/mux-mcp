import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../src/config.mjs';
import { requireAccess, requireDeleteEnabled, allowTool } from '../src/permissions.mjs';
import { allowedRoute, queryUrl, createClient } from '../src/client.mjs';
import { createApproval, consumeApproval, APPROVAL_TTL_MS } from '../src/approvals.mjs';
import { sanitize, resultText } from '../src/format.mjs';
import os from 'node:os';
import fs from 'node:fs';

const cfg = (mode='readonly') => getConfig({ MUX_ACCESS_MODE: mode, MUX_TOKEN_ID:'read-id',MUX_TOKEN_SECRET:'read-secret',MUX_WRITE_TOKEN_ID:'write-id',MUX_WRITE_TOKEN_SECRET:'write-secret' });

test('mode defaults to readonly, even when invalid', () => {
  assert.equal(getConfig({}).mode,'readonly');
  assert.equal(getConfig({MUX_ACCESS_MODE:'WRITE'}).mode,'readonly');
  assert.equal(getConfig({MUX_ACCESS_MODE:'admin'}).mode,'admin');
  assert.equal(getConfig({MUX_ENABLE_ASSET_DELETE:'1'}).enableAssetDelete,false);
});

test('tools are hidden unless explicit mode + write credentials + delete flag', () => {
  assert.equal(allowTool(cfg(), 'write'), false);
  assert.equal(allowTool(cfg('write'), 'admin', 'asset'),false);
  assert.equal(allowTool(getConfig({MUX_ACCESS_MODE:'admin',MUX_ENABLE_ASSET_DELETE:'true'}), 'admin','asset'),false);
  assert.equal(allowTool(getConfig({...{MUX_ACCESS_MODE:'admin',MUX_ENABLE_ASSET_DELETE:'true'},MUX_WRITE_TOKEN_ID:'id',MUX_WRITE_TOKEN_SECRET:'secret'}),'admin','asset'),true);
  assert.throws(()=>requireAccess(cfg(),'write'),/requires write/);
  assert.throws(()=>requireDeleteEnabled(cfg('admin'),'asset'),/disabled/);
});

test('endpoint allowlist excludes upload/asset-create endpoints and arbitrary URLs', () => {
  assert.equal(allowedRoute('GET','/data/v1/video-views'),true);
  assert.equal(allowedRoute('PATCH','/video/v1/assets/example'),true);
  assert.equal(allowedRoute('POST','/video/v1/assets'),false);
  assert.equal(allowedRoute('POST','/video/v1/uploads'),false);
  assert.equal(allowedRoute('DELETE','/video/v1/live-streams/example'),false);
  assert.equal(allowedRoute('GET','/admin'),false);
  assert.equal(allowedRoute('GET','/video/v1/assets/../../admin'),false);
  assert.equal(allowedRoute('GET','https://evil.example/data/v1/video-views'),false);
});

test('query builder sends safe repeated filters to fixed Mux origin', () => {
  const u=queryUrl('/data/v1/video-views',{'timeframe[]':['7:days'],'filters[]':['country:US','browser:Chrome'],page:2});
  assert.equal(u.origin,'https://api.mux.com');
  assert.deepEqual(u.searchParams.getAll('filters[]'),['country:US','browser:Chrome']);
  assert.equal(u.searchParams.get('page'),'2');
});

test('GET uses read credentials, PATCH uses separate write credentials', async () => {
  const calls=[];
  const http=createClient(cfg('write'),async (url,opts)=>{
    calls.push({url:url.toString(),opts});
    return new Response(JSON.stringify({data:{id:'x'}}), {status:200, headers:{'Content-Type':'application/json'}});
  });
  await http('GET','/video/v1/assets/hello');
  await http('PATCH','/video/v1/assets/hello',{body:{meta:{title:'hello'}}});
  assert.equal(calls.length,2);
  assert.equal(Buffer.from(calls[0].opts.headers.Authorization.slice(6),'base64').toString(),'read-id:read-secret');
  assert.equal(Buffer.from(calls[1].opts.headers.Authorization.slice(6),'base64').toString(),'write-id:write-secret');
  assert.equal(JSON.parse(calls[1].opts.body).meta.title,'hello');
  assert.equal(calls[0].opts.redirect,'error');
});

test('read-only blocks mutations before any network request', async () => {
  let count=0;
  const http=createClient(cfg('readonly'),async()=>{count++;return new Response('{}');});
  await assert.rejects(()=>http('DELETE','/video/v1/assets/x'),/requires write permission/);
  await assert.rejects(()=>http('POST','/video/v1/uploads'),/not allowlisted/);
  assert.equal(count,0);
});

test('HTTP error redacts response body and returns 204 success', async () => {
  const fail=createClient(cfg(),async()=>new Response('{"token":"secret","stream_key":"private"}',{status:403}));
  await assert.rejects(()=>fail('GET','/video/v1/assets'),e=>e.message==='Mux API returned HTTP 403');
  const success=createClient(cfg('admin'),async()=>new Response(null,{status:204}));
  assert.deepEqual(await success('DELETE','/video/v1/assets/test'),{success:true,status:204});
});

test('GET retries recoverable 503 but mutations are not retried', async () => {
  let count=0;
  const mock=async()=>{ count++; return count===1 ? new Response('bad',{status:503}) : new Response('{"data":[]}',{status:200}); };
  const http=createClient(cfg(),mock);
  assert.deepEqual((await http('GET','/data/v1/dimensions')).data,[]);
  assert.equal(count,2);
  count=0;
  const mutate=createClient(cfg('admin'),mock);
  await assert.rejects(()=>mutate('DELETE','/video/v1/assets/a'),/503/);
  assert.equal(count,1);
});

test('operator approval is target-bound, one-use and expiring', () => {
  const oldHome=process.env.HOME;
  const home=fs.mkdtempSync(`${os.tmpdir()}/mux-approval-test-`);
  try {
    process.env.HOME=home;
    const now=10000000;
    createApproval('asset','assetA','',now);
    assert.throws(()=>consumeApproval('asset','assetB','',now),/No local operator approval/);
    assert.equal(consumeApproval('asset','assetA','',now),true);
    assert.throws(()=>consumeApproval('asset','assetA','',now),/No local operator approval/);
    createApproval('track','assetA','trackB',now);
    assert.throws(()=>consumeApproval('track','assetA','trackB',now+APPROVAL_TTL_MS+1),/expired/);
  } finally {
    if (oldHome===undefined) delete process.env.HOME; else process.env.HOME=oldHome;
    fs.rmSync(home,{recursive:true,force:true});
  }
});


test('all nested stream secrets and signed URL query tokens are redacted', () => {
  const value={data:{stream_key:'private-stream',metadata:{authorization:'Basic abc',signed_url:'https://stream.mux.com/a.m3u8?token=very-private&x-amz-signature=abc',views:[1,2,3]}}};
  const safe=sanitize(value,2);
  assert.equal(safe.data.stream_key,'[REDACTED]');
  assert.equal(safe.data.metadata.authorization,'[REDACTED]');
  assert.ok(!JSON.stringify(safe).includes('very-private'));
  assert.ok(!JSON.stringify(safe).includes('private-stream'));
  assert.ok(!JSON.stringify(safe).includes('signature=abc'));
  assert.deepEqual(safe.data.metadata.views,[1,2,{omitted_items:1}]);
});

test('large tool outputs return valid summary rather than invalid truncated JSON', () => {
  const result=resultText({data:{a:'x'.repeat(140_000)}},cfg());
  assert.equal(JSON.parse(result.content[0].text).truncated,true);
});
