import test from "node:test";
import assert from "node:assert/strict";
import {CommanderAccess} from "./commander-access.js";

test("operator-issued 7-day link stores only a hash, authorizes 8-hour read session, and survives restart",()=>{
 const a=new CommanderAccess(),now=1_800_000_000_000;
 const issued=a.issue(now);
 assert.match(issued.token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(issued.expiresAt-now,7*24*60*60*1000);
 const persisted=a.export();
 assert.ok(!JSON.stringify(persisted).includes(issued.token));
 const b=new CommanderAccess();b.load(persisted);
 assert.equal(b.authenticate("wrong",now),null);
 const session=b.authenticate(issued.token,now);
 assert.match(session.key,/^[a-f0-9]{64}$/);
 assert.equal(session.expiresAt-now,8*60*60*1000);
 assert.equal(b.authorized(session.key,now+1000),true);
 assert.equal(b.authorized(session.key,now+8*60*60*1000+1),false);
 const renewal=b.authenticate(issued.token,now+24*60*60*1000);
 assert.ok(renewal);
 b.revoke();
 assert.equal(b.authorized(renewal.key,now+24*60*60*1000),false);
 assert.equal(b.authenticate(issued.token,now+24*60*60*1000),null);
});
test("new link invalidates old links and previously established sessions",()=>{
 const c=new CommanderAccess(),now=1_800_000_000_000;
 const old=c.issue(now),login=c.authenticate(old.token,now);
 assert.ok(login);
 const fresh=c.issue(now+2_000);
 assert.equal(c.authenticate(old.token,now+3_000),null);
 assert.equal(c.authorized(login.key,now+3_000),false);
 assert.ok(c.authenticate(fresh.token,now+3_000));
 assert.equal(c.authenticate(fresh.token,now+8*24*60*60*1000),null);
});
test("tampered persistent state is rejected closed and no privileges leak",()=>{
 const c=new CommanderAccess();
 for(const bad of [{hash:"wrong",expiresAt:123},{hash:"a".repeat(64),expiresAt:"tomorrow"},[],{hash:"a".repeat(64),expiresAt:-1}])
  assert.throws(()=>c.load(bad));
 assert.equal(c.authorized("b".repeat(64)),false);
 assert.equal(c.authenticate("a".repeat(43)),null);
});
