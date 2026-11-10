import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const directory=resolve('../../..','.local/leader/artifacts/core296/actual-bdc852');
const bytes=readFileSync(resolve(directory,'manifest.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'4078c1d12d06b84ac462c2fab61957e7a7ff02c94ebcf123d8e7444d0efa11e4');
const manifest=JSON.parse(bytes.toString());
export function actual(name){
 const bytes=readFileSync(resolve(directory,name));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.files[name].sha256);
 return JSON.parse(bytes.toString());
}
