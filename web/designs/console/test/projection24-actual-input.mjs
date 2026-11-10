import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
// Vitest and the project test command both use web/ as their configured root.
const directory=resolve('designs/console/test/fixtures/core296-bdc852');
const manifest=JSON.parse(readFileSync(resolve(directory,'provenance.json'),'utf8'));
assert.equal(manifest.producer,'bdc852c6b61ff0fdb312fb8489c0f2f85cbbe2d1');
assert.equal(manifest.originalManifestSha256,'4078c1d12d06b84ac462c2fab61957e7a7ff02c94ebcf123d8e7444d0efa11e4');
export function actual(name){
 const meta=manifest.files[name];assert(meta,'unregistered producer fixture');
 const packed=readFileSync(resolve(directory,name+'.gz'));
 assert.equal(createHash('sha256').update(packed).digest('hex'),meta.gzipSha256);
 const bytes=gunzipSync(packed);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.sha256);
 return JSON.parse(bytes.toString());
}
