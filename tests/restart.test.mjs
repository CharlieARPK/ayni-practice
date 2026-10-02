import test from 'node:test';
import assert from 'node:assert/strict';
import { restartIndex } from '../src/navigation.js';

test('同じ楽譜をやり直すときは反復の何回目かを維持する', () => {
  const a={number:55}, b={number:56}, c={number:57};
  const sequence=[a,b,a,b,c];
  assert.equal(restartIndex([...sequence],sequence,3,56),3);
  assert.equal(restartIndex([...sequence],sequence,3,56,true),2);
});

test('保存後は以前の反復位置を新しいデータへ持ち越さない', () => {
  const old=[{number:55},{number:56},{number:55},{number:56},{number:57}];
  const edited=old.map(m=>({...m,notes:[{pitch:'F#4'}]}));
  assert.equal(restartIndex(edited,old,3,56),1);
});

test('小節試聴後も設定した練習区間の位置から再開する', () => {
  const sequence=[{number:55},{number:56},{number:57}];
  const audition=[{number:56}];
  assert.equal(restartIndex(sequence,audition,0,56),1);
  assert.equal(restartIndex(sequence,audition,0,56,true),0);
});

test('曲進行変更と範囲外の現在小節も安全に扱う', () => {
  const a={number:55},b={number:56},c={number:57};
  assert.equal(restartIndex([a,b,c],[a,c,b],2,56),1);
  assert.equal(restartIndex([a,b,c],undefined,0,90),0);
  assert.equal(restartIndex([a,b,c],[a,b,c],0,55,true),0);
});
